# 設計文件 — SDLCCT-97 頂列加入可點擊的麵包屑（治理 / Agent 清單 / Agent 名稱 / 執行 ID）

## 對應需求規格

對應 G1 已核准的需求規格，4 條情境（已定稿）：

1. 執行詳情：trace／執行詳情頁頂列顯示「治理 / Agent 清單 / {Agent 名稱} / {截短執行 ID}」，前三層為連結。
2. Agent 詳情：Agent 詳情頁頂列顯示「治理 / Agent 清單 / {Agent 名稱}」。
3. 點擊：點擊有連結的層級 -> 導向該層級的頁面。
4. 目前頁：最後一層為純文字並帶 `aria-current="page"`。

**範圍外**：不得更動返回連結文字（SDLCCT-98 會改，且依賴本票的「父層名稱資料來源」）；不得為其他頁面（成本儀表板等）加路徑。無相依。規格無開放問題。

## 現狀查核（實作前已逐字讀取）

### 版面與「頂列」在哪裡

- `frontend/app/layout.tsx:36-41`：`<SidebarInset>` 內只有一個手機專用列（`md:hidden`，只放 `SidebarTrigger`，第 37-39 行）與 `{children}`。**根 layout 沒有桌面頂列**，沒有任何共用的 top bar 元件（`components/layout/` 只有 `app-sidebar.tsx`）。
- 所謂「頂列」是**各頁自己渲染**的 sticky `<header>`：
  - Agent 詳情 `components/agent-detail/agent-detail-content.tsx:40-47`：`<header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-3">`，內含 `BackLink`（第 41 行，`t("agentDetail.header.backToList")`）與右側日期 `<span>`（第 42-46 行，成功時 `formatTaiwanDate(state.data.anchor_date)`，否則 `t("costOverview.header.unavailable")`）。
  - 執行詳情 `components/trace-detail/trace-detail-content.tsx:34-36`：同樣的 `<header>`，只含 `BackLink`（第 35 行，`/agents/${key}`、`traceDetail.header.backToAgent`）。
  - 「今天（台灣時間）：…」（`messages.ts:23` `costOverview.header.today`）只在成本儀表板頁自己的 header 渲染，**兩個詳情頁都沒有**；本票不碰成本儀表板。
- `components/ui/` 現有：`button`、`input`、`separator`、`sheet`、`sidebar`、`skeleton`、`tooltip`。**沒有 `breadcrumb`**，也不得新增依賴 -> 自建小元件（Tailwind）。

### 路由與資料

- `app/agents/[key]/page.tsx`（Agent 詳情）、`app/agents/[key]/traces/[traceId]/page.tsx`（執行詳情）皆為 server component，以 `<Suspense>` 包住 client 的 `AgentDetailContent`／`TraceDetailContent`；兩者以 `useParams()` 取參數（`agent-detail-content.tsx:32-33`、`trace-detail-content.tsx:26-27`）。
- **Agent 名稱（`display`，如 "Sales Copilot"）**：
  - Agent 詳情頁已有：`fetchAgentCostBreakdown(key)`（`lib/agent-detail-api.ts:19-25`，`GET /api/agents/{key}/cost-breakdown`）-> `state.data.display`（`agent-detail-content.tsx:51`）。成功前以 `t("agentDetail.header.title")`（「Agent 明細」）當 h1。
  - 執行詳情頁**目前不取 Agent 名稱**：只呼叫 `fetchTraceSpans(key, traceId)`（`trace-detail-content.tsx:29-30`），回應只有 `key`、`trace_id`、`spans`（見 e2e mock `trace-detail.spec.ts:30`），**沒有 display**。頁面標題只用 `traceId`（第 40 行）。
