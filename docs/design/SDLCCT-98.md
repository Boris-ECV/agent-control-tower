# 設計文件 — SDLCCT-98 「返回」連結文字改為上一層實際名稱

## 對應需求規格

G1 已核准、已定稿的 4 條情境：

1. 執行詳情：trace／執行詳情頁的返回連結文字為「返回 {Agent 名稱}」。
2. Agent 詳情：Agent 詳情頁的返回連結文字為「返回 Agent 清單」。
3. 行為不變：以滑鼠、Enter、Space 啟動返回連結，皆導向上一層（`components/common/back-link.tsx` 既有行為不變）。
4. 既有測試：e2e 文字斷言更新後全數通過。

**範圍外**：不得更動返回連結的視覺樣式。**相依**：SDLCCT-97（已在 main）——重用其「父層名稱資料來源」。規格無開放問題。

## 現狀查核（實作前已逐字讀取）

### 字串與 i18n 輔助函式

- `frontend/lib/i18n/messages.ts:135`：`agentDetail.header = { title: "Agent 明細", backToList: "返回 Agent 清單" }`。
- `frontend/lib/i18n/messages.ts:172`：`traceDetail.header = { title: "執行詳情", backToAgent: "返回 Agent 明細" }`。
- `frontend/lib/i18n/t.ts:5-28`：`t(key)` **只做路徑查找，沒有 `{name}` 參數插值**；型別 `Path<T>` 明確把「函式值」（`(...args) => string`，t.ts:7）也視為合法葉節點，`t(key)` 回傳該函式本身。
- 既有「參數化訊息」慣例：**函式值訊息 + 呼叫端再呼叫**——`messages.ts:61-62` `currentPeriod: (range: string) => \`本期花費（${range}）\``，呼叫處 `components/cost-overview/period-comparison-section.tsx:41` `t("costOverview.period.currentPeriod")(…)`；另 `messages.ts:50,54,93,176` 同型。本票照此慣例，不新增插值機制。
- `backToAgent` 全 repo 僅兩處引用：`messages.ts:172` 與 `components/trace-detail/trace-detail-content.tsx:38`（Grep `frontend/`，排除 node_modules）。`backToList` 僅 `messages.ts:135` 與 `agent-detail-content.tsx:58`。vitest 內沒有任何 i18n key／「no hard-coded string」測試（Grep `messages|backTo|traceDetail|agentDetail.header` 於 `*.test.{ts,tsx}` 無結果；`i18n` 命中的 `lib/agent-display.test.ts`、`trace-breadcrumbs.test.tsx`、`version-cost-chart.test.tsx` 皆與此字串無關）。e2e `i18n-cost-dashboard-strings.spec.ts` 只驗成本儀表板，與本字串無關。

### 兩頁 header 現狀

- `trace-detail-content.tsx:35-40`：`<header className="sticky top-0 z-10 flex flex-col gap-2 …"><TraceBreadcrumbs key={key} agentKey={key} traceId={traceId} /><div className="flex items-center justify-between"><BackLink href={\`/agents/${key}\`} label={t("traceDetail.header.backToAgent")} /></div></header>`。`key` 由 `useParams`（第 27-28 行）取得。
- `components/trace-detail/trace-breadcrumbs.tsx:14`：`const name = useAgentDisplayName(agentKey)`——**目前整頁唯一一處呼叫該 hook**，名稱只在 `TraceBreadcrumbs` 內，`TraceDetailContent` 本身沒有名稱。
- `agent-detail-content.tsx:57-58`：`<BackLink href="/agents" label={t("agentDetail.header.backToList")} />`——本票**不改**。
- `lib/agent-display.ts:8-9,20-35`：module-level `cache`／`inflight` Map；`getAgentDisplayName` 命中快取直接 resolve，同 key 進行中請求共用同一 Promise，`finally` 清 inflight，失敗不快取；`useAgentDisplayName`（第 42-49 行）回傳 `peek || (success 且非空白 ? data : key)`——載入中、失敗、空白都回 key，永不空、永不 throw。
- `components/common/back-link.tsx:6-24`：`<Link>` 內 `svg aria-hidden="true"` + `<span>{label}</span>`；**沒有 `aria-label`**，可及名稱 = span 文字。Space 鍵處理在第 11-16 行。

## 介面/API 契約

