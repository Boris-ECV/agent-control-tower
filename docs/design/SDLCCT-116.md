# 設計文件 — SDLCCT-116 Trace spans endpoint 擴充廠別/版本/部門/觸發方式/預估成本

## 對應需求規格

G1 核准版本（拆分自 SDLCCT-87 原始範圍第 2、3 條的資料來源）。3 條
Gherkin AC：

1. trace 落在放大後排行榜範圍內、Opik 有對應 metadata/成本時，
   `GET /api/agents/{key}/traces/{trace_id}/spans` 回應額外含
   `plant`/`deployed_version`/`dept`/`trigger`/`total_estimated_cost`
   五個欄位，值與 Opik 一致。
2. 查無 metadata/成本，或 trace 超出放大後排行榜範圍時，對應欄位回傳
   `null`，不臆測 `0` 或空字串。
3. 既有 SDLCCT-55/56 測試案例（spans 樹狀結構／404／502）完全不受影
   響，只新增欄位。

**單一 trace 查詢機制**（已依 HUMAN-INPUT SDLCCT-119 選項 B 定稿）：
沿用既有 `get_top_traces_by_cost`，放大 `size` 後以 `trace_id` 線性比
對，**不保證涵蓋任意 trace_id**——超出放大後範圍視為「查無資料」而非
錯誤，回傳 `null`（見下方決策 1 的 size 數值與決策 2 的「查無 vs. 查
詢失敗」分流）。

**範圍外**（已於 G1 核准，不可擴大，本文件不觸碰）：agent key/display
name（沿用既有 route/registry）；spans 樹狀結構本身的任何異動；任何前
端畫面（消費方為 SDLCCT-117）；通用的「依 trace_id 直接查詢任意
trace」機制（超出本票範圍）。

**依賴**：SDLCCT-55（已 Done，baseline 端點，`bff/api/trace_spans.py`）；
`bff/opik_traces.py`（SDLCCT-17，`get_top_traces_by_cost`/
`TraceSummary`，已 Done）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `bff/api/trace_spans.py::get_trace_span_tree(key, trace_id)`：目前
  只呼叫 `get_agent`（404 判斷）→ `get_trace_spans` → `build_span_tree`，
  回傳 `{key, trace_id, spans}`。本票在同一函式內追加一次
  `opik_traces` 查詢，組裝五個新欄位後一併回傳，不新增路由層判斷。
- `bff/opik_traces.py::get_top_traces_by_cost(project_name, *, size)` /
  `TraceSummary(id, metadata, raw)`：`raw` 保留後端 `/v1/private/traces`
  單筆完整內容（SDLCCT-17 既有「逃生艙欄位」慣例），`total_estimated_
  cost` 本身未被設為 `TraceSummary` 的型別化屬性，只存在於 `raw` 中，
  取值方式需沿用 `.get()`（見下方資料模型段落）。`DEFAULT_TOP_TRACES_
  SIZE = 10`（供 `agent_cost_breakdown`/`get_agent_cost_breakdown` 的
  `top_n` 預設值使用，與本票的放大 size 是兩個不同用途的常數，不可混
  用——見決策 1）。
- `seed/generate.py` 第 142-151 行：trace 的 `metadata` 實際欄位為
  `{plant, deployed_version, cost_center, workflow, trigger, dept}`——
  確認 `plant`/`deployed_version`/`dept`/`trigger` 四個 key 名稱與規格
  要求的欄位名稱完全一致，直接以 `metadata.get(<key>)` 取值即可，不需
  要任何欄位改名/轉換層。
- `bff/api/schemas.py::TraceSpansResponse`：目前只有
  `{key, trace_id, spans}` 三個欄位，無 `response_model` 以外的序列化
  邏輯；新增欄位直接加在這個既有 `BaseModel` 上。
- `bff/api/app.py` 第 112-120 行 `agent_trace_spans` 路由函式：直接把
  `get_trace_span_tree()` 回傳的 dict 交給 FastAPI
  `response_model=TraceSpansResponse` 序列化，404 判斷不變——本票不修
  改這段路由函式。
