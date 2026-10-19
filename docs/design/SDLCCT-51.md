# 設計文件 — SDLCCT-51 Anomaly aggregation endpoint (backend) — split from SDLCCT-45

## 對應需求規格

對應 G1 已核准的需求規格「Anomaly aggregation endpoint (backend) — split
from SDLCCT-45」。User Story：Portal backend 需要單一端點,對已註冊與未
註冊的 Agent 執行全部 5 條異常規則(涵蓋 demo 視窗),讓前端能渲染單一
統一的異常 feed。7 條 AC 對應範圍:一般規則(`tool_retry_loop`/
`context_bloat`/`night_batch_burst`)`is_anomalous=True` 時各出一列、
`date=target_date`(AC1);`is_anomalous=False` 時不出列(AC2);
`model_switch` 的 `switch_date` 非 None 且 `is_anomalous=True` 時出一列、
`date=switch_date`(AC3);`switch_date` 為 None 時不出列(AC4);
`find_governance_gaps()` 回傳的 flagged 子集合各出一列、`date=null`
(欄位必須存在、值為 null、絕不省略,AC5);任一規則呼叫拋例外時,回傳
明確的 per-rule/per-agent 錯誤項,絕不悄悄跳過該 Agent,其餘 Agent/規則
繼續處理(AC6);涵蓋率——4 個 target_date/self-date 規則對每個已註冊
Agent 各呼叫一次,`find_governance_gaps` 對全部 Agent id(已註冊+未註冊)
整批呼叫恰好一次(AC7)。

範圍外(spec 已標明,本文件不觸碰):分頁、過濾/排序參數、demo 固定錨點
以外的歷史日期範圍、既有 middleware 之外的 auth/RBAC。依賴的
SDLCCT-27/28/29/30/31(五條規則本體)與 SDLCCT-49(date 欄位對齊:
governance_gap 用 `date=null`、前端顯示「持續中」;model_switch 用
`switch_date`)皆已 Done/resolved,本票只負責把它們組合成單一端點,不
重新實作任何規則邏輯。前端畫面(統一異常 feed 的渲染)是另一張票
SDLCCT-52,本票範圍只到這一個 HTTP 端點的 response 為止。

## 介面/API 契約

新增一個對外 HTTP 端點,掛在既有 `bff/api/app.py`(SDLCCT-32 建立的
FastAPI app)上。**不沿用** `app.py` 既有的 `OpikClientError`/
`OpikConfigError` → 502 exception-handler 慣例:AC6 明確要求「任一規則
呼叫拋例外 → 回傳明確的 per-rule/per-agent 錯誤項,其餘繼續處理」,
也就是這個端點本身必須在 200 OK 回應內表達個別規則失敗,而不是讓整個
請求失敗 502(見下方「關鍵技術決策」第 1 條)。

```
GET /api/anomalies

Query params: 無(spec 明確排除分頁/過濾/排序參數)

Response 200 (application/json):
{
  "anchor_date": "YYYY-MM-DD",
  "anomalies": [
    {
      "agent": "<registry key>" | null,
      "anomaly_type": "tool_retry_loop" | "context_bloat" | "night_batch_burst"
                       | "model_switch" | "governance_gap",
      "date": "YYYY-MM-DD" | null,
      "status": "ok" | "error",
      "reason": "<human-readable string>"
    },
    ...
  ]
}
```