**無 bff／後端端點異動；無新增網路請求。** 名稱來源沿用 SDLCCT-97 的 `GET /api/agents/{key}/cost-breakdown`（`.display`）經 `lib/agent-display.ts` 快取。

### 1. 訊息（`lib/i18n/messages.ts`）

`traceDetail.header.backToAgent` **改用（repurpose）為函式值訊息**，key 名稱不變（語意仍是「返回 Agent」，且只有一個引用處）：

```ts
header: { title: "執行詳情", backToAgent: (agentName: string) => `返回 ${agentName}` },
```

- `agentDetail.header.backToList` 維持字串「返回 Agent 清單」，不動。
- 不新增字串、不刪除 key（舊字串「返回 Agent 明細」隨之消失，無其他引用）。
- 呼叫：`t("traceDetail.header.backToAgent")(name)`（與 `period-comparison-section.tsx:41` 同型）。型別由 `Path`（t.ts:7）已支援，無需改 `t.ts`。

### 2. 新元件 `frontend/components/trace-detail/trace-back-link.tsx`

```tsx
"use client";
export function TraceBackLink({ agentKey }: { agentKey: string }): JSX.Element;
// const name = useAgentDisplayName(agentKey);
// return <BackLink href={`/agents/${agentKey}`} label={t("traceDetail.header.backToAgent")(name)} />;
```

`TraceDetailContent` 的 header 內，把原 `<BackLink … />` 換成 `<TraceBackLink key={key} agentKey={key} />`（外層 `div.flex.items-center.justify-between` 不動）。`href` 與現況一致（`/agents/${key}`，不 `encodeURIComponent`，與 SDLCCT-97 決策相同）。`BackLink` 元件**邏輯不變**。

### 3. 單一請求保證（如何做到「整頁只打一次 /cost-breakdown」）

麵包屑（`TraceBreadcrumbs`）與返回連結（`TraceBackLink`）**各自呼叫** `useAgentDisplayName(key)`，兩個 hook 實例的 effect 在同一次 commit 內先後執行，都走 `getAgentDisplayName(key)`：第一個建立請求並寫入 `inflight`，第二個命中 `inflight` 共用同一 Promise（`agent-display.ts:23-24`）；完成後 `rememberAgentDisplayName` 寫入快取，之後掛載的任何實例皆 `peek` 命中。結果：直接開 trace 網址 **恰一次** `/cost-breakdown`；從 Agent 詳情點進來（其 fetcher 已 `rememberAgentDisplayName`，`agent-detail-content.tsx:41`）**零次**。失敗情境：兩者同時 reject，`finally` 清 inflight，兩處都顯示 key；不重試、不顯示錯誤。

不採「在 `TraceDetailContent` 呼叫一次 hook 再把名稱傳給 `TraceBreadcrumbs`」：會改變 SDLCCT-97 已通過的 `TraceBreadcrumbs` props 與其 3 個單元測試，而現有快取＋in-flight 已保證單次請求（見決策 1）。

### 4. 載入／錯誤 fallback

| 情境 | trace 頁返回連結文字 |
|------|----------------------|
| 查詢中（直接開網址） | 「返回 sales-copilot」（key，與麵包屑第 3 層同步顯示 key） |
| 查詢成功 | 「返回 Sales Copilot」（display） |
| 查詢失敗（500／網路錯誤／404／未 mock） | 「返回 sales-copilot」，不重試、無錯誤訊息 |
| display 為空白 | 「返回 sales-copilot」（`useAgentDisplayName` 已處理） |
| 由 Agent 詳情進入（快取命中） | 首次 render 即「返回 Sales Copilot」，無閃爍 |

連結在任何狀態都可點，`href` 永遠是 `/agents/{key}`；名稱載入不影響導覽。

### 5. a11y

- 可及名稱 = span 文字，隨名稱載入由「返回 sales-copilot」變「返回 Sales Copilot」；`svg` 已 `aria-hidden`；**無 `aria-label` 需同步**，故無名稱不一致風險。
- 不使用 `aria-live`：這是導覽連結的名稱，不是需要宣告的狀態訊息，變動一次、不打斷使用者（與麵包屑同）。
- 鍵盤：Tab 焦點；Enter 為 `<a>` 預設啟動；Space 由 `BackLink` 既有 `onKeyDown` 處理——全部不變。
- 焦點在載入完成時被保留：換的只是 span 內文字節點，同一個 `<a>` DOM 不重掛（key 不變）。

### 6. 長名稱防溢位（唯一的樣式相關微調，行為見決策 4）

