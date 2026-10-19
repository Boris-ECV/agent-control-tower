# 設計文件 — SDLCCT-43 Agent 清單畫面（Portal MVP，畫面 2/6）

## 對應需求規格
對應 G1 已核准的需求規格「Agent 清單畫面」。使用者故事：工廠主管從側欄點進
「Agent 清單」，看到全部 9 個 Agent（8 個已登錄 + 1 個未登錄但有花費）各自
的本期預算消耗、近期花費趨勢、以及治理缺口（未登錄／無負責人／無預算），
一眼看出哪些 Agent 的治理狀態需要優先處理。6 條 AC：(1) 新 BFF 端點回傳全部
9 個 Agent 的組裝資料，遵循既有三層慣例，不得把 `find_governance_gaps()` 的
子集回傳值當作完整資料來源；(2) 側欄「Agent 清單」項目取得真實 href 並可
導覽，其餘 6 個無 href 項目不受影響；(3) 新頁面套用三項前端基礎工程（共用
API client / OpenAPI 產生型別 / i18n），不手刻舊模式；(4) 響應式設計，窄螢幕
不破版、桌面完整呈現；(5) 畫面上每個數字可追溯回後端真實值，查詢失敗時明確
顯示錯誤，不呈現為 0 或空白；(6) 無 Opik 品牌字樣，zh-TW 經 i18n 管理。範圍
外：畫面 #3 下鑽頁、任何寫入功能、建立預算/告警規則、`compare_to_baseline()`
異常判斷、側欄其餘 6 項功能化、語言切換 UI。依賴：SDLCCT-12、SDLCCT-10/11/15、
SDLCCT-31、SDLCCT-27、SDLCCT-37/38/39、SDLCCT-34、SDLCCT-32（已全部 Done）。

## 現狀查核（實作前已逐字讀取的既有程式碼）
- `seed/registry.py::load_registry()`：回傳 `tuple[dict, ...]`，每筆 9 個
  Agent 固定含 6 個欄位 `key/display/dept/dept_code/owner/budget/registered`
  （`FIELDS` 常數），直接取自 `catalog.Agent` 的同名屬性。
- `seed/catalog.py::AGENTS`：確認 9 筆，最後一筆 `temp_supplier_scraper`
  （`dept="未登錄"`、`dept_code="none"`、`owner=None`、`budget=None`、
  `registered=False`）。前 8 筆 `registered=True`，皆有 `owner`/`budget`。
- `bff/opik_metrics.py::get_project_metrics_cached()`：簽名為
  `(project_ids: Sequence[str], metric_type: MetricType, *, interval: Interval,
  interval_start: datetime, interval_end: datetime, breakdown: Breakdown | None
  = None) -> dict[str, tuple[MetricSeries, ...]]`。`MetricSeries.points` 為
  `tuple[MetricPoint, ...]`，`MetricPoint(time: datetime, value: float | None)`
  ——`value` 可能是 `None`（未知，絕不可被當成 0）。任一 `project_id` 查詢失敗
  會讓整批呼叫立即拋出 `OpikHTTPError`/`OpikTimeoutError`/
  `OpikResponseFormatError`（不回傳部分結果）。
- `bff/anomaly_governance_gap.py::find_governance_gaps()`：只回傳「被旗標命中
  的子集」（`flagged` 清單），且只對該子集呼叫一次
  `get_workspace_daily_costs()`；沒有命中旗標的 Agent完全不會出現在回傳值
  中——**確認**：若直接拿這支函式的回傳值當本票端點的資料來源，會漏掉 8 個
  正常 Agent，違反 AC1「全部 9 個 Agent」的要求，因此本票不呼叫它（見下方
  決策 2）。旗標判定條件（三者 OR）：`registered is False or owner is None or
  budget is None`。
- `bff/baseline.py::compare_to_baseline()`：純函式，比較 `target_date` 對前
  N 天平均的偏離比例；資料不足（`target_date` 無值、baseline 窗口內全部無值、
  或 baseline 平均為 0）時拋 `InsufficientBaselineDataError`，語意屬異常偵測
  （正常花費呈現路徑直接誤用它會在資料不足的 Agent 上整批炸掉），本票不使用
  （見下方決策 1）。
