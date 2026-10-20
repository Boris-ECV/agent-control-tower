# 設計文件 — SDLCCT-55 Trace spans endpoint (BFF)

## 對應需求規格

對應 G1 已核准的需求規格「Trace spans endpoint (BFF)」：一個 BFF 端點，
以 agent key + trace_id 取得該筆執行的完整 span 樹狀結構，讓前端執行
詳情畫面（SDLCCT-56）可以直接消費組裝好的資料。5 條 AC 對應範圍：
有效 key/trace_id 查詢成功回傳樹狀結構（Scenario 1）；key 不存在
registry 回傳 404 且不查 Opik（Scenario 2）；trace_id 查無 span 回傳
200 空陣列而非 404/502（Scenario 3）；底層 Opik 查詢失敗（逾時/非 2xx/
格式不符）回傳 502，沿用既有例外 handler（Scenario 4）；同名重複子
span 保留順序與完整資料、不去重折疊（Scenario 5）。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：SDLCCT-56 的前端頁面/
路由/元件；metadata 篩選的 trace 搜尋（SDLCCT-20）；trace/span 的任何
寫入或標註；後端去重/折疊/計數彙總；多頁查詢迴圈；對 span raw 內除
id/parent_span_id 外欄位的逐位元組驗證。

依賴：`bff/opik_spans.py`（SDLCCT-53，已 Done）提供
`get_trace_spans()`/`build_span_tree()`；`bff/api/agent_detail.py`
（SDLCCT-47）與 `bff/api/app.py`（SDLCCT-32/47）確立的「registry 查
key → 呼叫 opik_* 函式 → 讓 OpikClientError/OpikConfigError 冒泡給既有
app-level exception handler」慣例，直接沿用，不新增 handler。

## 介面/API 契約

### 路由：`GET /api/agents/{key}/traces/{trace_id}/spans`

與 `bff/api/app.py` 既有 `GET /api/agents/{key}/cost-breakdown` 同一層
資源命名慣例（`/api/agents/{key}/<子資源>`），再接一層 `traces/{trace_id}`
表示「某 agent 底下某一筆 trace 的子資源」——`key` 與 `trace_id` 都是
路徑參數（不是 query string），因為兩者都是識別資源本身的必要值，不是
可選篩選條件，與 `opik_spans.get_trace_spans(project_name, trace_id)`
兩個參數皆為必要、無預設值的簽章一致。規格原文本身即建議此路徑，確認
與既有路由風格相容，採用。

請求參數：
- `key`（路徑參數，str）：agent registry key，等同 `project_name`
  （沿用 `agent_detail.py` 已確立的「registry key == Opik project_name」
  慣例，不新增轉換層）。
- `trace_id`（路徑參數，str）：Opik trace id，逐字傳給
  `get_trace_spans(project_name=key, trace_id=trace_id)`。

回應（200，Scenario 1/3 共用同一個 response_model）：

```json
{
  "key": "agent-a",
  "trace_id": "trc_123",
  "spans": [
    {
      "id": "spn_1",
      "parent_span_id": null,
      "name": "root-chain",
      "type": "general",
      "start_time": "2026-10-01T00:00:00Z",
      "end_time": "2026-10-01T00:00:05Z",
      "children": [
        {
          "id": "spn_2",
          "parent_span_id": "spn_1",
          "name": "search-tool",
          "type": "tool",
          "start_time": "2026-10-01T00:00:01Z",
          "end_time": "2026-10-01T00:00:02Z",
          "children": []
        },
        {
          "id": "spn_3",
          "parent_span_id": "spn_1",
          "name": "search-tool",
          "type": "tool",
          "start_time": "2026-10-01T00:00:02Z",
          "end_time": "2026-10-01T00:00:03Z",
          "children": []
        }
      ]
    }
  ]
}
```

- Scenario 3（trace_id 查無 span）：`spans: []`，HTTP 200，與「查詢失敗」
  (502) 明確區分——見下方關鍵技術決策 #2。
- Scenario 5（同名重複子 span）：上例 `spn_2`/`spn_3` 同名、同一父節點，
  兩者各自以獨立節點出現在 `children` 陣列中，順序與
  `build_span_tree()` 輸出順序（即輸入清單出現順序）完全一致，未做
  任何去重或折疊。

狀態碼對照：

| 情境 | 狀態碼 | 回應內容 |
|---|---|---|
| key 存在、trace_id 有 1 筆以上 span | 200 | 樹狀 `spans` 陣列（如上例） |
| key 存在、trace_id 查無 span | 200 | `spans: []` |
| key 不存在 registry | 404 | `{"detail": "Agent '<key>' not found"}`（沿用 `app.py` 既有 `HTTPException` 慣例，逐字比照 `agent_cost_breakdown` 的訊息格式） |
| Opik 查詢逾時/非 2xx/格式不符 | 502 | 既有 `OpikClientError`/`OpikConfigError` exception handler 原樣輸出（`{"error": {"message": ..., "endpoint": ..., "status_code": ...}}`），不新增 handler |

## 資料模型

無新增持久化資料模型。新增的是回應層 Pydantic schema（`bff/api/schemas.py`
新增，記憶體內回應型別，生命週期僅限單次請求）：

```python
class SpanTreeNode(BaseModel):
    id: str
    parent_span_id: str | None
    name: str | None
    type: str | None
    start_time: str | None
    end_time: str | None
    children: list["SpanTreeNode"]

SpanTreeNode.model_rebuild()  # 自我參照型別需要這行才能解析 forward ref


class TraceSpansResponse(BaseModel):
    key: str
    trace_id: str
    spans: list[SpanTreeNode]
```