`BackLink` 內 `<span>{label}</span>` 加 `className="min-w-0 [overflow-wrap:anywhere]"`。對一般長度名稱**零視覺差異**；僅在名稱長到（含無空白字串）會超出 342px 內寬時，才在任意位置換行而不橫向撐破頁面。不改顏色、字級、間距、hover、focus、圖示。

## 資料模型

無新增資料模型。沿用 SDLCCT-97 的 module-level 前端記憶體快取（`Map<string,string>`／in-flight `Map`），不變動。

## 關鍵技術決策

1. **訊息用函式值（`(agentName) => \`返回 ${agentName}\``），不新增插值機制**：`t()` 無參數插值，但型別已支援函式葉節點，且 `currentPeriod`／`previousPeriod`（messages.ts:61-62）、`loadFailedTitle`（:93）等已是此慣例——最小、與現有一致、保留型別檢查（參數個數／型別在編譯期驗證）。
2. **重用並改造 `backToAgent` 而非另建新 key 或刪除**：唯一引用處就是 trace 頁；保留 key 避免出現「死 key」或雙 key 並存，舊字串「返回 Agent 明細」消失即符合規格。
3. **新增 `TraceBackLink` 小元件（`key={key}` 重掛）而非讓 `TraceDetailContent` 直接呼叫 hook**：`useFetchOnce` 的 effect 只依 `retryKey`（`use-fetch-once.ts:35`），不隨 fetcher 變動重抓；若在 `TraceDetailContent` 直接呼叫，SPA 內從 A agent 的 trace 切到 B agent 的 trace 時（同一動態路由，元件實例可能被重用）名稱會停在舊值。與 SDLCCT-97 決策 3 同法：以 `key` 強制重掛。`TraceDetailContent` 也因此不多一個 hook 狀態而重渲染整頁。
4. **長名稱：只給 span 加 `min-w-0 [overflow-wrap:anywhere]`，不截斷（不用 truncate）**：規格要求文字為「返回 {Agent 名稱}」，截斷會讓可見文字不再等於名稱（螢幕閱讀器仍讀全名，但視覺使用者看不到）；換行則完整保留。此類別是**行為保護而非視覺樣式變更**（一般名稱零差異），屬「範圍外：不得改視覺樣式」之外的溢位保護，最保守讀法下仍需要，否則 390px 長名稱會橫向溢位並打斷現有溢位類測試（`agent-detail.spec.ts:778,1198,1289,1422`、`date-rollout.acceptance.spec.ts:113`、`breadcrumbs.acceptance.spec.ts:140-153`）。若 reviewer 認為連此也算樣式變更，可刪除該 class——代價是無空白的超長名稱在 390px 會溢位（麵包屑已截斷，故風險僅在返回連結）。
5. **載入中顯示 key，不顯示佔位或隱藏連結**：與麵包屑一致（規格明載「失敗／載入中退回 key」的資料來源行為，由 SDLCCT-97 定義）；連結在任何時刻都可點，點擊目的地只依 key，不需名稱。
6. **文字由 key 換成 display 的版面跳動**：返回連結獨占 header 第二列（trace 頁該 `div` 內僅有它一個子項，無右側日期，`trace-detail-content.tsx:37-39`），行高固定 `leading-[22px]`，寬度變化只影響連結自身右緣，**不推動任何同列兄弟元素**；一般名稱不換行，故無垂直跳動。可測性：e2e 以 `expect(locator).toHaveText/`getByRole(...name)` 的 auto-retry 等待換字，單元測試用 `await act(async () => resolve())` 後同步斷言。
7. **既有 e2e 以「補 mock `/cost-breakdown`」使名稱確定**：`trace-detail.spec.ts:235-302` 三個測試目前沒 mock `/cost-breakdown`，名稱查詢會打到 `NEXT_PUBLIC_BFF_URL=http://localhost:8000`——該位址是否有服務、回什麼都不確定（可能 refused→key，也可能回真資料→display），斷言會非決定性。這三個測試**本來就必須修改文字**，故一併加 mock（回 `display: "Sales Copilot"`），這與 SDLCCT-97 的「不為雜訊補 mock」不衝突（那是針對無須改動的測試）。
8. **範圍界定**：規格情境 2 只要求 Agent 詳情頁維持「返回 Agent 清單」，不新增任何程式碼；僅以測試鎖定。`agent-detail-content.tsx`、`app-sidebar`、`lib/breadcrumbs.ts`、`agent-display.ts` 皆**不修改**。