- 取資料工具：`lib/use-fetch-once.ts`（`useFetchOnce(fetcher)`，三態 loading／error／success，效果只依 `retryKey`，**不隨 fetcher 變動重抓**，第 22-35 行）；`lib/api-client.ts:17` `fetchJson<T>(path)`。沒有任何快取／context／SWR 類工具。
- **執行 ID 截短**：repo 內沒有任何截短實作（Grep `slice(|substring|truncate|…` 於 `components/ lib/ app/` 無結果）；`top-traces-table` 與執行詳情 h1 都顯示完整 ID。故截短規則為新規則，無既有慣例需對齊。

### 「治理」是什麼

- `components/layout/app-sidebar.tsx:41`：`t("sidebar.groups.governance")` = 「治理」（`messages.ts:5`）是 **`SidebarGroupLabel`（純標籤，非連結、非頁面）**。「治理」群組下 5 項只有 2 項有 href：「Agent 清單」`/agents`（第 43 行，群組第一項）與「異常與告警」`/anomalies`（第 44 行）。**沒有「治理」的落地頁／路由**。
- 「Agent 清單」文字來自 `t("sidebar.items.agentList")`（`messages.ts:11`）。

### 與 SDLCCT-96 的關係

`lib/nav.ts` 的 `isNavItemActive` 已使 `/agents/**` 時側邊「Agent 清單」反白（`app-sidebar.tsx:81`）。麵包屑只讀 `useParams` 的 key／traceId，**與 `isNavItemActive` 無耦合、不需改 `lib/nav.ts`**；SDLCCT-96 設計決策 4 預留「aria-current 可與麵包屑一併考慮」——本票只在**麵包屑最後一層**加 `aria-current="page"`，**不**動側邊欄（維持範圍）。

### 既有測試盤點（必須列出）

下列為會受「頁面新增一個名為『Agent 清單』的連結」影響的既有斷言。Playwright 的 `getByRole("link", { name, exact: true })` 仍會同時命中側邊欄與麵包屑兩個連結 -> strict mode violation。

**必須修改（Agent 詳情頁或執行詳情頁上，且未限定在側邊欄範圍內）**

| 檔案:行 | 現況 | 頁面 | 改法 |
|---------|------|------|------|
| `e2e/sidebar-active.spec.ts:33` | `page.getByRole("link", { name: "Agent 清單", exact: true })` | `/agents/sales-copilot` | 改用側邊欄範圍 locator（見下） |
| `e2e/sidebar-active.spec.ts:39` | 同上 | `/agents/.../traces/trc_123` | 同上 |
| `e2e/sidebar-active.spec.ts:52` | `const link = page.getByRole("link", { name: "Agent 清單", exact: true })` 後 `link.click()`、`:55 expect(link).toHaveAttribute("data-active")` | `/agents/sales-copilot` 起點 | 同上 |
| `e2e/sidebar-nav.acceptance.spec.ts:70` | `const link = page.getByRole("link", { name: "Agent 清單", exact: true })` 後 `focus()`／`toBeFocused()` | `/agents/sales-copilot` | 同上 |

新 locator：`page.locator('[data-sidebar="menu-button"]').filter({ hasText: "Agent 清單" })`（`sidebar-nav.acceptance.spec.ts:5,56` 已用 `[data-sidebar="menu-button"]`，`SidebarMenuButton` 以 `render={<Link/>}` 產生 `<a>`，仍是 link 且帶 `data-active`）。為避免 `hasText` 子字串命中其他項，限定 `exact` 效果：`.filter({ has: page.getByText("Agent 清單", { exact: true }) })`，或沿用現有 `getByRole("link", { name: "Agent 清單", exact: true }).and(page.locator('[data-sidebar="menu-button"]'))`（developer 擇一，須讓三個斷言在兩頁都唯一命中側邊欄項目）。`sidebar-active.spec.ts:34,40` 的「成本儀表板」兩頁都無第二個同名連結，**不需改**；`:46`（成本儀表板／異常／系統頁）、`:65`（已限定 Sheet）、`sidebar-nav.acceptance.spec.ts:80`（`/cost-dashboard` 起點，無麵包屑）**不需改**。

**已確認不受影響（不需改）**

