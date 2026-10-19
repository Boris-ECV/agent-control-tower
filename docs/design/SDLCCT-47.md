# 設計文件 — SDLCCT-47 Agent detail cost-breakdown endpoint (backend)

## 對應需求規格

對應 G1 已核准的需求規格「Agent detail cost-breakdown endpoint (backend) —
split from SDLCCT-44」(docs/PRD.md「SDLCCT-47」章節)。5 條 AC 對應範圍：
version-split 成本序列(以 `Breakdown(METADATA, metadata_key="deployed_version")`
查詢,null 點保留不轉 0,AC1)、model-split 成本分解(以 `Breakdown(TAGS)`
查詢,AC2)、top-N 成本排序 trace 清單(重用 `opik_traces.get_top_traces_by_cost()`,
AC3)、任一查詢失敗時整體回傳明確 502(重用既有 `OpikClientError`/
`OpikConfigError` handler,AC4)、Agent key 不存在於 registry 時回傳明確
404(AC5)。

範圍外(spec 已標明,本文件不觸碰):trace 樹/span 組裝(畫面 #4,另一張
票);任何寫入操作;前端畫面(SDLCCT-48,另一張票)。

## 介面/API 契約

新增一個對外 HTTP 端點,掛在既有 `bff/api/app.py`(SDLCCT-32 建立的 FastAPI
app)上,沿用其錯誤處理慣例(`OpikClientError`/`OpikConfigError` →
502,見 `app.py` 第 35-59 行既有的 `@app.exception_handler`,本票不新增
handler)。

```
GET /api/agents/{key}/cost-breakdown?top_n=<int>

Path params:
  key    str,必要。Agent registry key(與 seed/registry.py::load_registry()
         的 "key" 欄位、以及 bff/opik_metrics.py / bff/opik_traces.py 呼叫時
         用的 project_id / project_name 是同一個值——seed/generate.py 第
         143/169 行確認 trace/span 寫入時 project_name = a.key,因此本端點
         直接把 path param `key` 原樣當 project_id 傳給
         get_project_metrics_cached(),當 project_name 傳給
         get_top_traces_by_cost(),不需要額外的 key→project 對照表)

Query params:
  top_n  int,選填,預設 = opik_traces.DEFAULT_TOP_TRACES_SIZE(10)。
         直接轉傳給 get_top_traces_by_cost(project_name, size=top_n)。

Response 200 (application/json):
{
  "key": "<agent key>",
  "display": "<registry 的 display 名稱>",
  "anchor_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD",       # 當月月初,對應 model_cost_breakdown 的彙總期間
  "version_cost_series": [
    {
      "version": "<deployed_version 值,或 agent key(查無 name 時的 fallback)>",
      "points": [ { "date": "YYYY-MM-DD", "value": <float> | null }, ... ]
    },
    ...
  ],
  "model_cost_breakdown": [
    { "model": "<tag 值,或 agent key(查無 name 時的 fallback)>", "cost": <float> | null },
    ...
  ],
  "top_traces": [
    { "id": "<trace id>", "total_estimated_cost": <float> | null, "metadata": {...} | null },
    ...
  ]
}

Response 404 (key 不在 registry 中,AC5):
{ "detail": "Agent '<key>' not found" }      # FastAPI 預設 HTTPException 形狀

Response 502 (三個底層查詢中任一失敗,AC4):
沿用 app.py 既有的 OpikClientError / OpikConfigError handler 原樣形狀,
不新增 handler、不改動既有 handler。
```

### 新增模組位置

