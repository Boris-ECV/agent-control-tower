# 設計文件 — SDLCCT-46 Budget and savings simulation screen（Portal MVP，畫面 6/6）

## 對應需求規格
對應 G1 已核准的需求規格「預算與節省模擬畫面」。使用者故事：使用者選定一個
已登錄 Agent（視窗固定 `HISTORY_DAYS=30`），再指定一個目標模型
（`target_model`），系統計算該 Agent「若改用目標模型」的推算成本與預估月省，
協助判斷是否值得換模型。7 條 AC：(1) `current_effective_rate` = 該 Agent整個
視窗 COST 總和 / SPAN_TOKEN_USAGE 總和（非逐日）；(2) 在全部已登錄 Agent 中
找出「以 `model:<target_model>` 為主要標籤」的參照 Agent（沿用
`bff/anomaly_model_switch.py` 既有的 dominant-tag 判定技術），用該參照 Agent
自己的 COST/SPAN_TOKEN_USAGE 算出 `target_effective_rate`；多個候選時取
`project_id` 字典序最小者；(3) `projected_cost` = 視窗總 token 數 ×
`target_effective_rate`；`estimated_monthly_savings` = (`current_effective_rate`
− `target_effective_rate`) × 視窗總 token 數（視窗本身視為一個月，不外推）；
(4) 找不到參照 Agent → 明確錯誤（`NoReferenceAgentForModelError`），絕不回傳
0/空白；(5) 任何底層查詢失敗（`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError`/`OpikConfigError`）必須原樣往上拋，不得吞掉或換成
0/null；(6) `target_model` 等於該 Agent自己目前的主要模型時，
`current_effective_rate` 必須等於 `target_effective_rate`，savings=0（不是
錯誤）；(7) UI 必須標示此結果為估算值，說明其為「混合後的單一 token 有效費
率」，不是真正的 input/output 分開計價。

**範圍外**：自訂視窗長度（固定 `HISTORY_DAYS=30`）、多 Agent 批次模擬、新告
警/通知機制、單日內混用多模型的細節處理、跨視窗趨勢/季節性預測。

**依賴**：SDLCCT-28（沿用其 dominant-tag 判定技術）、SDLCCT-10/11（`COST`/
`SPAN_TOKEN_USAGE`/`TRACE_COUNT`+`Breakdown(TAGS)`，已確認可用）、SDLCCT-50
（已解決：Option 1 計價方式，即本文件採用的「單一混合有效費率」，非
input/output 分開計價）。

## 現狀查核（實作前已逐字讀取的既有程式碼）
- `bff/anomaly_model_switch.py::_find_switch_date()`：**私有**（`_` 前綴）
  輔助函式，簽名 `(trace_count_series: tuple[MetricSeries, ...]) ->
  tuple[date|None, str|None, str|None, dict[date, float]]`。其「主要模型」判
  定技術：把 `TRACE_COUNT` + `Breakdown(TAGS)` 回傳中 `key` 以 `MODEL_TAG_PREFIX
  = "model:"` 開頭的 `MetricSeries` 挑出來，依日期分桶成 `by_date: dict[date,
  dict[model_value, count]]`，每天取 `max(counts.items(), key=lambda kv:
  kv[1])[0]` 當天的 dominant model，再逐日比較偵測切換點。本票**不**跨模組
  import 這支私有函式（與 SDLCCT-43 決策 2 同一慣例：私有函式不跨模組呼
  叫），但**沿用同一判定技術**（`model:` 前綴 + 依 count 取 `max`）寫一支新
  的私有輔助函式，差異只在本票要的是「整個視窗一個值」而非「逐日分桶」——
  見下方關鍵決策 1。