- `e2e/agents.spec.ts:23,34`：`getByRole("link", { name: "Agent 清單" })`，頁面為 `/cost-dashboard` 與 `/agents`（無麵包屑；`/agents` 清單頁不在範圍）。`agents.spec.ts:16,27` 的 heading 同。
- `e2e/agent-detail.spec.ts:882-934`、`e2e/trace-detail.spec.ts:248-297`：`getByRole("link", { name: "返回 Agent 清單" | "返回 Agent 明細" })`，字串比對為子字串，麵包屑連結名稱（「治理」「Agent 清單」「Sales Copilot」）不含這兩個字串；返回連結文字**不改**。
- `e2e/agent-detail.spec.ts:56`：`getByRole("heading", { name: "Sales Copilot" })`——麵包屑不是 heading，不影響。`getByText("Sales Copilot")` 全 repo 無用法（Grep）。
- `e2e/agent-detail.spec.ts:53`、`e2e/trace-detail.spec.ts:83`：`page.locator("header").getByText("Agent Control Tower")` 要求 0 個——麵包屑不含該字串，仍成立。
- `e2e/date-rollout.acceptance.spec.ts:43`：`page.locator("header").getByText("2026年10月20日", { exact: true })`——日期 span 保留在 header 內，仍成立。
- `e2e/i18n-cost-dashboard-strings.spec.ts:36-37`：`getByText("治理")`／`getByText("Agent 清單")` 於 `/cost-dashboard`——無麵包屑，不受影響。
- `e2e/trace-detail.spec.ts:35`、`e2e/sidebar-nav.acceptance.spec.ts:63`：`getByText(TRACE_ID).locator("xpath=ancestor::tr")`——發生在 Agent 詳情頁（麵包屑**不含**執行 ID），仍唯一。執行詳情頁上無 `getByText(<traceId>)` 用法（Grep 確認）；注意 `trc_123`（7 字元）依規則**不截短**，未來若在執行詳情頁用 `getByText("trc_123")` 會同時命中 h1 與麵包屑，新測試請用 `getByRole("navigation", { name: "麵包屑" })` 範圍。
- `e2e/sidebar-nav.acceptance.spec.ts:5` 的 `ACTIVE` selector 限 `[data-sidebar="menu-button"]`，麵包屑連結不在其內，「恰好一個 active」不受影響。
- 執行詳情頁多數既有 e2e（`trace-detail.spec.ts` Scenario 2 起）**只 mock `/spans`、沒有 mock `/cost-breakdown`**：新增的名稱查詢會打到未 mock 的 `NEXT_PUBLIC_BFF_URL`（`http://localhost:8000`）——失敗時走 fallback（顯示 key），所有斷言與 `getByText` 皆不依賴麵包屑，**不會失敗**；但可能產生網路錯誤雜訊。developer 不得為此在既有測試補 mock（不必要），新測試自行 mock。
- 跨元素 computed style 耦合：Grep `getComputedStyle|toHaveCSS|一致` 於 `e2e/`：`trace-detail.spec.ts:96-98`（span 列 paddingLeft）、`agents.spec.ts:176` 與 `currency-rollout.acceptance.spec.ts:29`（數字欄 tabular-nums）、`agent-detail.spec.ts:1339,1421`（圖表 pointerEvents）。**無任何涉及 header、連結、麵包屑**，本設計不改其他元素樣式，不會打斷任何耦合測試。
- 溢位類既有測試（`agent-detail.spec.ts:778,1198,1289,1422`、`date-rollout.acceptance.spec.ts:113`）檢查 `documentElement.scrollWidth <= clientWidth`：麵包屑必須在 390px 不造成橫向溢位（見「390px」），否則會打斷這些既有測試。
- 單元測試：vitest 無任何針對兩個 content 元件或 header 的測試（`components/layout/` 僅 `app-sidebar.test.tsx`，不受影響）。

## 介面/API 契約