- `bff/tests/test_opik_traces.py`／`bff/tests/test_api_trace_spans.py`
  （若存在）：既有測試以 `monkeypatch` 替換
  `get_top_traces_by_cost`/`get_trace_spans`，本票新增的呼叫同樣可用
  相同手法 stub，不影響既有測試的替換方式。
- 全 repo 搜尋 `toEqual|getComputedStyle|一致`（流程第 4 步跨元素樣式
  耦合檢查）：本票不觸碰 `frontend/` 任何檔案，純後端 BFF 端點擴充，
  不適用——與 SDLCCT-55 現況盤點結論一致。

## 介面/API 契約

### 路由：`GET /api/agents/{key}/traces/{trace_id}/spans`（不變，沿用
SDLCCT-55 既有路由，僅擴充回應 body）

請求參數不變（`key`/`trace_id` 皆為路徑參數，沿用 SDLCCT-55 契約）。

回應（200）新增五個欄位，與既有 `spans` 同層：

```json
{
  "key": "agent-a",
  "trace_id": "trc_123",
  "spans": [ ... 既有樹狀結構，完全不變 ... ],
  "plant": "台中廠",
  "deployed_version": "v3.1",
  "dept": "品保部",
  "trigger": "scheduler",
  "total_estimated_cost": 12.3456
}
```

- Scenario 1：五個新欄位的值與該 trace 在 Opik 的 `metadata.plant`/
  `metadata.deployed_version`/`metadata.dept`/`metadata.trigger`/
  `total_estimated_cost` 逐一對應。
- Scenario 2：trace 沒有 metadata（`metadata` 為 `null`）、沒有
  `total_estimated_cost`，或 trace_id 不在放大後的 `get_top_traces_
  by_cost` 結果中——以上任一情況，對應欄位各自回傳 `null`，不回傳
  `0`/`""` 替代（逐欄位獨立判斷：例如 metadata 存在但缺
  `cost_center`——本票不用到——不影響其他四個欄位各自是否有值）。
- Scenario 3：`spans`/404/502 既有行為完全不變，狀態碼對照表沿用
  SDLCCT-55 原表，不新增列。

狀態碼對照（延續 SDLCCT-55，新增一列說明放大查詢失敗時的行為）：

| 情境 | 狀態碼 | 回應內容 |
|---|---|---|
| key 存在、trace_id 有 spans | 200 | 既有 `spans` 樹狀結構 + 五個新欄位（任一欄位查無資料回傳 `null`） |
| key 存在、trace_id 查無 span | 200 | `spans: []` + 五個新欄位（通常也是 `null`，但仍各自依放大查詢結果獨立判斷） |
| key 不存在 registry | 404 | 不變（沿用 SDLCCT-55 原始訊息格式） |
| `get_trace_spans()` 查詢逾時/非 2xx/格式不符 | 502 | 不變（沿用 SDLCCT-55 原始 handler） |
| `get_top_traces_by_cost()` 查詢逾時/非 2xx/格式不符 | 502 | 新增：與上一列用同一個既有 `OpikClientError`/`OpikConfigError` exception handler，不新增 handler（見決策 2） |

## 資料模型

無新增持久化資料模型。擴充既有回應層 Pydantic schema
（`bff/api/schemas.py::TraceSpansResponse`）：

```python
class TraceSpansResponse(BaseModel):
    key: str
    trace_id: str
    spans: list[SpanTreeNode]
    plant: str | None
    deployed_version: str | None
    dept: str | None
    trigger: str | None
    total_estimated_cost: float | None
```