- `bff/opik_metrics.py`：確認 `MetricType.COST`/`TRACE_COUNT`/
  `SPAN_TOKEN_USAGE` 三個成員皆存在（`SPAN_COUNT`/`TRACE_ERROR_RATE` 本票不
  用）。`Breakdown(field=BreakdownField.TAGS)` 建構子確認可用（`metadata_key`
  僅 `METADATA` 欄位需要）。`get_project_metrics_cached(project_ids:
  Sequence[str], metric_type: MetricType, *, interval: Interval,
  interval_start: datetime, interval_end: datetime, breakdown: Breakdown |
  None = None) -> dict[str, tuple[MetricSeries, ...]]`——任一 `project_id`
  查詢失敗會讓整批呼叫立即拋出 `OpikHTTPError`/`OpikTimeoutError`/
  `OpikResponseFormatError`（AC5 的例外清單另外還列了 `OpikConfigError`，
  來自 `base_url()` 設定缺失，同樣不被攔截，直接往上拋）。`Interval.TOTAL`
  對一段視窗回傳「整段彙總後的單一／少量資料點」（已由 `bff/api/agents.py`
  的 `current_period_spend` 查詢方式驗證此慣例），本票用 `Interval.TOTAL`
  一次取得視窗總和，不需要像 `anomaly_model_switch.py` 那樣逐日查詢再自己
  加總（那是該票「偵測切換點」的需求決定的，本票沒有「找切換點」的需求，
  見下方關鍵決策 1）。
- `seed/model_prices.snapshot.json`：固定 7 個 key（`claude-sonnet-4-5`/
  `claude-haiku-4-5`/`gemini-2.5-pro`/`gemini-2.5-flash`/`gpt-4.1`/`gpt-4o`/
  `gpt-4o-mini`），每個 key 含 `input_cost_per_token`/`output_cost_per_token`/
  `litellm_provider`。本票只需要**key 的集合**本身（驗證 `target_model` 是
  否為受支援模型），不需要 `seed/client.py::load_prices()` 回傳的
  `Decimal` 區間（那是給實際計價用，本票用的是「混合有效費率」，見依賴
  SDLCCT-50 Option 1 決策）。`seed/client.py::load_prices()` 本身也不適合直
  接呼叫：它用 `parse_float=Decimal` 解析整個檔案後依傳入的 `models` 清單
  做字典查找，若傳入不存在的 key 會丟 `KeyError`，而非本票需要的語意明確
  的驗證錯誤類別——本票不呼叫它，直接讀檔案做 key 存在性檢查（見下方關鍵
  決策 2）。
- `seed/registry.py::load_registry()`：回傳全部 9 筆 Agent dict（欄位
  `key/display/dept/dept_code/owner/budget/registered`）。AC2「全部已登錄
  Agent」→ 過濾 `registered is True`（9 筆中 8 筆，`temp_supplier_scraper`
  因 `registered=False` 被排除，與 SDLCCT-43 判定治理缺口時引用的同一欄位
  語意一致）。
- `bff/api/agents.py`：`sys.path.insert(..., _BFF_ROOT, _SEED_ROOT)` 的既有
  匯入手法（`_BFF_ROOT = Path(__file__).resolve().parent.parent`，
  `_SEED_ROOT = _BFF_ROOT.parent / "seed"`），本票沿用，不新增第二套匯入機
  制。`_total_cost()` 風格的輔助函式（加總某 key 底下所有 series 所有
  point，`None` 值視為貢獻 0）——本票計算視窗總和時沿用同一慣例（見下方關
  鍵決策 3，並說明與 Constitution「缺值顯示 unknown」的關係）。
- `bff/api/app.py`：三個既有全域 exception handler
  （`OpikClientError`→502、`OpikConfigError`→502、`MissingProjectIdsError`
  →500）。本票沿用這三個，**不新增**對應它們的新 handler，但**新增兩個**
  新的 handler 給本票自己的兩個新例外類別（見下方「失敗時的回應」）。
- `bff/anchor.py::get_anchor_date()`：回傳 UTC 午夜 `datetime`，本票視窗
  `interval_end = anchor+1day`、`interval_start = anchor - (HISTORY_DAYS-1)
  天`，與既有兩個模組（`cost_overview.py`/`agents.py`）同一「含當天」窗口
  算法一致。
- `seed/catalog.py::HISTORY_DAYS = 30`：本票視窗長度常數的唯一來源，
  `bff/` 內新模組直接寫 `HISTORY_DAYS = 30` 的獨立副本常數（與
  `bff/anchor.py` 對 `seed/` 的「獨立 vendored copy」慣例一致，`bff/` 和
  `seed/` 是两个独立 package，見 `docs/design/SDLCCT-10.md` 決策 3），不跨
  package import `seed.catalog.HISTORY_DAYS`。