**無 bff／後端端點異動。** 資料來源沿用既有 `GET /api/agents/{key}/cost-breakdown`（`AgentCostBreakdownResponse.display`）；執行詳情頁新增一次**前端對同一端點的查詢**（見決策 2）。

### 檔案與公開介面

1. **`frontend/lib/breadcrumbs.ts`**（純函式，無 React／無 next 依賴，可直接 vitest）

```ts
export type BreadcrumbItem = {
  label: string;   // 顯示文字（已截短／已 fallback）
  href?: string;   // 有 href 且非最後一層 -> 渲染為連結
  title?: string;  // 完整文字（tooltip）；預設等於 label
};

export const TRACE_ID_VISIBLE_CHARS = 8;
/** 治理群組沒有落地頁；連到群組第一個可導覽項目（Agent 清單）。見決策 1。 */
export const GOVERNANCE_CRUMB_HREF = "/agents";

/** Array.from(id)（以 code point 計）；length <= 8 原樣，否則前 8 個字元 + "…"（U+2026）。 */
export function truncateTraceId(id: string): string;

export function buildAgentBreadcrumbs(a: { agentKey: string; agentName: string }): BreadcrumbItem[];
export function buildTraceBreadcrumbs(a: { agentKey: string; agentName: string; traceId: string }): BreadcrumbItem[];
```

`buildAgentBreadcrumbs` 回傳：
```
[{ label: t("sidebar.groups.governance"), href: "/agents" },
 { label: t("sidebar.items.agentList"),   href: "/agents" },
 { label: agentName }]                                          // 最後一層，無 href
```
`buildTraceBreadcrumbs` 回傳上述前兩層，加上 `{ label: agentName, href: \`/agents/${agentKey}\` }` 與 `{ label: truncateTraceId(traceId), title: traceId }`。href 與 `BackLink` 現況一致（`/agents/${key}`，不再 `encodeURIComponent`：`useParams` 值直接用於既有 `BackLink`，再編碼會雙重編碼）。`agentName` 的 fallback 由呼叫端決定（見資料來源），builder 不判斷空字串之外的邏輯：`agentName.trim() === "" ? agentKey : agentName`。

2. **`frontend/components/layout/breadcrumbs.tsx`**（`"use client"`，因 `next/link`；純展示）

```tsx
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }): JSX.Element;
```

DOM 結構（桌面／手機同一份）：

```html
<nav aria-label="麵包屑" data-slot="breadcrumbs">
  <ol class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-[22px]">
    <li class="flex min-w-0 items-center gap-2">
      <a href="/agents" class="max-w-[10rem] truncate rounded-sm text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:max-w-xs" title="治理">治理</a>
      <span aria-hidden="true" class="text-text-secondary">/</span>
    </li>
    ... （其餘非最後一層同型）
    <li class="flex min-w-0 items-center">
      <span aria-current="page" class="max-w-[10rem] truncate font-medium text-text-primary md:max-w-xs" title="{完整文字}">{label}</span>
    </li>
  </ol>
</nav>
```

規則：
- 最後一層**一律**渲染 `<span aria-current="page">`（即使傳入 href 也忽略）；其餘層有 `href` 用 `next/link` 的 `<Link>`，無 href 則 `<span class="text-text-secondary">`（防禦，現有 builder 不會產生）。
- 分隔符 `/` 放在**非最後層的 li 內**、`aria-hidden="true"`，不另開 `<li>`（`<ol>` 的 list item 數 = 層數，螢幕閱讀器不朗讀分隔符）。
- `title` = `item.title ?? item.label`（供截斷時查看完整文字）。
- 鍵盤：沿用 `BackLink` 的 focus-visible 樣式（`back-link.tsx:10`）；Link 預設 Enter 啟動即可，**不**複製 BackLink 的 Space 鍵處理（BackLink 的 Space 行為是該元件既有的獨立規格，非麵包屑需求）。
- 無新的色彩 token：`text-accent`、`text-text-primary`、`text-text-secondary` 皆已存在（`globals.css:66-70`）。