## 受影響的既有測試（逐一盤點）

### A. 必須修改（文字或 locator 會失敗／不穩）

| 檔案:行 | 現況 | 新內容 |
|---------|------|--------|
| `e2e/trace-detail.spec.ts:235-266`（測試 "SDLCCT-64: header back link points to the owning agent … click/Enter/Space"）；locator 在 **248、254、261** | `getByRole("link", { name: "返回 Agent 明細" })` | 測試開頭加 `mockCostBreakdown(page)`（檔內新 helper：fulfill 200，`display: "Sales Copilot"`，形狀同該檔第 9-25 行）；三處 locator 改 `page.getByRole("link", { name: "返回 Sales Copilot", exact: true })`。其餘斷言（href、click／Enter／Space 後 `toHaveURL`）不變。 |
| `e2e/trace-detail.spec.ts:268-282`（"remains visible … while the spans request is pending"）；locator **277** | 同上 | 加 `mockCostBreakdown`；locator 改 `{ name: "返回 Sales Copilot", exact: true }`（cost-breakdown 正常 resolve，spans 才是 pending，驗證名稱獨立於 spans 狀態）。 |
| `e2e/trace-detail.spec.ts:284-302`（"… when the spans request errors"）；locator **297** | 同上 | 加 `mockCostBreakdown`；locator 同上。 |
| `e2e/breadcrumbs.acceptance.spec.ts:99-105`（測試 "back link text unchanged"）；斷言 **102**（Agent 頁）與 **104**（trace 頁） | `:102 getByRole("link", { name: "返回 Agent 清單" })`、`:104 getByRole("link", { name: "返回 Agent 明細" })` | 測試改名為 `"back link text: agent page 返回 Agent 清單, trace page 返回 {Agent 名稱}"`；`:102` 加 `exact: true`（內容仍「返回 Agent 清單」）；`:104` 改 `getByRole("link", { name: "返回 Sales Copilot", exact: true })`（該測試已有 `mock(page)`，`NAME = "Sales Copilot"`，auto-retry 等待載入）。可直接寫 `` `返回 ${NAME}` ``。 |

**需要改動的地方共 4 個測試、5 + 2 = 7 處 locator**（`trace-detail.spec.ts` 5 處：248、254、261、277、297；`breadcrumbs.acceptance.spec.ts` 2 處：102、104，其中 102 僅加 `exact`）。**文字真正變更 6 處**（5 處 trace-detail + 104）。

### B. 不需修改（已逐一確認）

- `e2e/agent-detail.spec.ts:882,889,897,914,934`：`"返回 Agent 清單"` ——Agent 頁文字**不變**；子字串比對不會命中麵包屑「Agent 清單」（麵包屑文字不含「返回」）與側邊欄。
- `e2e/breadcrumbs.spec.ts`、`breadcrumbs.acceptance.spec.ts` 其餘測試：所有 `…getByRole("link", { name: NAME | "Sales Copilot" | KEY | LONG_NAME })` 皆已以 `crumbs(page)`／`nav(page)`（`getByRole("navigation", { name: "麵包屑" })`）限定範圍（breadcrumbs.spec.ts:46,54,83,95,111,149；breadcrumbs.acceptance.spec.ts:56,78,110,150），返回連結在 `<nav>` 之外，不會被命中。
- `e2e/sidebar-active.spec.ts`、`e2e/sidebar-nav.acceptance.spec.ts`：`name: "Agent 清單", exact: true`（SDLCCT-97 已改為限定側邊欄／exact）——「返回 Agent 清單」不等於「Agent 清單」，exact 不命中；「成本儀表板」兩頁無同名連結。
- `e2e/agents.spec.ts:131,191`：`getByRole("link", { name: "Sales Copilot" })` 在 `/agents` 清單頁，該頁沒有返回連結與麵包屑，**不受影響**。
- `e2e/trace-detail.spec.ts` 其餘（`getByText("root-chain"|"summarize"|"general"|"llm"|"search-tool"|"查無資料"|/無法載入/|/404/|/502/|"Agent Control Tower")`、`:35` `getByText(MOCK_TRACE_ID)` 於 Agent 頁）：新返回連結文字為「返回 {名稱或 key}」，與以上任何字串無子字串重疊（`getByText` 預設子字串比對：`"general"`、`"llm"` 不在「返回 sales-copilot」；名稱／key 不含 404／502）。
- `e2e/date-rollout.acceptance.spec.ts:119-145`（trace 頁 `trc_9`）：只用 `body.innerText` 正則比對日期時間，不受影響；未 mock `/cost-breakdown` 屬無害（失敗退回 key）。
- 單元測試：vitest 內沒有 `TraceDetailContent`／`BackLink`／`messages` 的既有測試；`trace-breadcrumbs.test.tsx`（3 個）與 `agent-display.test.ts` 不需改。
- 跨元素 computed-style 耦合（Grep `getComputedStyle|toHaveCSS|一致` 於 `e2e/`）：僅 `trace-detail.spec.ts:96-98`（span 列 paddingLeft）、`agents.spec.ts:176`、`currency-rollout.acceptance.spec.ts:29`、`agent-detail.spec.ts:1339,1421`（pointerEvents），**皆不涉及 BackLink／header**；本設計只在 BackLink 的 span 加換行保護 class，不會打斷任何一個。