- `frontend/components/layout/app-sidebar.tsx`：Governance 分組第 42-45 行
  已有 `{ label: t("sidebar.items.budgetSimulation") }` 項目，目前**沒有**
  `href`（與 SDLCCT-43 修改前的 `agentList` 項目同樣狀態）。本票比照
  SDLCCT-43 的手法，只改這一項加上 `href`，不動其餘 5 個無 href 項目。
- `frontend/lib/api-client.ts`/`frontend/lib/agents-api.ts`：既有
  `fetchJson<T>(path)` 共用封裝 + 畫面專屬 API client 範例（型別皆從
  `@/lib/generated/bff-types` 的 `components["schemas"]` re-export）。本票
  沿用，新增 `frontend/lib/budget-simulation-api.ts`，不新增第二套 fetch
  邏輯。
- `frontend/components/cost-overview/error-card.tsx`：既有三態渲染慣用的
  `ErrorCard` 元件，本票沿用（與 SDLCCT-43 同一決策：跨畫面共用元件，不搬
  移路徑）。
- `frontend/app/agents/page.tsx`：既有頁面檔案結構範例（`"use client"` +
  固定 `<header>` + `<main>` 包裹 `<h1>`/`<p>`/`<section>`/`<footer>`）。本
  票新頁面 `frontend/app/budget-simulation/page.tsx` 比照此結構。
- `frontend/e2e/`：目前只有 `cost-dashboard.spec.ts`、
  `i18n-cost-dashboard-strings.spec.ts` 兩個測試檔。全 repo
  `Grep("toEqual|getComputedStyle|一致")` 只命中 `frontend/AGENTS.md`（文件
  說明文字）與 `frontend/lib/use-fetch-once.test.ts`（與樣式無關的 hook 單
  元測試）——**不存在**任何比較兩個元素 computed style 相等的既有測試，本
  票新增的畫面/元件不會觸發任何跨元素樣式耦合測試鏈，本票的跨元素樣式耦合
  測試檢查不適用。

## 介面/API 契約

新增 **一個** GET 端點：

### `GET /api/budget-simulation?agent_key=<key>&target_model=<model>`

Query 參數（皆必填，無預設值）：
- `agent_key`：待模擬的 Agent（必須是 `seed/registry.py::load_registry()`
  中存在的 `key`，不限 `registered` 狀態——AC 並未排除對未登錄 Agent 做模
  擬，因此這裡比 AC2「參照 Agent 搜尋範圍限已登錄」更寬，兩者是不同語意：
  一個是「被模擬的對象」，一個是「拿來當參照標竿的對象集合」）。
- `target_model`：必須是 `seed/model_prices.snapshot.json` 現有 7 個 key 之一。

成功回應 `200`：
```json
{
  "agent_key": "maintenance_copilot",
  "target_model": "gpt-4o-mini",
  "window_start": "2026-09-16",
  "window_end": "2026-10-15",
  "total_tokens": 184200.0,
  "current_effective_rate": 0.0000041,
  "target_effective_rate": 0.0000021,
  "reference_agent_key": "qc_vision_agent",
  "projected_cost": 386.82,
  "estimated_monthly_savings": 368.4,
  "is_estimate": true,
  "explanation": "此為混合後的單一 token 有效費率估算（總成本 ÷ 總 token 數），非依 input/output 個別計價的精確試算。"
}
```
- `window_start`/`window_end`：`anchor_date - (HISTORY_DAYS-1)` 天到
  `anchor_date`（含首尾兩天，共 `HISTORY_DAYS=30` 天），`YYYY-MM-DD`。
- `total_tokens`：`agent_key` 本身在整個視窗的 `SPAN_TOKEN_USAGE` 總和
  （`Interval.TOTAL`，單次批次查詢，`None` 點視為貢獻 0——見關鍵決策 3）。
- `current_effective_rate`：`agent_key` 視窗 COST 總和 ÷ `total_tokens`（AC1）。
- `reference_agent_key`：AC2 演算法找到的參照 Agent 之 `key`（即其
  `project_id`）。