- `bff/api/app.py`：FastAPI app 實例、CORS、三個全域 exception handler
  （`OpikClientError`→502、`OpikConfigError`→502、`MissingProjectIdsError`
  →500），已涵蓋任何例外類型而非個別路由綁定——本票新路由**沿用**這三個
  既有 handler，不需要新增任何 exception handler。既有兩個端點皆為「route
  handler 薄層（函式本體只有一行 `return get_xxx()`）+ `bff/api/cost_overview.py`
  業務邏輯模組 + `response_model=` Pydantic 類別」三層結構。
- `bff/api/cost_overview.py`：確認 `sys.path.insert(..., "seed")` 的匯入手法
  （`_BFF_ROOT`/`_SEED_ROOT` 兩個路徑都插入 `sys.path`，再 `from registry
  import load_registry`），以及 `_query_total_costs()`/`_total_cost()` 兩個
  私有（`_` 前綴）輔助函式的寫法——不跨模組 import 私有函式（見下方決策）。
- `bff/api/schemas.py`：SDLCCT-38 的 Pydantic `response_model` 範例，欄位
  宣告順序即回應的 JSON key 順序，欄位名稱與業務邏輯函式回傳的 dict key 必須
  逐一對應，否則 FastAPI 會丟棄未宣告欄位或在型別不符時回 500。
- `frontend/components/layout/app-sidebar.tsx`：`NAV_GROUPS` 第二組
  （Governance）第一項 `{ label: t("sidebar.items.agentList") }` 目前**沒有**
  `href` 欄位，渲染為無 `asChild` 的 `SidebarMenuButton`（純 `<button
  type="button">`，無點擊行為）。Cost Dashboard 項目的寫法是
  `{ label: ..., href: "/cost-dashboard" }`，渲染時用
  `<SidebarMenuButton render={<Link href={item.href} />} isActive={pathname
  === item.href}>`——本票比照同一寫法，只改 `agentList` 這一項的資料，不動
  其餘 6 項（它們的資料結構中本來就不含 `href` 欄位，加這一項不影響它們）。
- `frontend/lib/api-client.ts`：`fetchJson<T>(path)`，base URL 來自
  `NEXT_PUBLIC_BFF_URL`，非 2xx 回應取 `body.error.message`，網路層失敗回傳
  `{endpoint, status: 0, message}`——本票沿用，不新增第二套 fetch 邏輯。
- `frontend/lib/cost-overview-api.ts`：本畫面專屬 API client 的既有範例——
  型別皆從 `@/lib/generated/bff-types` 的 `components["schemas"]` re-export，
  端點函式只是 `fetchJson<T>(path)` 的薄包裝。本票比照建立
  `frontend/lib/agents-api.ts`。
- `frontend/lib/i18n/messages.ts`/`t.ts`：巢狀物件常數 + 型別安全的路徑存取
  `t("a.b.c")`；新增 key 只需在 `messages` 物件內加巢狀欄位，`t()` 的型別會
  自動推導，不需要改 `t.ts` 本身。
- `frontend/lib/use-fetch-once.ts`：per-card `useFetchOnce(fetcher)` hook，
  `{status: "loading"|"error"|"success", retry}`——本票沿用，不重寫資料請求
  邏輯。
- `frontend/components/cost-overview/error-card.tsx`：`ErrorCard({title,
  error, onRetry})`，固定紅色邊框卡片樣式，顯示 `t("errorCard.loadFailedTitle")`
  + `t("errorCard.queryFailed")(endpoint, status, message)` + 重試按鈕——本票
  沿用同一元件（跨畫面共用元件，不是 cost-overview 專屬，儘管目前路徑在
  `components/cost-overview/` 下；見下方決策，本票選擇原地引用而非搬移）。
- `frontend/components/cost-overview/summary-section.tsx`：三態
  loading/error/success 渲染範例，`Card` 子元件、`grid-cols-1 sm:grid-cols-2
  lg:grid-cols-4` 既有響應式斷點寫法。
- `frontend/app/cost-dashboard/page.tsx`：既有頁面檔案結構——`"use client"`
  頂部宣告、固定 `<header>`（含「Agent Control Tower」標題 + 右側今天日期）、
  `<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">` 包裹
  `<h1>`/`<p>`（副標題）/ 多個 `<section aria-label={...}>` / `<footer>`
  資料來源說明。本票新頁面 `frontend/app/agents/page.tsx` 比照此結構。