- `anchor_date`:`anchor.get_anchor_date()` 的日期部分(與既有端點同一個
  值),同時也是 4 個 target_date/self-date 規則呼叫時使用的 `target_date`
  (AC1 用詞 "target_date" 與既有端點用詞 "anchor_date" 是同一個值,回應
  只用一個欄位名稱,見決策 #2)。
- `status="ok"`:成功呼叫且判定為異常(`is_anomalous=True`,或
  governance_gap 的 flagged 子集合),對應 AC1/AC3/AC5 的列。
  `status="error"`:該次規則呼叫拋出例外,對應 AC6 的列;`reason` 欄位
  此時是 `str(exc)`(例外訊息),`date` 一律為 `null`(無法得知該次呼叫
  本應填入什麼日期)。
- `date` 欄位永遠存在,`null` 時絕不省略該 key(沿用 AC5 的字面規則,
  並統一套用到全部 5 種 anomaly_type 與 `status="error"` 的列,見決策
  #3)。
- `agent` 在 `anomaly_type="governance_gap"` 且 `status="error"` 時為
  `null`(`find_governance_gaps()` 是整批呼叫,失敗時沒有單一 Agent 可
  歸因,見決策 #4);其餘情況下 `agent` 一律是該 Agent 的 registry key。
- `is_anomalous=False`(一般規則)或 `switch_date=None`(model_switch)
  不出列(AC2/AC4),成功但「不是異常」的 finding 完全不進入回應。

### 新增模組位置

- `bff/api/anomalies.py`(新檔案,業務邏輯):`get_anomaly_feed() -> dict`。
  依循 `bff/api/agents.py`/`bff/api/agent_detail.py`(SDLCCT-43/47)已建立
  的慣例:sys.path 插入 `seed/` 以 import `registry.load_registry`,import
  `anchor.get_anchor_date`。直接 import 五個規則模組的 `detect_*`/
  `find_governance_gaps` 函式與各自的 Finding dataclass。
  - 計算一次共用的 `target_date`/`interval_start`/`interval_end`(見決策
    #5),對每個「已註冊」Agent(`load_registry()` 中 `registered is
    True` 的 key)依序呼叫 `detect_tool_retry_loop`/`detect_context_bloat`/
    `detect_night_batch_burst`(帶 `target_date`)與
    `detect_model_switch`(不帶 `target_date`,只帶
    `interval_start`/`interval_end`),各自獨立包一層
    `try/except Exception`(AC6 要求「任一規則呼叫」,不只既有
    `OpikClientError`/`OpikConfigError` 家族,也涵蓋
    `MissingErrorRateDataError`/`InsufficientBaselineDataError`/
    `InsufficientSwitchWindowDataError`/`ValueError` 等規則自身定義的
    例外,見決策 #1),失敗則 append 一列 `status="error"`,成功則依
    `is_anomalous`/`switch_date` 決定是否 append 一列 `status="ok"`。
  - 對 `find_governance_gaps(all_keys, ...)`(`all_keys` = 全部 registry
    key,不篩 `registered`,AC7)整體包一層 `try/except Exception`,
    失敗 append 一列 `agent=null` 的 `status="error"`;成功則對回傳的
    flagged 子集合逐一 append `status="ok"` 列。
  - 每種 anomaly_type 的 `reason` 字串組法,見下方決策 #6(逐規則列出
    使用哪些 Finding 欄位)。
- `bff/api/schemas.py`(既有檔案,只新增,不更動既有類別):新增
  `AnomalyRow`、`AnomalyFeedResponse` 兩個 Pydantic 類別。
- `bff/api/app.py`(既有檔案,只新增一個 route function,不更動既有
  route/handler):
  ```python
  from .anomalies import get_anomaly_feed
  from .schemas import AnomalyFeedResponse

  @app.get("/api/anomalies", response_model=AnomalyFeedResponse)
  def anomalies_feed() -> dict:
      return get_anomaly_feed()
  ```

## 資料模型

無新增資料模型。本 Story 是純讀取組合(read-composition):把五個既有
規則模組(`anomaly_tool_retry_loop.py`/`anomaly_context_bloat.py`/
`anomaly_night_batch_burst.py`/`anomaly_model_switch.py`/
`anomaly_governance_gap.py`,皆為 SDLCCT-27/28/29/30/31 已核准並實作
完成)與 `seed/registry.py` 的 Agent 清單組成單一回應,沒有新建資料表、
欄位、索引,也沒有任何寫入或持久化狀態。`AnomalyRow`/
`AnomalyFeedResponse` 是 Pydantic model,生命週期僅限一次 HTTP 請求,
與 SDLCCT-32/38/43/47 的資料模型決策一致。

## 關鍵技術決策

### 1. `get_anomaly_feed()` 內部捕捉每一次規則呼叫的 `Exception`,不重用 `app.py` 既有的 502 exception-handler 慣例

這是本票與 SDLCCT-32/43/47 既有慣例(讓 `OpikClientError`/
`OpikConfigError` 原樣往上拋、由 `app.py` 的 handler 轉 502)刻意不同
之處:AC6 字面要求「任一規則呼叫拋例外 → 回傳明確的 per-rule/per-agent
錯誤項,其餘 Agent/規則繼續處理」,也就是單一規則失敗不能讓整個 HTTP
請求失敗——這是 spec 本身對錯誤處理形狀的明確要求,不是本文件自行決定
偏離既有慣例。捕捉範圍用 `except Exception`(而非只列舉
`OpikClientError`/`OpikConfigError`):五個規則模組各自定義了專屬例外
類別(`MissingErrorRateDataError`/`InsufficientBaselineDataError`/
`InsufficientSwitchWindowDataError`,以及 `anomaly_night_batch_burst.py`
的裸 `ValueError`),AC6 的「任一規則呼叫」沒有把這些排除在外,逐一列舉
容易隨規則演進而漏網,`except Exception` 更貼近 AC 的字面範圍。

### 2. 回應只用一個 `anchor_date` 欄位,不額外重複一個 `target_date` 欄位

AC1 用詞是 "target_date",但這個值與既有端點(`agents.py`/
`cost_overview.py`)回應裡的 `anchor_date` 是同一個
`anchor.get_anchor_date()` 日期——4 個 target_date/self-date 規則呼叫時
內部確實是用 `target_date` 當參數名,但這只是呼叫底層規則函式時的參數
命名,不代表回應必須重複兩個同值欄位讓前端困惑哪個才是權威來源。

### 3. `date` 欄位一律存在、值為 `null` 時絕不省略,統一套用到全部 5 種 `anomaly_type` 與 `status="error"` 的列,不只 AC5 字面指定的 governance_gap

AC5 只明文針對 governance_gap 要求這條規則,但回應是單一陣列
(`anomalies`),前端(SDLCCT-52)需要對每一列都能安全讀取
`row["date"]` 而不必先判斷 `anomaly_type` 才知道這個 key 存不存在——
如果只對 governance_gap 套用「欄位永遠存在」、其餘列在 `date` 為
`null` 時省略該 key,會讓同一個陣列裡的列有不一致的欄位集合。套用
既有「null 代表未知,絕不省略欄位」慣例(`opik_metrics.py`
`MetricPoint.value` 的同一條規則,也是 SDLCCT-47 決策 #2 延續的通則)
到整個 `anomalies` 陣列,是介面一致性的直接延伸,不是新的產品決策。

### 4. `find_governance_gaps()` 整批呼叫失敗時,錯誤列的 `agent` 為 `null`

AC7 明確說 `find_governance_gaps` 是「對全部 Agent id 的單一整批呼叫」
(不是逐 Agent 呼叫),所以失敗時沒有單一 Agent 可以歸因——`agent=null`
是這個批次呼叫形狀下最直接的表達,不是省略錯誤資訊,`anomaly_type`
欄位仍然是 `"governance_gap"`、`reason` 仍然是該次例外的訊息,一樣滿足
AC6「不悄悄跳過、仍給出明確錯誤項」的要求。

### 5. 全部規則呼叫共用同一組 `interval_start`/`interval_end`(`anchor_date - 22 天` 到 `anchor_date`),不為每個規則另開各自的查詢窗口

Spec 沒有指定查詢窗口長度。5 條規則裡,4 個預設 `baseline_window_days`
是 21 天(`tool_retry_loop`/`context_bloat`/`night_batch_burst`),
`model_switch` 沒有 `baseline_window_days` 參數但一樣需要足夠長的歷史
視窗才能偵測到 `switch_date`;`bff/tests/test_anomaly_context_bloat.py`
等既有測試檔已確立 `interval_start = target_date - 22 天`(21 天 baseline
+ target_date 當天本身)、`interval_end = target_date` 這組窗口慣例。
本端點直接重用這組既有、已驗證過的窗口定義給全部規則呼叫(包含
`find_governance_gaps` 的 `get_workspace_daily_costs` 查詢),不為
`model_switch` 或 `governance_gap` 另外發明一組窗口長度——延續
SDLCCT-47 決策 #1「沿用既有慣例而非新發明時間窗」的同一個做法。

### 6. 各 `anomaly_type` 的 `reason` 字串組成欄位(逐規則列出,對應各
Finding dataclass 的實際欄位名稱)

- `tool_retry_loop`(`ToolRetryLoopFinding`):`error_rate`、
  `error_rate_threshold`、`comparison.deviation_ratio`、
  `comparison.baseline_value`、`comparison.actual_value`、
  `ratio_threshold`。
- `context_bloat`(`ContextBloatFinding`):`comparison.deviation_ratio`、
  `comparison.baseline_value`、`comparison.actual_value`、
  `deviation_threshold`。
- `night_batch_burst`(`NightBatchBurstFinding`):
  `off_hours_window_utc`、`ratio`、`off_hours_trace_count`、
  `baseline_hourly_rate`、`ratio_threshold`、`corroborating_workflow`。
- `model_switch`(`ModelSwitchFinding`):`before_model_tag`、
  `after_model_tag`、`switch_date`、`deviation_ratio`、
  `deviation_threshold`(AC3 字面要求的欄位組合)。
- `governance_gap`(`GovernanceGapFinding`):`registered`、`owner`、
  `budget`、`first_day_cost`、`last_day_cost`(AC5 字面要求的欄位組合)。

全部欄位皆取自對應 Finding dataclass 的既有屬性,不新增任何規則模組
未提供的衍生數字,`reason` 純粹是這些既有欄位的可讀字串化。

## UI 原型

無,本 Story 不涉及前端 UI。這是純 BFF 後端端點;對應的統一異常 feed
畫面由另一張票 SDLCCT-52 負責前端實作與 UI 原型,本票範圍(spec 已明確
標示)只到這一個 HTTP 端點的 response 為止。

## 跨元素樣式耦合測試檢查

本 Story 完全不觸碰 `frontend/`(本票範圍只到 BFF 的一個新 HTTP 端點,
不新增/修改任何前端檔案、selector 或 computed style)。`frontend/` 目錄
本身確實存在(含 `frontend/e2e/`,由 SDLCCT-40 建立),但與本票無關——
不適用,原因是本票無前端變更,不是因為 repo 沒有前端。

## 開放設計問題(定稿時必須為空)

(無)