3. **`frontend/lib/agent-display.ts`**（Agent 顯示名稱的 client 端快取與 hook，`"use client"`）

```ts
/** 同步讀快取；未命中回 undefined。 */
export function peekAgentDisplayName(key: string): string | undefined;
/** 寫入快取（Agent 詳情頁取得 display 後呼叫）。 */
export function rememberAgentDisplayName(key: string, display: string): void;
/** 取得名稱：命中快取直接 resolve；同 key 進行中的請求共用同一個 Promise；成功才寫快取；失敗不快取（rejected promise 不留在 in-flight map）。 */
export function getAgentDisplayName(key: string): Promise<string>;   // 內部呼叫 fetchAgentCostBreakdown(key).then(r => r.display)
/** 測試用：清空快取與 in-flight。 */
export function clearAgentDisplayCache(): void;
/** 回傳 peek ?? (成功 ? 取得名稱 : key)：載入中與失敗都回 key，永不為空、永不 throw。 */
export function useAgentDisplayName(key: string): string;
```

`useAgentDisplayName` 內部 `useFetchOnce(useCallback(() => getAgentDisplayName(key), [key]))`，回傳 `peekAgentDisplayName(key) ?? (state.status === "success" ? state.data : key)`。`display` 為空字串視同未取得 -> `key`。

4. **`frontend/components/trace-detail/trace-breadcrumbs.tsx`**

```tsx
export function TraceBreadcrumbs({ agentKey, traceId }: { agentKey: string; traceId: string }): JSX.Element;
```
內部 `const name = useAgentDisplayName(agentKey)`，渲染 `<Breadcrumbs items={buildTraceBreadcrumbs({ agentKey, agentName: name, traceId })} />`。使用處必須帶 `key={agentKey}`（見決策 3）。

5. **`frontend/lib/i18n/messages.ts`** 僅新增：`breadcrumb: { ariaLabel: "麵包屑" }`（頂層，緊接 `sidebar` 之後）。「治理」「Agent 清單」**重用** `sidebar.groups.governance`、`sidebar.items.agentList`（單一來源，側邊欄改名時麵包屑同步）。

### 兩頁修改點（唯一允許的既有檔案異動）

**`agent-detail-content.tsx`**
- fetcher 改為（寫入快取，供之後進執行詳情頁直接命中，不再多打一次）：
  ```ts
  const fetcher = useCallback(
    () => fetchAgentCostBreakdown(key).then((d) => { rememberAgentDisplayName(key, d.display); return d; }),
    [key],
  );
  ```
- `<header>` 改為 `className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg px-6 py-3"`，內容：先 `<Breadcrumbs items={buildAgentBreadcrumbs({ agentKey: key, agentName: state.status === "success" && state.data.display ? state.data.display : key })} />`，其後把**原有** `BackLink` ＋ 日期 `<span>` 原封包進 `<div className="flex items-center justify-between">`（其文字、順序、class 皆不變）。

**`trace-detail-content.tsx`**
- `<header>` 同上 class；先 `<TraceBreadcrumbs key={key} agentKey={key} traceId={traceId} />`，其後 `<div className="flex items-center justify-between"><BackLink … 不變 /></div>`。

### 載入／錯誤 fallback（Agent 名稱層）

| 情境 | 麵包屑第三層 |
|------|--------------|
| Agent 詳情頁 loading／error | `key`（如 `sales-copilot`），為純文字 current |
| Agent 詳情頁 success | `display`（如 `Sales Copilot`） |
| 執行詳情頁，快取命中（由 Agent 詳情頁進入） | `display`，無閃爍、無額外請求 |
| 執行詳情頁，查詢中 | `key`（連結，仍可點） |
| 執行詳情頁，查詢失敗（含未 mock／網路錯誤／404） | `key`；不顯示錯誤、不重試、不影響頁面其餘部分 |
| `display` 為空字串 | `key` |

麵包屑永遠有 4（或 3）層、永遠不空白、不 throw。查詢完成後文字由 `key` 換成 `display`（一次重繪，不改版面結構）。