`name`/`type`/`start_time`/`end_time` 皆宣告為 `| None` 並從
`SpanSummary.raw`（`bff/opik_spans.py` 的既有逃生艙欄位）以
`raw.get(...)` 取出：這四個欄位不在 `SpanSummary`/`SpanNode` 的型別化
屬性中（SDLCCT-53 刻意只對 `id`/`parent_span_id` 建立型別化保證，見
該票設計文件決策 #1），本 Story 的 AC1 要求「每個節點至少可讀出」
這四個欄位，但沒有要求在欄位缺失時報錯——因此用 `.get(key)` 取值、
缺失時回傳 `None`（Pydantic 允許），不拋例外、不臆測一定存在。

## 關鍵技術決策

### 1. 業務邏輯函式 `get_trace_span_tree(key, trace_id) -> dict | None`
放在新檔 `bff/api/trace_spans.py`，而非塞進既有 `agent_detail.py`

沿用 `agent_detail.py`/`cost_overview.py`/`anomalies.py` 的既有切分
原則：一個端點對應一個業務邏輯模組（「依端點家族分檔」），`trace_id`
子資源與 cost-breakdown 是完全不同的資料面向，沒有理由合併。回傳
`None` 代表「key 不在 registry」，由 `app.py` 路由層映射成 404——與
`get_agent_cost_breakdown()` 回傳 `None` 的既有模式完全一致，不另創
新慣例。

### 2. 200-空陣列（trace_id 查無 span）與 404（key 不存在）、502（查詢
失敗）三者如何在程式碼層面明確分流，不互相污染

`get_trace_span_tree()` 內部順序：
1. `record = get_agent(key)`；`record is None` → 回傳 `None`（路由層
   404），**在呼叫 `get_trace_spans()` 之前**，確保 Scenario 2「未對
   Opik 發出任何查詢」成立。
2. `spans = get_trace_spans(project_name=key, trace_id=trace_id)`——
   這一步若底層 HTTP 非 2xx/逾時/格式不符，直接拋
   `OpikHTTPError`/`OpikTimeoutError`/`OpikResponseFormatError`
   （均為 `OpikClientError` 子類），**不在本函式內捕捉**，讓它冒泡到
   `app.py` 既有的 `_opik_client_error_handler` → 502（Scenario 4）。
3. 若 `get_trace_spans()` 正常回傳（即使是空 tuple——Opik 後端對「trace
   查無 span」的既有回應就是 `content: []`，不是非 2xx），
   `build_span_tree(spans)` 對空輸入回傳空 tuple（SDLCCT-53 已驗證的
   行為），本函式原樣包成 `spans: []`、狀態碼 200（Scenario 3）。
   關鍵在於：**空清單和查詢失敗是兩條完全不同的程式碼路徑**——前者是
   `get_trace_spans()` 的正常回傳值，後者是例外——不存在「空清單究竟
   算失敗還是沒資料」的執行期判斷，因為兩者在 `opik_spans.py` 層就已
   經是不同的回傳型態（回傳值 vs. 例外），本端點只是如實轉譯，不需要
   新增判斷邏輯。

### 3. 樹狀遞迴轉換（`SpanNode` → `SpanTreeNode`）在路由/業務邏輯層手動
遞迴，不嘗試讓 Pydantic 直接吃 `SpanNode` dataclass

`SpanNode`/`SpanSummary` 是 immutable dataclass（SDLCCT-53 設計），
`children` 型別是 `tuple[SpanNode, ...]`，而 Pydantic 的
`response_model` 序列化比較適合明確吃 `dict`/`BaseModel` 樹，不直接
賦予 dataclass 任意欄位存取彈性。因此新增一個純函式
`_to_tree_node(node: SpanNode) -> dict`，遞迴把每個 `SpanNode` 轉成
`{"id":..., "parent_span_id":..., "name": node.span.raw.get("name"),
"type": node.span.raw.get("type"), "start_time": node.span.raw.get("start_time"),
"end_time": node.span.raw.get("end_time"), "children": [_to_tree_node(c) for c in node.children]}`，
再整包回傳給 FastAPI 的 `response_model=TraceSpansResponse` 做最終
序列化/型別檢查——與 `agent_detail.py` 現有模式（業務邏輯函式回傳
plain dict，FastAPI 用 `response_model` 做序列化）完全一致，不新增
序列化慣例。

### 4. 錯誤處理完全重用既有 exception handler，不新增 handler、不在本
端點內 `try/except` 吞掉任何 `OpikClientError`/`OpikConfigError`

規格 Scenario 4 明文要求「沿用既有 OpikClientError/OpikConfigError 的
exception handler 形狀（不新增 handler）」。`app.py` 現有
`_opik_client_error_handler`/`_opik_config_error_handler` 已涵蓋全部
`OpikHTTPError`/`OpikTimeoutError`/`OpikResponseFormatError`/
`OpikConfigError`（`opik_spans.get_trace_spans()` 可能拋出的全部例外
類型都是前三者之一），因此本端點的路由函式與業務邏輯函式都不攔截這些
例外，任其冒泡——與 `agent_cost_breakdown`/`budget_simulation` 既有
路由函式的寫法一致。

## UI 原型

無，本 Story 不涉及前端 UI——這是純後端 BFF 端點，沒有新增或變更任何
畫面、元件或樣式。畫面本身（執行詳情）是下一張票 SDLCCT-56 的範圍，其
UI 技術選型非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——純後端 API 新增，
不觸碰 `frontend/` 下任何元件/頁面。已檢查 `frontend/e2e/`
（`cost-dashboard.spec.ts`、`i18n-cost-dashboard-strings.spec.ts`）：
`Grep("toEqual|一致|consistent", path="frontend/e2e")` 無相關結果，
不存在跨元素樣式一致性的鏈式斷言。不適用。

## 開放設計問題（定稿時必須為空）

（無）