五個欄位全部宣告為 `| None`（缺值回傳 `null`，不臆測 `0`/`""`，AC2 字
面要求）。`plant`/`deployed_version`/`dept`/`trigger` 從
`TraceSummary.metadata`（已型別化為 `dict[str, Any] | None`）用
`.get(key)` 取出；`total_estimated_cost` 從 `TraceSummary.raw.get(
"total_estimated_cost")` 取出——這個欄位本身不在 `TraceSummary` 的型
別化屬性中（只有 `id`/`metadata` 是），沿用 SDLCCT-55 決策「對未型別
化欄位一律用 `.get()`、缺失回傳 `None`、不拋例外」的既有慣例（當時用
在 `SpanSummary.raw` 的 `name`/`type`/`start_time`/`end_time`，這裡
是同一模式套用在 `TraceSummary.raw`）。

## 關鍵技術決策

### 1. 放大後的 `size` 定為 `500`（新常數 `bff/opik_traces.py::
ENLARGED_TRACE_LOOKUP_SIZE = 500`），與既有 `DEFAULT_TOP_TRACES_SIZE =
10`（UI 列表用）分開，不共用同一個常數

本票需求與既有 `agent_cost_breakdown` 的 `top_n=10` 用途完全不同：後
者是「畫面顯示前 10 筆」的產品決定，本票是「盡量提高單筆 trace_id 落
在查詢範圍內的機率」的技術折衷，兩者未來各自可能獨立調整，混用同一個
常數會讓其中一邊的調整意外影響另一邊。`500` 的選擇依據：
- `seed/generate.py`（`HISTORY_DAYS = 30`）為每個 agent 產生約 30 天
  的合成流量，單一 agent 的 trace 總量通常落在數百到數千筆量級，
  `500` 能覆蓋其中「依成本排序後較靠前」的相當一部分，同時仍是個位數
  倍數於既有 `DEFAULT_TOP_TRACES_SIZE`（50 倍），不是沒有根據的武斷值。
- 沿用 SDLCCT-17 決策 #4／SDLCCT-53 決策（`get_trace_spans` size=200）
  已確立的「單次請求、不做多頁迴圈」慣例——`500` 仍是一次 `GET
  /v1/private/traces` 請求的 `size` 參數，不新增分頁邏輯，與
  `get_trace_spans` 現有 `DEFAULT_TRACE_SPANS_SIZE = 200` 同屬「單次
  請求可接受的上限量級」，不是等比外插到更大的數字。
- **此值不保證涵蓋任意 trace_id**（規格已明文接受此限制，HUMAN-INPUT
  SDLCCT-119 選項 B 定稿）：超出範圍的 trace 依 Scenario 2 規則回傳
  `null`，不是本設計要解決的問題，也不是本票要追求「调大到能涵蓋所有
  情況」的目標——那正是規格明文劃為範圍外、需另開票評估 Opik 端
  「依 trace_id 直接查詢」API 的理由。

### 2. 新增的 `get_top_traces_by_cost()` 查詢若失敗（逾時/非 2xx/格式
不符），讓例外原樣冒泡成 502，不吞掉改回傳 `null`

AC2 的「查無資料回傳 `null`」明確限定在「沒有 metadata/成本」或「trace
不在放大後範圍內」這兩種**正常的空結果**，不包含「查詢本身失敗」。沿
用 SDLCCT-55 決策 #2 已確立的核心原則——「空清單/查無資料」與「查詢
失敗」是完全不同的程式碼路徑（前者是函式正常回傳值，後者是例外）——
本票新增的這次 Opik 查詢同樣遵守這條既有分流規則：`get_top_traces_
by_cost()` 拋出的 `OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError` 不在 `get_trace_span_tree()` 內攔截，直接
冒泡給 `app.py` 既有的 `_opik_client_error_handler` → 502（與
`get_trace_spans()` 失敗時完全相同的既有 502 shape，不新增 handler，
AC3「502 既有行為不變」因此只是「這條既有錯誤處理路徑現在也覆蓋第二
次查詢」，不是新增一條不同形狀的錯誤處理）。若把查詢失敗也吞成
`null`，會讓前端把「Opik 暫時打不通」誤判成「這筆 trace 真的沒有
metadata」，違反規格「不臆測」的精神，也會讓本該觀測到的後端故障被
靜默吃掉。

### 3. 新增輔助函式 `get_trace_summary_by_id()` 放在 `bff/opik_traces.
py`（而非 `bff/api/trace_spans.py`），以線性掃描比對 `trace_id`

```python
def get_trace_summary_by_id(
    project_name: str,
    trace_id: str,
    *,
    size: int = ENLARGED_TRACE_LOOKUP_SIZE,
) -> TraceSummary | None:
    for t in get_top_traces_by_cost(project_name, size=size):
        if t.id == trace_id:
            return t
    return None