## 資料模型

無新增資料模型（無 table／欄位／索引）。僅一個 **module-level 前端記憶體快取** `Map<string, string>`（key -> display）與 in-flight `Map<string, Promise<string>>`，生命週期為單一頁面載入（重新整理即清空），不持久化、不跨分頁。

## 關鍵技術決策

1. **「治理」連到 `/agents`（範圍界定）**：規格寫「前三層為連結」，但「治理」只是側邊欄群組標籤、沒有任何頁面（`app-sidebar.tsx:41`）；規格未提供目的地。最保守且與規格一致的讀法：連到該群組**第一個可導覽項目**＝「Agent 清單」`/agents`（`app-sidebar.tsx:43`）——不新增路由、不新增頁面、不違反「不得為其他頁面加路徑」，且點擊後落在「治理」群組內、使用者不會迷路。替代方案：把「治理」渲染為純文字（違反「前三層為連結」）、建立 `/governance` 落地頁（新增產品範圍）——皆不採用。已知代價：第 1、2 層同目的地。此為可逆的一行常數（`GOVERNANCE_CRUMB_HREF`），若 PM 希望不同，只改該常數；不構成阻擋 G1b 的開放問題，審閱時請留意。
2. **Agent 名稱資料來源 = 前端查同一端點 `/cost-breakdown` + 模組快取（不加 bff 端點、不改 `/spans` 回應）**：`/spans` 回應無 display，改後端會擴大範圍並影響 bff 契約測試；`/cost-breakdown` 已是 Agent 名稱的唯一權威來源（Agent 詳情頁的 h1）。快取＋in-flight 去重避免同頁重複請求；Agent 詳情頁成功時 `rememberAgentDisplayName` 寫入，使最常見路徑（Agent 詳情 -> 點某 trace）在執行詳情頁**零額外請求且無閃爍**。代價：直接打開執行詳情網址時多一次較重的 cost-breakdown 請求（僅取 `display`）；若日後 bff 提供輕量 agent 端點可只換 `getAgentDisplayName` 內部實作。SDLCCT-98（返回連結顯示父層名稱）可直接重用 `useAgentDisplayName(key)`。
3. **`TraceBreadcrumbs` 以 `key={agentKey}` 重新掛載**：`useFetchOnce` 的 effect 只依 `retryKey`（`use-fetch-once.ts:35`），不隨 fetcher 變更重抓；同一動態路由在 SPA 內切換到另一個 agent 的 trace 時，元件實例可能被重用而顯示舊名稱。用 `key` 強制重掛是最小修補，不改共用 hook。
4. **麵包屑放在各頁既有 sticky header 內，而非 layout 層元件**：layout 是 server component，沒有桌面頂列（`layout.tsx:36-41`）；做成 layout 層需新增一整列、依 `usePathname` 解析路由並**自行**取得 Agent 名稱（與頁面各取一次，Agent 詳情頁已有 `display` 卻無法共用），且會影響所有頁面（含成本儀表板，違反範圍外）。各頁 header 本來就是「頂列」，現有兩頁已持有 `key`／`traceId`（及 Agent 頁的 `display`），per-page 零重複請求、零影響其他頁。代價：兩頁各用一次元件，由共用 `Breadcrumbs`＋`lib/breadcrumbs.ts` builder 保持一致。
5. **header 改為 `flex-col`：麵包屑獨立一列、其下保留原「返回連結＋日期」列**：不更動返回連結文字與位置關係（範圍外，SDLCCT-98 才改）；日期 span 與 BackLink 原封包進內層 div，既有 `header` 範圍內的文字斷言（日期 `date-rollout.acceptance.spec.ts:43`）不變。
6. **執行 ID 截短＝前 8 個字元 + `…`（U+2026），長度 <= 8 不加省略號**：與 repo 內「無截短慣例」不衝突（新規則）；8 為常見短雜湊長度，足以辨識。例：`trace-0123456789abcdef` -> `trace-01…`；32 位 hex `a1b2c3d4e5f60718…` -> `a1b2c3d4…`；`trc_123`、`trc_9` 原樣。以 `Array.from` 計 code point，避免切斷代理對。完整 ID 放 `title`（頁面 h1 `執行詳情 — {traceId}` 仍顯示完整 ID，`trace-detail-content.tsx:40` 不動）。
7. **重用既有 i18n 字串，只新增 `breadcrumb.ariaLabel`**：單一來源，避免側邊欄改名後麵包屑漂移。
8. **自建元件，不加依賴／不加 `ui/breadcrumb`**：規格範圍小，且 `ui/` 目前無該元件；新增 shadcn registry 檔等於新增 UI 基礎件，非本票所需。
9. **a11y 慣例**：`<nav aria-label>` ＋ `<ol>`／`<li>` ＋ 分隔符 `aria-hidden` ＋ 最後一層 `aria-current="page"` 為標準 WAI-ARIA breadcrumb 範式；repo 內此前沒有 `aria-current`／nav landmark 慣例（SDLCCT-96 設計文件已記錄 Grep 結果），故此為首例。
10. **既有 e2e 以「側邊欄範圍 locator」修正，而不是在麵包屑上做變通（如給麵包屑連結不同名稱）**：規格明訂文字為「Agent 清單」，不能為了避開測試歧義改文字或 role。