- `docs/design-system.md` 第 106-120 行：斷點 `sm=640/md=768/lg=1024/
  xl=1280`，與 Tailwind 預設值一致,不需改 `tailwind.config`。第 150 行
  「卡片/列表項」規則：邊框 `--color-border`、圓角、內距至少 16px。
- `project-profile.yaml`：`commands` 區塊已有 `bff_export_openapi`
  （`cd bff && uv run python scripts/export_openapi.py`）與
  `frontend_generate_types`（`cd frontend && npm run generate:types`）——
  本票開發階段依序執行這兩個既有指令使新端點出現在
  `frontend/lib/generated/bff-types.ts`，**不新增任何指令**。
- `frontend/e2e/`：目前只有 `cost-dashboard.spec.ts`、
  `i18n-cost-dashboard-strings.spec.ts` 兩個測試檔，`Grep("toEqual|
  getComputedStyle|一致")` 在 `frontend/` 全repo 範圍內只命中
  `frontend/AGENTS.md`（文件說明文字）與 `frontend/lib/use-fetch-once.
  test.ts`（與樣式無關的 hook 單元測試），**不存在**任何比較兩個元素
  computed style 相等的既有測試，本票的跨元素樣式耦合測試檢查不適用，
  本票新增的 UI 元素不會破壞任何既有耦合測試。

## 介面/API 契約

新增 **一個** GET 端點（不像 SDLCCT-32 拆成兩個——理由見下方關鍵決策）：

### `GET /api/agents`

無 query 參數（時間窗完全由 `bff/anchor.py::get_anchor_date()` 決定，本故事
範圍內只有「本期（月至今）＋近 7 天趨勢」一種視角，不開放前端指定日期）。

成功回應 `200`，`response_model=AgentsListResponse`：
```json
{
  "anchor_date": "2026-10-15",
  "period_start": "2026-10-01",
  "agents": [
    {
      "key": "maintenance_copilot",
      "display": "設備維修助理",
      "dept": "設備部",
      "owner": "王志明",
      "budget": 900.0,
      "registered": true,
      "current_period_spend": 612.4,
      "budget_consumed_pct": 68.04,
      "trend": [
        {"date": "2026-10-09", "value": 18.2},
        {"date": "2026-10-10", "value": 21.0},
        {"date": "2026-10-11", "value": 19.5},
        {"date": "2026-10-12", "value": null},
        {"date": "2026-10-13", "value": 22.8},
        {"date": "2026-10-14", "value": 25.1},
        {"date": "2026-10-15", "value": 20.3}
      ],
      "has_governance_gap": false
    },
    {
      "key": "temp_supplier_scraper",
      "display": "臨時供應商爬蟲",
      "dept": "未登錄",
      "owner": null,
      "budget": null,
      "registered": false,
      "current_period_spend": 234.5,
      "budget_consumed_pct": null,
      "trend": [
        {"date": "2026-10-09", "value": 30.1},
        {"date": "2026-10-10", "value": 34.0},
        {"date": "2026-10-11", "value": 36.4},
        {"date": "2026-10-12", "value": 38.9},
        {"date": "2026-10-13", "value": 40.2},
        {"date": "2026-10-14", "value": 42.8},
        {"date": "2026-10-15", "value": 46.0}
      ],
      "has_governance_gap": true
    }
  ]
}
```
- `agents` 永遠含全部 9 筆（`registry.load_registry()` 的全部筆數），依
  `registry.load_registry()` 原始順序回傳（即 `catalog.AGENTS` 的宣告順序，
  不重新排序——AC1 沒有要求排序，前端若要排序留給前端做，不在 bff 決定）。
- `current_period_spend`：單一 Agent 本期（`period_start` 到 `anchor_date`
  含當天）的 COST 總和，查詢方式與 `bff/api/cost_overview.py::
  _query_total_costs()` 完全相同的模式（`Interval.TOTAL`，9 個 key 一次
  批次查詢，不逐一查詢）。
- `budget_consumed_pct`：`current_period_spend / budget * 100`；`budget` 為
  `None` 或 `0` 時回傳 `null`（不得回傳 0 或除以零錯誤，依
  CONSTITUTION「缺值顯示 unknown，不可顯示 0」）。