### C. Locator 歧義稽核（SDLCCT-96 曾因此 reopen）

trace 頁改後同時存在：側邊欄「Agent 清單」、麵包屑「治理」「Agent 清單」「{名稱}」、返回連結「返回 {名稱}」。Playwright `getByRole(…, { name })` 預設**子字串且不分大小寫**，下列組合會命中多個元素：

| Locator（trace 頁） | 命中 | 處置 |
|---------------------|------|------|
| `getByRole("link", { name: "Sales Copilot" })`（未 exact、未限範圍） | 麵包屑「Sales Copilot」＋返回連結「返回 Sales Copilot」＝2 個 -> strict mode violation | **目前 repo 內沒有這樣的 locator**（Grep 確認：僅 `agents.spec.ts:131,191` 於 `/agents` 頁，無返回連結）。新測試**禁止**使用；麵包屑一律 `nav.getByRole("link", { name })`，返回連結一律 `page.getByRole("link", { name: "返回 Sales Copilot", exact: true })`。 |
| `getByRole("link", { name: "sales-copilot" })`（載入中／失敗狀態，名稱為 key） | 麵包屑第 3 層＋「返回 sales-copilot」＝2 個 | 現有 `breadcrumbs.spec.ts:111` 已限 `crumbs(page)`，OK；新 fallback 測試的返回連結寫 `{ name: "返回 sales-copilot", exact: true }`。 |
| `getByText("Sales Copilot")`（未限範圍） | 麵包屑第 3 層＋返回連結內 span | 目前無使用（Grep 確認）；新測試禁用，需用 `nav` 或 `getByRole` 限定。 |
| `getByRole("link", { name: "Agent 清單" })`（Agent 頁，未 exact） | 側邊欄＋麵包屑＋「返回 Agent 清單」＝3 個 | 既有：`agents.spec.ts:23,34` 在無麵包屑／無返回連結的頁面，OK；`sidebar-*` 已 exact/限定側邊欄。Agent 頁的新測試：返回連結用 `{ name: "返回 Agent 清單", exact: true }`。 |
| `getByRole("link", { name: "返回 Sales Copilot" })`（子字串） | 僅返回連結（麵包屑文字不含「返回」）= 1 | 安全，但新測試仍加 `exact: true` 以防日後文案演變。 |
| `getByRole("link", { name: "返回" })` / `getByText("返回")` | 只有返回連結 | 安全，但不要用於 Agent 頁以外的假設。 |

**新增／修改測試必用的範圍化 locator（精確字面）**

- 返回連結（trace 頁）：`page.getByRole("link", { name: "返回 Sales Copilot", exact: true })`；失敗／載入中：`{ name: "返回 sales-copilot", exact: true }`。
- 返回連結（Agent 頁）：`page.getByRole("link", { name: "返回 Agent 清單", exact: true })`。
- 麵包屑連結：`page.getByRole("navigation", { name: "麵包屑" }).getByRole("link", { name: "Sales Copilot", exact: true })`。

## 測試策略

**新增單元測試（vitest，移動到各自旁邊的 `*.test.tsx`）**