### 390px／手機

- 麵包屑 `ol` 為 `flex flex-wrap`：層級放不下時**換行**，不橫向捲動；不隱藏任何層級（4 層都是可點的導覽與規格要求，隱藏中間層會讓使用者失去回到 Agent 的路徑）。
- 每一層文字 `truncate`（`overflow-hidden text-ellipsis whitespace-nowrap`）並限寬：手機 `max-w-[10rem]`（160px），`md` 以上 `md:max-w-xs`（320px）；`li` 帶 `min-w-0` 以使 truncate 在 flex 內生效。長 Agent 名稱以 `…` 截斷，完整名稱在 `title`。
- 最壞情況 390px：header 內寬 = 390 - 2x24(px-6) = 342px。「治理 / Agent 清單 / {160px} / {截短 ID 約 75px}」約 28+70+160+75+3x(8+6) ≈ 375px > 342px -> 自動換成兩行，不溢位。
- `SidebarTrigger` 列（`layout.tsx:37`，`md:hidden`）在 header 之上，不受影響。

## 測試策略

**既有測試異動**：僅「現狀查核」表列的 4 處 locator（`sidebar-active.spec.ts:33,39,52(+55)`、`sidebar-nav.acceptance.spec.ts:70`）；其餘無需改。

**新增單元測試（vitest）**
- `frontend/lib/breadcrumbs.test.ts`：`truncateTraceId` 表格——`""`->`""`、`trc_123`->原樣、8 字元 `abcdefgh`->原樣、9 字元 `abcdefghi`->`abcdefgh…`、`trace-0123456789abcdef`->`trace-01…`、含 emoji／代理對（`😀`x10）不切斷；`buildAgentBreadcrumbs`（3 層、href 值、最後一層無 href）；`buildTraceBreadcrumbs`（4 層、第 3 層 href `/agents/{key}`、第 4 層 label 截短＋`title` 完整）；`agentName` 空白 -> fallback 為 `agentKey`。
- `frontend/components/layout/breadcrumbs.test.tsx`：`nav` 有 `aria-label="麵包屑"`；`ol` 下 li 數 = 層數；非最後層為 `<a>` 且 `href` 正確；最後層為 `span` 且 `aria-current="page"`、非最後層**無** `aria-current`；最後層即使給 href 也不渲染連結；分隔符 `aria-hidden="true"` 且不在 accessibility tree（`getByRole("listitem")` 數量）；`title` 為完整文字；長文字節點帶 `truncate` class。
- `frontend/lib/agent-display.test.ts`（`vi.mock("@/lib/agent-detail-api")`）：未命中 -> 呼叫一次 fetch 並快取；同 key 並行兩次只打一次；命中快取不再打；失敗 reject 且不快取（下一次會重打）；`rememberAgentDisplayName` 後 `peek` 命中；`beforeEach` 呼叫 `clearAgentDisplayCache()`。
- `frontend/components/trace-detail/trace-breadcrumbs.test.tsx`：loading 時第 3 層文字為 key 且為連結；resolve 後換成 display；reject 後維持 key 且不 throw；預先 `rememberAgentDisplayName` 時首次渲染即為 display。