- `bff/api/agent_detail.py`(新檔案,業務邏輯):`get_agent_cost_breakdown(key, *, top_n=DEFAULT_TOP_TRACES_SIZE) -> dict | None`。
  回傳 `None` 表示 key 不在 registry(呼叫端轉 404);找到 Agent 後才會
  呼叫三個底層查詢,任何一個拋 `OpikClientError`/`OpikConfigError` 都完全
  不攔截,原樣往上傳給 app.py 既有 handler(AC4「整個請求回傳明確
  502」——不要在這層 try/except 吞掉其中一個查詢的失敗再回傳部分結果)。
  依循 `bff/api/agents.py`/`bff/api/cost_overview.py` 已建立的慣例:
  sys.path 插入 `seed/` 以 import `registry.get_agent`,import
  `anchor.get_anchor_date`、`opik_metrics` 的 `Breakdown`/`BreakdownField`/
  `Interval`/`MetricType`/`get_project_metrics_cached`,以及
  `opik_traces` 的 `DEFAULT_TOP_TRACES_SIZE`/`get_top_traces_by_cost`。
  新開檔案而非塞進 `agents.py`:這是單一 Agent 的 detail 端點,查詢對象
  (含 traces)與 `agents.py` 的「全部 9 個 Agent 清單」端點概念邊界不同,
  延續 SDLCCT-10/15/17 已確立的「依端點家族分檔」慣例。
- `bff/api/schemas.py`(既有檔案,只新增,不更動既有類別):新增
  `VersionCostPoint`、`VersionCostSeriesEntry`、`ModelCostBreakdownEntry`、
  `TopTraceItem`、`AgentCostBreakdownResponse` 五個 Pydantic 類別。
- `bff/api/app.py`(既有檔案,只新增一個 route function,不更動既有
  route/handler):
  ```python
  from .agent_detail import get_agent_cost_breakdown
  from .schemas import AgentCostBreakdownResponse

  @app.get("/api/agents/{key}/cost-breakdown", response_model=AgentCostBreakdownResponse)
  def agent_cost_breakdown(key: str, top_n: int = DEFAULT_TOP_TRACES_SIZE) -> dict:
      result = get_agent_cost_breakdown(key, top_n=top_n)
      if result is None:
          raise HTTPException(status_code=404, detail=f"Agent '{key}' not found")
      return result
  ```
  (`DEFAULT_TOP_TRACES_SIZE` import 自 `opik_traces`,與 `agent_detail.py`
  用同一個常數,不重複定義一份預設值;`HTTPException` 需從
  `fastapi` 補一行 import。)

## 資料模型

無新增資料模型。本 Story 是純讀取組合(read-composition):把三個既有
唯讀查詢(`opik_metrics.get_project_metrics_cached` ×2、
`opik_traces.get_top_traces_by_cost` ×1)與既有 `seed/registry.py` 的
Agent 記錄組成單一回應,沒有新建資料表、欄位、索引,也沒有任何寫入或
持久化狀態。回應型別(`AgentCostBreakdownResponse` 等)是 Pydantic
model,生命週期僅限一次 HTTP 請求,與 SDLCCT-32/38/43 的資料模型決策
一致。

## 關鍵技術決策

### 1. version 序列用 DAILY interval + 7 天視窗(重用 SDLCCT-43 的 trend 視窗慣例);model 分解用 TOTAL interval + 當月月初至今視窗(重用 SDLCCT-32/43 的 period 慣例)

Spec(AC1/AC2)本身沒有指定查詢的時間窗長度,但 `opik_metrics.
get_project_metrics_cached()` 的 `interval_start`/`interval_end` 是必要
參數、無預設值(刻意設計,呼叫端必須明確決定)。AC1 的用詞是「cost
**series**」且目的是「see when cost jumped」——與 `bff/api/agents.py::
_trend_points()` 已經解決過的同一個需求(7 天逐日序列,用來觀察近期
變化)完全對應,因此直接重用該視窗定義(`anchor_date - 6 天` 到
`anchor_date`,DAILY interval),不重新發明一個新的時間窗長度。AC2 的
用詞是「cost **breakdown**」(非 series),與 `get_summary()`/
`get_agent_registry()` 的 `current_period_spend`(當月月初至 anchor_date,
TOTAL interval)屬於同一種「單一彙總數字,依維度切分」需求,因此重用
同一個月視窗。兩者視窗不同純粹是延續程式碼裡已經建立、對應相同情境的
既有慣例,不是本文件新發明的產品決策。

### 2. model_cost_breakdown 的 `cost` 在該 model 查無任何成本點時回傳 `null`,不回傳 `0`,即使 TOTAL interval 通常只回一個點