1. `frontend/components/trace-detail/trace-back-link.test.tsx`（`vi.mock("@/lib/agent-detail-api")`，`beforeEach` 呼叫 `clearAgentDisplayCache()`；沿用 `trace-breadcrumbs.test.tsx` 寫法），共 5 個：
   - 載入中：`getByRole("link", { name: "返回 sales-copilot" })` 且 `href="/agents/sales-copilot"`。
   - 載入完成：`await act(async () => resolve({ display: "Sales Copilot" }))` 後 `{ name: "返回 Sales Copilot" }` 存在、`返回 sales-copilot` 已不在。
   - 失敗（reject）：維持「返回 sales-copilot」，不 throw。
   - display 為空白：回「返回 sales-copilot」。
   - 快取預熱（`rememberAgentDisplayName`）：首次 render 即「返回 Sales Copilot」，`mockFetch` 未被呼叫。
2. `frontend/components/trace-detail/trace-detail-content.test.tsx`（mock `next/navigation` 的 `useParams` 回 `{ key: "sales-copilot", traceId: "trc_123" }`、`@/lib/trace-spans-api` 回空 spans、`@/lib/agent-detail-api`），共 2 個：
   - 整頁 render 後 `fetchAgentCostBreakdown` **恰被呼叫 1 次**（麵包屑＋返回連結共用），且返回連結與麵包屑同時顯示 `Sales Copilot`。
   - `t("traceDetail.header.backToAgent")("X") === "返回 X"`（訊息建構函式本身；放在同檔 `describe("message")`，或放進 `trace-back-link.test.tsx`，擇一）。
   單元測試共新增 **7 個**（5 + 2）。

**新增 e2e**（新檔 `frontend/e2e/back-link-parent-name.spec.ts`，mock 形狀沿用 `breadcrumbs.acceptance.spec.ts:10-33`，`display: "Sales Copilot"`，trace id `trc_123`），共 **8 個**：

1. trace 頁載入完成：返回連結 `toBeVisible`，文字「返回 Sales Copilot」，`href="/agents/sales-copilot"`。
2. 載入中退回 key 並隨後換字：以 `Promise` 閘門延後 `/cost-breakdown` fulfill——先 `expect({ name: "返回 sales-copilot", exact: true }).toBeVisible()`，放行後 `expect({ name: "返回 Sales Copilot", exact: true }).toBeVisible()` 且舊連結 `toHaveCount(0)`。
3. 查詢失敗（500）：維持「返回 sales-copilot」，連結仍可點、`href` 正確。
4. 滑鼠點擊 -> `toHaveURL(/\/agents\/sales-copilot$/)`。
5. 鍵盤 Enter：`focus()` -> `toBeFocused()` -> `press("Enter")` -> 導向 `/agents/sales-copilot`。
6. 鍵盤 Space：同上，`press(" ")`。
7. Agent 頁：返回連結文字「返回 Agent 清單」，`href="/agents"`，點擊導向 `/agents`（鎖定情境 2 且未被改）。
8. 直接載入 trace 頁僅一次 `/cost-breakdown` 請求：`page.on("request")` 計數，等待返回連結換成「返回 Sales Copilot」且麵包屑同為「Sales Copilot」，再 `await page.waitForLoadState("networkidle")`，`expect(count).toBe(1)`。

另加一個 390px 的 `test.describe`：長名稱（含空白，約 100 字元，沿用 `breadcrumbs.acceptance.spec.ts:6-7`）與**無空白超長名稱**（約 80 字元，無空白）兩情況，皆斷言 `document.documentElement.scrollWidth <= clientWidth`（比照 `agent-detail.spec.ts:1422` 作法），返回連結 `boundingBox().right <= viewport width`。此組為 2 個，e2e 新增合計 **10 個**。

**驗收執行**（一次只跑一份，不與其他 worktree 同時跑 e2e）：
`cd frontend && NEXT_PUBLIC_BFF_URL=http://localhost:8000 CI=1 npx playwright test --workers=1`；另 `npm run test`（vitest 全套）、lint／型別檢查、`pytest -q` 皆須實際執行並通過（不得以「只改前端」略過後端）。

## UI 原型

見 `docs/design/SDLCCT-98-prototype.html`（靜態、離線可開；token 取自 `frontend/app/globals.css` 與 SDLCCT-97 原型）。內容：Agent 詳情頁（不變）、trace 頁載入中／載入完成／失敗三種狀態、390px 手機（含長名稱換行）。

## 開放設計問題(定稿時必須為空)

（無。規格沒有空缺需要產品決策；「長名稱換行 vs 截斷」「補 mock」屬實作層決策，已記錄於決策 4、7。）