**新增 e2e（Playwright）** 新檔 `frontend/e2e/breadcrumbs.spec.ts`（沿用 `sidebar-active.spec.ts:6-29` 的 mock 形狀；`display: "Sales Copilot"`，trace id 用長 ID 如 `trace-0123456789abcdef` 另 mock `/spans`）：
- Agent 詳情：`nav[aria-label="麵包屑"]` 內三層文字依序 `治理`、`Agent 清單`、`Sales Copilot`；前兩層為 link；第三層非 link 且 `aria-current="page"`。
- 執行詳情（長 ID）：四層，第 4 層文字 `trace-01…`、`aria-current="page"`、`title` 為完整 ID；短 ID `trc_123` 原樣不加 `…`。
- 點擊導覽：在 Agent 詳情點「Agent 清單」-> `toHaveURL(/\/agents$/)`；點「治理」-> `/agents`；在執行詳情點「Sales Copilot」-> `/agents/sales-copilot`。
- 從 Agent 詳情點某 trace 進執行詳情：麵包屑第 3 層為「Sales Copilot」，且**未**再發出第二次 `/cost-breakdown` 請求（快取命中；`page.on("request")` 計數 = 1）。
- Fallback：執行詳情頁 `/cost-breakdown` 回 500（或不 mock 並 `route.abort()`）-> 第 3 層為 `sales-copilot` 且仍為可點連結，頁面無例外、其餘內容正常。
- 手機（`test.use({ viewport: { width: 390, height: 844 } })`）：兩頁各用長 Agent 名稱（約 60 字元）-> `document.documentElement.scrollWidth <= clientWidth`（沿用 `agent-detail.spec.ts:1422` 作法）、`nav` 自身 `scrollWidth <= clientWidth`、第 3 層 `text-overflow` 為 ellipsis；4 層全部可見（不隱藏）。
- 側邊欄互動回歸：在 Agent 詳情頁麵包屑連結的存在**不**改變側邊欄恰一個 active（既有 `sidebar-nav.acceptance.spec.ts` 已涵蓋，須仍通過）。

**執行**：`cd frontend && NEXT_PUBLIC_BFF_URL=http://localhost:8000 CI=1 npx playwright test --workers=1`，一次只跑一份（不得與其他 worktree 同時跑 e2e）。
**驗收**：`pytest -q`、`npm run test`（vitest 全套）、lint／型別檢查、e2e 全套皆實際執行並通過；不得以「只改前端」為由略過後端。

## UI 原型

見 `docs/design/SDLCCT-97-prototype.html`（靜態、離線可開，真實 token：`--color-bg #ffffff`、`--color-text-primary #1f2937`、`--color-text-secondary #4b5563`、`--color-border #e5e7eb`、`--color-accent #2563eb`，取自 `frontend/app/globals.css:66-70` 與 SDLCCT-96 原型）。內容：Agent 詳情頁與執行詳情頁（桌面）、載入／失敗 fallback（顯示 key）、長 Agent 名稱截斷、390px 手機（含換行不溢位、最壞情況）。

## 開放設計問題(定稿時必須為空)

（無。唯一的規格空缺——「治理」無頁面卻要求為連結——已依最保守讀法決定為連到 `/agents` 並記錄於決策 1；建議 G1b 審閱者確認此取捨，若要不同目的地，僅需改單一常數 `GOVERNANCE_CRUMB_HREF`。）