- `target_effective_rate`：`reference_agent_key` 自己視窗 COST 總和 ÷ 自己
  視窗 `SPAN_TOKEN_USAGE` 總和（AC2）。
- `projected_cost` = `total_tokens * target_effective_rate`（AC3）。
- `estimated_monthly_savings` = `(current_effective_rate -
  target_effective_rate) * total_tokens`（AC3；可為負數，代表換模型會更
  貴，規格未禁止負值，不做額外截斷）。
- `is_estimate`：固定 `true`（AC7，供前端判斷是否渲染估算免責聲明；目前
  只有這一種計算路徑，永遠是估算值，未設計「非估算」模式，故此欄位本票內
  恆為 `true`，保留欄位是為了前端渲染邏輯與回應結構解耦，不是因為本票有
  條件分支）。
- `explanation`：固定繁體中文說明字串（AC7），前端直接渲染此欄位文字（不
  在前端另外手刻一份同義文案，避免兩處文字漂移——見 SDLCCT-50 決策與本文
  件關鍵決策 4）。

**失敗時的回應**：
| 情境 | 例外類別 | HTTP 狀態 |
|---|---|---|
| `agent_key` 不在 registry 中 | `AgentNotFoundError`（本票新增，`ValueError` 子類別） | 404 |
| `target_model` 不在 `model_prices.snapshot.json` 的 7 個 key 中 | `UnknownTargetModelError`（本票新增，`ValueError` 子類別） | 400 |
| AC4：已登錄 Agent 中找不到以 `target_model` 為主要模型的參照 Agent | `NoReferenceAgentForModelError`（本票新增，`ValueError` 子類別） | 404 |
| 底層任一批次查詢失敗 | `OpikHTTPError`/`OpikTimeoutError`/`OpikResponseFormatError` | 502（沿用既有 handler） |
| `OPIK_BASE_URL` 未設定等設定問題 | `OpikConfigError` | 502（沿用既有 handler） |

`agent_key`/`target_model`/`NoReferenceAgentForModelError` 三個新 handler 回應
格式與既有 `OpikClientError` handler 一致的 envelope：
`{"error": {"message": "<原因>"}}`（這三類不是外部依賴失敗，沒有
`endpoint`/`status_code` 可報告，故省略這兩個鍵，而非塞 `null`——與既有
`OpikConfigError` handler「無 endpoint 時仍保留 key 但填 `null`」的既有慣例
不同，理由：`OpikConfigError` 的 schema 是既有、本票不應該修改其 handler；
本票自己新增的三個 handler 可以自行決定省略不適用的鍵，不需要沿用一個本
來就是描述「外部依賴失敗」語意的 schema 去套在「使用者輸入驗證失敗」這個
不同語意的情境上）。

404 vs 400 的區分原則（本票新建立，供後續故事沿用）：路徑/query 參數所指
的「實體」不存在 → 404（`agent_key` 找不到、或 AC4 的「找不到參照 Agent」
——兩者都是「以給定條件查無匹配實體」的語意）；參數「值本身不在允許集合
內」的輸入驗證失敗 → 400（`target_model` 不在 7 個已知模型內，屬於請求格
式/內容錯誤，不是「查無資料」）。

### Pydantic `response_model`（新增於 `bff/api/schemas.py`）
```python
class BudgetSimulationResult(BaseModel):
    agent_key: str
    target_model: str
    window_start: str
    window_end: str
    total_tokens: float
    current_effective_rate: float
    target_effective_rate: float
    reference_agent_key: str
    projected_cost: float
    estimated_monthly_savings: float
    is_estimate: bool
    explanation: str
```