- `trend`：近 7 天（`anchor_date` 往前推 6 天到 `anchor_date` 當天，共 7 個
  日期）每日 COST，`Interval.DAILY` 一次批次查詢全部 9 個 key。`value` 直接
  取自對應 `MetricPoint.value`，可能是 `null`（未知，不可顯示為 0——見下方
  決策 1）。`date` 為 `YYYY-MM-DD`（取 `MetricPoint.time.date().isoformat()`，
  bff 不做時區轉換，與既有「台灣時間換算在前端」決策一致）。
- `has_governance_gap`：對 `load_registry()` 的該筆記錄直接套用三個 OR
  條件（`registered is False or owner is None or budget is None`），**不
  呼叫** `anomaly_governance_gap.find_governance_gaps()`（見下方決策 2）。
- `dept`/`owner`/`budget`/`registered` 直接取自 `load_registry()` 對應欄位，
  未經任何轉換（`owner`/`budget` 可為 `null`）。

**失敗時的回應**：內部任一批次查詢（`current_period_spend` 或 `trend`）失敗
時（`OpikHTTPError`/`OpikTimeoutError`/`OpikResponseFormatError`），直接讓例
外往上拋，由 `bff/api/app.py` 既有的全域 `OpikClientError` handler 攔截，回傳
`502`（格式與 SDLCCT-32 完全相同：`{"error": {"message", "endpoint",
"status_code"}}`）。`OpikConfigError`→502、`MissingProjectIdsError`（理論上
不會發生，`load_registry()` 固定 9 筆）→500，皆沿用既有 handler，**本票不
新增任何 exception handler**。

### Pydantic `response_model`（新增於 `bff/api/schemas.py`）
```python
class AgentTrendPoint(BaseModel):
    date: str
    value: float | None


class AgentRegistryEntry(BaseModel):
    key: str
    display: str
    dept: str
    owner: str | None
    budget: float | None
    registered: bool
    current_period_spend: float
    budget_consumed_pct: float | None
    trend: list[AgentTrendPoint]
    has_governance_gap: bool


class AgentsListResponse(BaseModel):
    anchor_date: str
    period_start: str
    agents: list[AgentRegistryEntry]
```

### 新增模組位置
- `bff/api/agents.py`（業務邏輯：組合 `registry.load_registry()` +
  `opik_metrics.get_project_metrics_cached()` 兩次批次查詢、計算
  `budget_consumed_pct`、inline 套用治理缺口旗標）。沿用
  `bff/api/cost_overview.py` 已建立的 `sys.path.insert(..., "seed")` 手法
  import `registry.load_registry`，**不新增第二套匯入機制**。
- `bff/api/app.py` 新增三行：`from .agents import get_agent_registry`、
  `from .schemas import AgentsListResponse`、
  `@app.get("/api/agents", response_model=AgentsListResponse) def
  agents_list(): return get_agent_registry()`——route handler 維持薄層，
  與既有兩個端點的寫法一致。

## 資料模型
無新增持久化資料模型。本票讀取既有的 `seed/registry.py`（SDLCCT-12）與既有
Opik 查詢函式（`bff/opik_metrics.py`，SDLCCT-10/11），不新增資料表/欄位/
索引。`bff/api/schemas.py` 新增的 Pydantic 類別是序列化層，不是持久化資料
模型。

## 關鍵技術決策

### 1. 趨勢呈現方式：採用建議方案——sparkline + `Interval.DAILY` 原始序列
不使用 `compare_to_baseline()`。理由：該函式語意屬「異常偵測」（比較 target
day 對前 N 天平均的偏離比例），對資料不足的情況（例如 baseline 窗口內全部
無值，或 baseline 平均恰為 0）會拋 `InsufficientBaselineDataError`——用在
「正常呈現 9 個 Agent 的花費趨勢」這種必須對全部 9 筆都成功渲染的路徑上，
任何一個 Agent 資料不足就會讓整個端點 500，與 AC5「單一查詢失敗不得呈現為
0 或空白，但也不能讓其他正常資料一起炸掉」的精神衝突。直接呈現
`get_project_metrics_cached(..., interval=Interval.DAILY, ...)` 的 7 天原始
序列，每個 `MetricPoint.value` 原樣透出（含 `null`），前端 sparkline 對
`null` 點以斷點（不連續的線段）或留白表示，**不得內插或顯示為 0**——這是
`trend` 序列本身允許 `null` 元素的直接延伸（AC5 的「不得呈現為 0」同樣適用
於序列中的單點，不只是整體數字）。