```

沿用 `bff/opik_spans.py` 把 `build_span_tree()`（純函式、網路無關的
資料整形）與 `get_trace_spans()`（網路呼叫）放在同一個 client 模組的
既有切分慣例——`get_trace_summary_by_id()` 同樣是「對同一支 client
函式的結果做一次純記憶體內查找」，與 `get_top_traces_by_cost()` 同屬
一個資料面向（trace 層級的 metadata/成本），放在 `opik_traces.py` 比
放進 `bff/api/trace_spans.py`（業務邏輯層，依端點家族分檔，SDLCCT-55
決策 #1）更符合既有的「client 模組對外曝露完整查詢能力，業務邏輯層只
組裝」分工。查無符合 `trace_id` 的項目回傳 `None`（不是空
`TraceSummary`），呼叫端（`get_trace_span_tree()`）據此把五個新欄位全
部設為 `None`——與決策 2 的「查無資料」路徑共用同一個 `None` 訊號。

### 4. `get_trace_span_tree()` 內兩次 Opik 查詢（`get_trace_spans()` 與
`get_trace_summary_by_id()`）各自獨立呼叫，不共用快取、不互相依賴對
方成功

兩者查詢的是完全不同的 Opik 端點（`/v1/private/spans` vs.
`/v1/private/traces`），語意上互相獨立——即使放大排行榜查詢找不到這筆
trace（`None`），spans 樹狀結構仍應正常回傳（AC3 要求 spans 行為不
變）；反之 spans 查詢失敗已經是既有的 502 路徑，不會執行到第二次查
詢。因此函式內維持「依序呼叫、各自處理各自的回傳值/例外」的直觀寫
法，不引入任何快取層或共用 session 之類的最佳化——規模估計本票僅
0.5–1 人日，且兩個端點目前都是單次 `httpx` 呼叫，不構成效能問題，不
預先設計未被要求的最佳化。

## UI 原型

無，本 Story 不涉及前端 UI——純後端 BFF 端點擴充欄位，沒有新增或變
更任何畫面、元件或樣式。消費這些新欄位渲染標籤列/摘要列是另一張拆分
子單 SDLCCT-117 的範圍，其 UI 技術選型非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——純後端 API 欄位
新增，不觸碰 `frontend/` 下任何元件/頁面/測試。已依流程第 4 步規則對
全 repo 執行 `Grep("toEqual|getComputedStyle|一致")`；本票的變更範圍
（`bff/opik_traces.py`、`bff/api/trace_spans.py`、
`bff/api/schemas.py`）完全在搜尋範圍之外，不存在任何相關的跨元素樣式
一致性鏈式斷言。不適用——與 SDLCCT-55/109/111 現況盤點結論一致。

## 開放設計問題（定稿時必須為空）

無。「放大後 size 數值」（決策 1）與「查詢失敗 vs. 查無資料的分流」
（決策 2）雖是規格未逐字給出數字/程式碼層級細節，但單一 trace 查詢機
制本身已由 HUMAN-INPUT SDLCCT-119 選項 B 定稿，size 數值與錯誤分流屬
於本票設計階段的技術折衷，可直接由規格明文（「不保證涵蓋任意
trace_id」「查無資料回傳 null，不視為錯誤」）與既有程式碼慣例
（SDLCCT-17/53/55 的既有決策）推導定案，不構成需要另開 HUMAN-INPUT 的
產品決策。