### 新增模組位置
- `bff/api/budget_simulation.py`（業務邏輯）：
  - `AgentNotFoundError`、`UnknownTargetModelError`、
    `NoReferenceAgentForModelError`（皆 `ValueError` 子類別，與
    `bff/anomaly_model_switch.py::InsufficientSwitchWindowDataError` 同一
    「業務邏輯例外用 `ValueError` 子類別」慣例）。
  - `_dominant_model_tag(trace_count_series) -> str | None`：私有輔助函式，
    對 `Breakdown(TAGS)` + `Interval.TOTAL` 回傳的整段序列，挑出 `model:`
    前綴的 key，加總每個 key 底下所有 point（`None` 貢獻 0），取總數最大
    者去掉前綴回傳；查無任何 `model:` 前綴資料回傳 `None`。
  - `_effective_rate(agent_key, window_start, window_end) ->
    tuple[float, float]`：回傳 `(total_cost, total_tokens)`，批次查詢
    `COST`/`SPAN_TOKEN_USAGE`（各一次 `Interval.TOTAL`），`None` 點貢獻 0。
  - `simulate_budget(agent_key: str, target_model: str) -> dict`：組裝以上
    三者，實作關鍵決策 1 的「短路」規則。
- `bff/api/app.py` 新增：`from .budget_simulation import (simulate_budget,
  AgentNotFoundError, UnknownTargetModelError,
  NoReferenceAgentForModelError)`、三個新 `@app.exception_handler`、一個新
  路由：
  ```python
  @app.get("/api/budget-simulation", response_model=BudgetSimulationResult)
  def budget_simulation(agent_key: str, target_model: str) -> dict:
      return simulate_budget(agent_key, target_model)
  ```
  route handler 維持薄層，與既有三個端點寫法一致。

## 資料模型
無新增持久化資料模型。本票讀取既有的 `seed/registry.py`（SDLCCT-12）、既有
Opik 查詢函式（`bff/opik_metrics.py`，SDLCCT-10/11）、既有靜態價格快照
（`seed/model_prices.snapshot.json`），不新增資料表/欄位/索引。
`bff/api/schemas.py` 新增的 Pydantic 類別是序列化層，不是持久化資料模型。

## 關鍵技術決策

### 1. AC6 的實作方式：短路（short-circuit），不是 AC2 一般搜尋演算法的偶然結果
`simulate_budget()` 一開始先用 `_dominant_model_tag()` 算出 `agent_key` 自己
的目前主要模型（`own_dominant_model`）。若 `own_dominant_model ==
target_model`，**直接**將 `reference_agent_key = agent_key`，跳過 AC2 對全部
已登錄 Agent 的搜尋（不查詢其他 Agent 的 `TRACE_COUNT`）。理由：AC2 的一般
搜尋規則是「多個候選時取 `project_id` 字典序最小者」；若 `agent_key` 恰好不
是字典序最小的候選（例如另一個已登錄 Agent 剛好也以同一模型為主要模型，且
其 `key` 字典序更小），一般搜尋演算法會選到**別的** Agent 當參照，其混合有
效費率不保證與 `agent_key` 自己的費率完全相等（兩個 Agent 的次要模型組成可
能不同）——這會與 AC6「必須相等」直接衝突。短路規則讓 AC6 的等式在**任何
資料狀態下**都是恆成立的數學事實（同一個 Agent 自己跟自己的費率當然相
等），而不是依賴 demo 資料裡字典序恰好配合;。對 AC2 本身的行為沒有任何改
變（AC2 描述的是 `target_model` **不等於** `agent_key` 自己主要模型時的搜
尋規則，短路只處理 AC6 這個退化情況）。

### 2. `target_model` 驗證：直接讀 JSON 檔案的 key 集合,不呼叫 `seed/client.py::load_prices()`
`load_prices(models)` 是為「已知一組有效 model 清單,批次取出計價區間」設計
的(seed 產生器場景),對不存在的 key 會丟未分類的 `KeyError`,語意上不是本票
要的「驗證使用者輸入」錯誤。本票在 `bff/api/budget_simulation.py` 內另開一
個極小的私有函式,直接 `json.loads()` 讀 `seed/model_prices.snapshot.json`
(複用 `bff/api/agents.py` 已建立的 `_SEED_ROOT` 路徑手法指向同一個檔案路
徑,不新增第二套 `seed/` 路徑解析方式),只取 `.keys()` 做集合存在性檢查,查
無則拋 `UnknownTargetModelError`。不需要 `Decimal` 精度(本票不做逐 token 計
價,只需要知道「這個字串是不是一個受支援的模型名稱」)。