### 2. 新端點資料組裝方式：採用建議方案——inline 套用三個 OR 條件
不呼叫 `find_governance_gaps()`。理由：該函式的回傳值**只包含被旗標命中的
子集**（`flagged` 清單），完全不含「沒有治理缺口」的 Agent；若直接拿它的
回傳值當資料來源，8 個正常 Agent 會從回應中消失，直接違反 AC1「回傳全部 9
個 Agent」與 AC1 明文禁止事項「不得把 `find_governance_gaps()` 的子集回傳值
當作完整資料來源」。改為對 `load_registry()` 的全部 9 筆，在 `bff/api/
agents.py` 內直接 inline 套用與 `find_governance_gaps()`/
`anomaly_governance_gap.py` 模組文件完全相同的三個 OR 條件
（`registered is False or owner is None or budget is None`）算出
`has_governance_gap` 布林值——判定邏輯的「定義」仍只有一處權威來源
（`anomaly_governance_gap.py` 模組文件與 SDLCCT-31 設計決策），本票只是
複製該條件式本身（三行布林運算），不复用該函式的*執行路徑*（因為執行路徑
的回傳形狀不符合 AC1）。這與 SDLCCT-32 的既有決策一致（`cost_overview.py`
的 `unregistered` 清單也是直接讀 `registered` 欄位，不呼叫
`find_governance_gaps()`）。

### 3. 新路由字串：採用建議方案——`/agents`
前端路由 `frontend/app/agents/page.tsx`、bff 路由
`GET /api/agents`，對齊既有 `/cost-dashboard`、`/settings/system` 的命名
風格（名詞、小寫、連字號分隔複合詞——本路由是單一英文名詞，不需要連字號）。
側欄 `app-sidebar.tsx` 的 `agentList` 項目 `href` 與此一致：
```ts
{ label: t("sidebar.items.agentList"), href: "/agents" }
```
其餘 6 個無 `href` 項目的資料結構不變（它們本來就不含 `href` 欄位），不受
影響（AC2 後半）。

### 4. 版面型態：採用表格（桌面 `>=768px`）＋ 卡片清單（窄螢幕 `<768px`）的雙渲染，不是單一型態
**不是純表格、也不是純卡片網格**，理由如下：
- 9 筆資料、每筆需呈現 7 個欄位（部門/負責人/預算/本期花費/預算消耗%/
  趨勢 sparkline/治理狀態），且使用情境是「一眼看出哪些 Agent 需要優先
  處理」——這是**跨欄位比較**的使用情境（例如快速掃視「哪幾列的消耗% 欄
  特別高」「哪幾列治理狀態是異常」），表格的欄對齊特性天生比卡片網格更
  適合這種掃視式比較；SDLCCT-32 的卡片網格（`SummarySection`）呈現的是
  4 個獨立總覽數字，彼此沒有「逐列比較」的語意，因此那裡用卡片合理，但
  本票 9 筆 × 7 欄的「清單＋多欄比較」語意與之不同，不應該照搬同一型態。
- 但 7 個欄位的表格在 `<768px` 窄螢幕下，若維持表格型態，必然得靠水平
  捲動或欄位截斷才能塞進螢幕，兩者都違反 AC4「窄螢幕不破版」（水平捲動
  在觸控裝置上的體驗不佳、且容易讓使用者誤以為右側欄位不存在；欄位截斷
  則直接遺失資訊，與「可追溯回後端真實值」的精神衝突，使用者看不到完整
  數字）。
- 因此採用**同一份資料、兩套渲染**：`>=768px`（`md` 斷點以上，含 AC4 明文
  要求的 `>=1024px` 桌面情境）顯示完整表格（8 欄：Agent/部門/負責人/預算/
  本期花費/預算消耗%/趨勢/治理狀態）；`<768px` 顯示卡片清單（每個 Agent
  一張卡片，7 個欄位垂直堆疊呈現，比照 `docs/design-system.md` 第 150 行
  「卡片/列表項」規則：邊框 `--color-border`、圓角、內距至少 16px）。兩套
  渲染用 Tailwind 的 `hidden md:block`/`md:hidden` 切換可見性（同一份資料
  來源，不是兩次 fetch），而非依賴瀏覽器 media query 外的 JS 偵測視窗寬度
  ——避免 SSR/hydration 時的寬度偵測閃爍問題。