`get_project_metrics_cached()` 的既有慣例(`MetricPoint.value` null 代表
「未知」,見 `opik_metrics.py` 第 65 行註解)是整個程式庫一致遵守的規則;
AC1 也明確把這條規則寫進驗收條件。`agent_detail.py` 對每個 model 的
series 取其唯一(或加總其全部,若後端回超過一點)點值,只要全部點都是
`None` 就回傳 `None`,否則加總非 null 點(與 `cost_overview.py::
_total_cost()` 同一種加總邏輯,但該函式是「完全查無資料」與「資料都是
null」都回 `0.0`,本端點則是兩者都回傳 `None`——因為 AC1 已經把「不要
把 null 誤報成 0」訂為本票應遵守的通則,為了兩個欄位(version 序列、
model 分解)行為一致,沿用同一條規則,不在同一份回應裡對兩個欄位採
不同的 null 處理方式造成前端(SDLCCT-48)誤判)。

### 3. 404 檢查在呼叫任何 Opik 查詢之前執行,且獨立於 502 路徑

`agent_detail.py` 先呼叫 `registry.get_agent(key)`,為 `None` 立刻回傳
`None`(呼叫端轉 404),完全不觸發任何 HTTP 呼叫。這是依照 AC5 字面意思
(「Agent key 不存在」是呼叫端輸入錯誤,不是後端依賴失敗)選擇的順序,
也避免對一個不存在的 key 浪費三次 Opik 查詢。

### 4. `top_traces` 只回傳 `id`/`metadata`/`total_estimated_cost` 三個欄位,不回傳 `TraceSummary.raw` 的其餘內容

`opik_traces.TraceSummary` 只對 `id`/`metadata` 提供型別化保證(SDLCCT-17
決策 #5:其餘欄位未被驗證過,留在 `raw` 裡)。`total_estimated_cost` 雖然
沒有被 `opik_traces.py` 型別化,但它是 AC3 明確指名的排序依據、也是
`bff/tests/test_opik_traces.py` fixture 實際示範存在的欄位,FinOps
reviewer 若看不到這個數字,「top-cost trace list」就失去意義。因此
`agent_detail.py` 用 `trace.raw.get("total_estimated_cost")` 防禦性讀取
(缺欄位或非數字時回傳 `None`,不丟例外、不臆測一定存在),其餘 `raw`
欄位則不透出——跟 `TraceSummary` 本身的型別化範圍保持一致,不替未驗證
欄位做更大膽的保證。

### 5. 不新增 `AgentNotFoundError` 例外類別,用回傳 `None` + 呼叫端 `HTTPException(404)` 表達「找不到」

`get_agent_cost_breakdown()` 回傳 `dict | None` 而非拋例外:這是呼叫端
輸入驗證失敗(找不到 Agent),語意上與「後端查詢失敗」(`OpikClientError`
家族)不同類,不應該共用 502 的 exception-handler 機制,也不需要為了
一個單純的「有/無」結果新增一整個例外類別——FastAPI 在 route function
裡直接 `raise HTTPException(404, ...)` 是框架本身最直接的手段,維持
`app.py` 目前「route function 很薄,business logic 在個別模組」的分工
慣例。

## UI 原型

無,本 Story 不涉及前端 UI。這是純 BFF 後端端點;對應的畫面(Agent
detail screen)由另一張票 SDLCCT-48 負責前端實作與 UI 原型,本票範圍
(spec 已明確標示)只到這一個 HTTP 端點的 response 為止。

## 跨元素樣式耦合測試檢查

本 Story 完全不觸碰 `frontend/`(本票範圍只到 BFF 的一個新 HTTP 端點,
不新增/修改任何前端檔案、selector 或 computed style)。`frontend/`
目錄本身確實存在(含 `frontend/e2e/`,由 SDLCCT-40 建立),但與本票無關
——不適用,原因是本票無前端變更,不是因為 repo 沒有前端。

## 開放設計問題(定稿時必須為空)

(無)