### 3. 視窗總和的 `None` 處理:沿用既有「`None` 貢獻 0」加總慣例,但明確排除「全部皆 `None`」的靜默 0
加總 `COST`/`SPAN_TOKEN_USAGE`/`TRACE_COUNT` 序列時,單一 `MetricPoint.value
is None` 的點視為貢獻 0(與 `bff/api/agents.py::_total_cost()`、
`bff/api/cost_overview.py` 既有慣例一致)。但若整段視窗查詢**完全没有任何
序列**(例如該 `agent_key` 在 Opik 端根本不存在、或整段視窗無任何資料),
`total_tokens` 會是 0,此時 `current_effective_rate = total_cost / 0` 會除以
零——本票在 `_effective_rate()` 內顯式檢查 `total_tokens == 0`,若為 0 則拋
`AgentNotFoundError`(與路徑參數驗證失敗同一錯誤類別、同一 404,因為「Opik
端查無此 Agent 任何資料」與「registry 查無此 key」對使用者而言是同一種
「這個 Agent 看起來不存在」體驗,不需要區分成兩種 404)。這不違反 AC5「查
詢失敗必須原樣拋出」,因為這裡不是查詢失敗(查詢成功回傳,只是空結果),是
「空結果導致除以零」這個本票自己需要防呆的獨立情況。

### 4. `explanation` 文字由後端固定回傳,前端不另外手刻同義文案
AC7 要求「UI 必須標示為估算值」,決策:繁體中文說明字串由
`bff/api/budget_simulation.py` 固定回傳(見介面契約的 `explanation` 欄
位),前端 i18n(`messages.ts`)只需要一個固定的區塊標籤(例如「試算說
明」)包住後端回傳的這段文字,不在 `messages.ts` 另外重寫一份語意相同的
說明文字。理由:若前後端各自維護一份「這是估算值」的說明文案,未來計價方
式變更(例如改用真正的 input/output 分開計價)時容易漏改其中一處,造成文
案與實際計算方式不一致——固定由後端(計算邏輯的實際擁有者)回傳這段文字,
保證文案與計算方式同源。

## UI 原型
`docs/design/SDLCCT-46-prototype.html`(可直接在瀏覽器開啟的靜態 HTML,內嵌
`<style>`,套用 `docs/design-system.md` 定稿的實際色彩/字級/間距/元件
token,佔位數字清楚標示為範例資料,非真實查詢結果)。涵蓋:
- 頁首:比照 `cost-dashboard`/`agents` 頁面結構(固定 `<header>` + 頁面標
  題/副標題)。
- 一個表單區塊:「選擇 Agent」下拉選單(`<label>` 對應,9 個 Agent 顯示
  `display` 名稱)+「目標模型」下拉選單(`<label>` 對應,7 個
  `model_prices.snapshot.json` 的模型)+ 送出按鈕(Primary 按鈕樣式),示範
  AC 無障礙規則(表單 label、focus 樣式)。
- 成功結果卡片:目前有效費率、目標有效費率、推算月成本、預估月省三組
  數字 + 一個明顯的「估算值」徽章與下方 `explanation` 文字區塊(字級採用
  Meta 層級、`--color-text-secondary`),示範 AC7「必須標示為估算,且說明
  為混合費率」。
- 一個错误狀態範例(沿用既有 `ErrorCard` 樣式):示範 AC4「找不到參照 Agent」
  的錯誤文字與 AC5「查詢失敗」的錯誤文字兩種情境各一個卡片,皆非 0/空白。
- 中文字串對應下方 i18n 新增 key 的規劃內容(置於 `frontend/lib/
  i18n/messages.ts` 新增 `budgetSimulation` 命名空間,鍵名:
  `budgetSimulation.header.title`/`.header.subtitle`/`.form.agentLabel`/
  `.form.modelLabel`/`.form.submit`/`.result.currentRate`/
  `.result.targetRate`/`.result.projectedCost`/`.result.savings`/
  `.result.estimateBadge`/`.result.explanationLabel`/
  `.errors.noReferenceAgent`/`.footer.dataSource`)。

## 開放設計問題(定稿時必須為空)
(無)