- 選 `md`（768px）而非 `lg`（1024px）作為表格/卡片的切換點：AC4 明文把
  `<768px` 歸類為「不破版」要求、`>=1024px` 歸類為「完整呈現」要求，中間
  的 `768px–1024px`（平板直向）區間沒有明文規定；選擇讓表格在 `md` 即
  出現（而非等到 `lg`），因為表格本身在 768px 寬度已經可以放下 8 欄（搭配
  較窄的欄寬與較小的 sparkline），沒有必要把「完整呈現」的體驗延後到
  1024px 才出現——`768px–1024px` 區間維持表格而非卡片，是比 AC4 明文要求
  更寬鬆（更早給使用者完整表格）的選擇，不違反任何 AC。

## UI 原型
`docs/design/SDLCCT-43-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，
內嵌 `<style>`，套用 `docs/design-system.md` 定稿的實際色彩/字級/間距/
元件 token，佔位數字清楚標示為範例資料，非真實查詢結果）。涵蓋：
- 頁首：比照 `cost-dashboard` 頁面結構（固定 `<header>` + 頁面標題/副標題）。
- 桌面表格型態（示意寬視窗下的渲染，8 欄：Agent/部門/負責人/預算/本期花費/
  預算消耗%/趨勢（inline SVG sparkline，含一個 `null` 斷點示範）/治理狀態
  徽章），9 列資料逐一對應 `catalog.AGENTS` 的 9 個 Agent（含
  `temp_supplier_scraper` 顯示「治理缺口」紅色徽章、其餘 8 筆顯示「正常」）。
- 窄螢幕卡片清單型態（同一組資料，改用卡片堆疊呈現，附 CSS 媒體查詢示範
  `<768px` 的渲染結果——原型用兩個並排的視窗寬度示意區塊，分別標示「桌面
  (>=768px)」與「窄螢幕 (<768px)」，供人類審核者不需真的縮小瀏覽器視窗即可
  比對兩種型態）。
- 一個治理缺口徽章 + 一個正常狀態徽章的視覺範例。
- 一個錯誤狀態範例（沿用既有 `ErrorCard` 樣式：紅色邊框卡片 + 「查詢失敗：
  `/api/agents` 回應 502（...）」文字 + 重試按鈕），示範 AC5 的「不白屏、不
  呈現為 0 或空白」。
- sparkline 以純手刻 inline SVG `<polyline>` 繪製（無新增圖表函式庫依賴，
  `frontend/package.json` 目前沒有任何圖表套件，9 筆資料 × 7 個點的簡單線圖
  不足以證成引入一個新的前端依賴——比照 CONSTITUTION「規格模糊時不要過度
  設計」；開發階段若發現手刻 SVG 無法滿足可及性/互動需求，可在 PR 中說明
  並另行決定，不視為偏離本設計）。
- 中文字串皆逐字對應下方 i18n 新增 key 的規劃內容（置於 `frontend/lib/
  i18n/messages.ts` 新增 `agents` 命名空間，鍵名：`agents.header.title`/
  `agents.header.subtitle`/`agents.table.columns.*`/
  `agents.governanceBadge.hasGap`/`agents.governanceBadge.ok`/
  `agents.unknownOwner`/`agents.unknownBudget`/`agents.footer.dataSource`）。

本 repo 現有 `frontend/e2e/` 下兩個測試檔（`cost-dashboard.spec.ts`、
`i18n-cost-dashboard-strings.spec.ts`）與全 repo `Grep("toEqual|
getComputedStyle|一致")` 查核結果（見上方「現狀查核」段）確認：不存在任何
比較兩個元素 computed style 相等的既有測試，本票新增的側欄 `href`/新頁面/
新元件不會觸發任何跨元素樣式耦合測試鏈，本票的跨元素樣式耦合測試檢查
不適用。

## 開放設計問題（定稿時必須為空）
（無）
