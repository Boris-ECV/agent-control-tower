# 設計文件 — SDLCCT-103 所有頁面頂列統一顯示「資料更新於 YYYY/MM/DD HH:mm（台灣時間）」

## 對應需求規格

G1 已通過的版本。PO 決策（SDLCCT-104 選項 C）：頂列顯示的時間為「**頁面載入時間**」，在**瀏覽器端於元件掛載時取當下時間**，**不是** bff 回傳的時間戳；**不更動 bff**；標籤文字為「資料更新於」。

Gherkin 驗收情境（摘要）：

1. 格式為「資料更新於 2026/10/15 14:30（台灣時間）」，24 小時制，無秒。
2. 舊文字「今天（台灣時間）：」與僅有日期的文字不再出現。
3. 瀏覽器時間 UTC 06:30 -> 顯示 14:30。
4. UTC 2026-10-15 17:05 -> 顯示 2026/10/16 01:05。
5. bff 請求失敗**不影響**頂列：仍顯示時間，不出現「無法取得」。
6. 無 hydration mismatch、無 layout shift：時間於客戶端掛載後填入，掛載前以預留空間／佔位呈現。
7. 既有單元／e2e 測試中斷言舊文字或舊日期者必須更新，並使用固定／模擬時鐘（Playwright `page.clock`、vitest `vi.useFakeTimers`），不得依賴真實時鐘。

**範圍外**：任何 bff 變更；變更 `anchor_date` 語意或其他用途（圖表、期間比較）；四個頂列以外的任何位置；時間自動刷新；編輯歷史 `docs/design/*` 文件。規格沒有開放問題。

## 現狀查核（實作前已逐字讀取）

### 四個頂列（皆為 `<header className="sticky top-0 z-10 … border-b border-border bg-bg px-6 py-3">`，時間文字樣式皆為 `text-xs leading-[18px] text-text-secondary`）

| 位置 | 現況 |
|------|------|
| `frontend/app/cost-dashboard/page.tsx:18-23` | `flex items-center justify-end`；`{t("costOverview.header.today")}` + `anchorDate ? formatTaiwanDate(anchorDate) : t("costOverview.header.unavailable")`。`anchorDate` 為 `useState`（第 14 行），由 `<SummarySection onAnchorDate={setAnchorDate} />`（第 37 行）回填。 |
| `frontend/app/anomalies/page.tsx:24-30` | `flex items-center justify-end`；僅日期：`state.status === "success" ? formatTaiwanDate(state.data.anchor_date) : t("costOverview.header.unavailable")`。 |
| `frontend/app/agents/page.tsx:185-191` | 同上（`fetchAgentsList` 的 `anchor_date`）。 |
| `frontend/components/agent-detail/agent-detail-content.tsx:50-65` | `flex flex-col gap-2` header；第二列 `flex items-center justify-between`，左為 `BackLink`、麵包屑在第一列，右為日期 `<span>`（第 59-63 行）。 |

### 文字與格式輔助

- `frontend/lib/i18n/messages.ts:26-27`：`costOverview.header.today = "今天（台灣時間）："`、`unavailable = "無法取得"`。Grep `frontend/`（排除 node_modules）後，`costOverview.header.today`／`.unavailable` 只被上述四個頂列引用，本票改完即無引用。
- `frontend/lib/format.ts:166-185` `formatSlashDateTime(iso)`：輸入 ISO 字串，輸出 `YYYY/MM/DD HH:mm:ss`（`Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hourCycle: "h23", … })` + `formatToParts`），含秒、無效值回 `"—"`。
- `formatTaiwanDate`（format.ts:95）標註 `@deprecated`，但 `components/agent-detail/version-cost-chart.tsx:436`（tooltip）仍使用，**不得刪除**；本票改完後頂列四處不再引用它。`formatTaiwanDateTime`（format.ts:112）全 repo 已無引用，本票不動（不擴大範圍）。
- `SummarySection`（`components/cost-overview/summary-section.tsx:36-62`）：`onAnchorDate` 是**唯一**使用者為 `cost-dashboard/page.tsx` 的可選 prop，且在 **render 期間**直接呼叫（第 44、55、62 行）；`summary-section.test.tsx` 不使用該 prop（Grep 確認，僅第 22 行的 mock 資料含 `anchor_date`）。`anchor_date` 在 `SummarySection` 內沒有其他用途。
- 專案 lint 啟用 `react-hooks/set-state-in-effect`（`lib/use-fetch-once.ts:37-39` 註解），effect 本體內不得同步 `setState`；React 19.3、Next 16.4.2；vitest 環境 `jsdom`（`vitest.config.ts:7`）。

### 跨元素樣式耦合測試稽核

本設計不變更任何現有 selector 的 computed style（時間文字沿用相同 class），僅在**新元件的 span** 上加 `text-right` 與兩段 `whitespace-nowrap`（見決策 6，僅影響換行行為）。Grep `e2e/` 中 `getComputedStyle|toHaveCSS|一致|toEqual(` 與 header／頂列相關者：無任何比較兩元素 computed style 相等的斷言涉及頂列日期 span 或 `BackLink`（SDLCCT-98 設計文件同結論）。無耦合鏈需處理。

## 介面/API 契約

**無 bff／後端端點異動；無新增網路請求；不讀取任何 API 回應欄位。** 頂列時間完全由瀏覽器端 `new Date()` 產生。

### 1. 格式輔助函式（`frontend/lib/format.ts`）

新增匯出，並把 `formatSlashDateTime` 內的 Intl 邏輯抽成**私有**共用函式，兩者共用（不複製貼上；`formatSlashDateTime` 對外輸出**完全不變**，其既有測試 `format.test.ts:226-252`、`format.dates.acceptance.test.ts` 不需改）：

```ts
/** Asia/Taipei 24h fields for a Date, zero-padded. Private. */
function taipeiParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string };

/** Date in Asia/Taipei, 24-hour, minute precision:
 *  new Date("2026-10-15T06:30:00Z") -> "2026/10/15 14:30"
 *  new Date("2026-10-15T17:05:00Z") -> "2026/10/16 01:05". Invalid Date -> "—". */
export function formatSlashDateTimeMinute(date: Date): string;
```

- 輸入為 `Date`（呼叫端為 `new Date()`），而非 ISO 字串：不需字串解析與 `parseCalendarDate` 檢查；`Number.isNaN(date.getTime())` 時回 `"—"`（與同檔「缺值／無效值一律回 em dash」慣例一致）。
- 分鐘精度的實作 = `taipeiParts` 的 `${year}/${month}/${day} ${hour}:${minute}`；`formatSlashDateTime` 改為 `…${hour}:${minute}:${second}`。
- 00:xx 一律 `00`（`hourCycle: "h23"`，不出現 `24:`），沿用既有保證。

### 2. 訊息（`frontend/lib/i18n/messages.ts`）

新增頂層區塊，並**刪除** `costOverview.header.today` 與 `costOverview.header.unavailable`（改完後零引用；舊字串隨之消失即符合情境 2）：

```ts
pageHeader: {
  updatedAt: (time: string) => `資料更新於 ${time}`,
  timezone: "（台灣時間）",
},
```

- 拆成兩段是為了 390px 換行控制（決策 6）；DOM 文字相接為「資料更新於 2026/10/15 14:30（台灣時間）」，與規格逐字相同。
- 呼叫沿用既有函式值訊息慣例：`t("pageHeader.updatedAt")(time)`（同 `period-comparison-section.tsx:41`、`messages.ts:61-62`），`t.ts` 不需改。

### 3. 共用元件 `frontend/components/layout/page-header-timestamp.tsx`（新檔）

```tsx
"use client";
export function PageHeaderTimestamp(): JSX.Element;   // 無 props
```

- 放在 `components/layout/`（與 `breadcrumbs.tsx`、`app-sidebar.tsx` 同層，屬跨頁共用的版面元件）。
- **無 props**：時間永遠是「掛載當下」，不接受外部資料，因此也不可能被 bff 狀態影響（情境 5 由結構保證，而非靠分支）。
- 渲染（外層 `<span>` 樣式與四處現況逐字相同，再加 `text-right`）：

```tsx
<span
  data-testid="page-header-timestamp"
  className="text-right text-xs leading-[18px] text-text-secondary"
>
  {time === null ? (
    // 佔位：與載入後同結構、同字數，visibility:hidden 保留版面，螢幕閱讀器略過
    <span aria-hidden="true" className="invisible">
      <span className="whitespace-nowrap">{t("pageHeader.updatedAt")(PLACEHOLDER)}</span>
      <span className="whitespace-nowrap">{t("pageHeader.timezone")}</span>
    </span>
  ) : (
    <>
      <span className="whitespace-nowrap">{t("pageHeader.updatedAt")(time)}</span>
      <span className="whitespace-nowrap">{t("pageHeader.timezone")}</span>
    </>
  )}
</span>
```

- `PLACEHOLDER = "0000/00/00 00:00"`（與實際格式等長，模組內常數）。
- 取時間方式（lint 安全、無 hydration mismatch）：**`useSyncExternalStore`**，每個元件實例持有自己的小 store：

```ts
const subscribe = () => () => {};                         // 時間不會變，無需訂閱
const [store] = useState(() => ({ cached: null as string | null }));
const time = useSyncExternalStore(
  subscribe,
  () => (store.cached ??= formatSlashDateTimeMinute(new Date())),  // client snapshot：首次呼叫時取時並快取，之後穩定
  () => null,                                                       // server snapshot / hydration：null -> 佔位
);
```

  - SSR 與 hydration 期間 React 使用 `getServerSnapshot`（`null`）-> 伺服器 HTML 與客戶端首次 hydrate 輸出皆為佔位，**一致**；hydrate 完成後 React 自動以 `getClientSnapshot` 重繪為真實時間，這是 `useSyncExternalStore` 官方支援的「server/client 值不同」路徑，不會發出 mismatch 警告。
  - 純客戶端導覽（側邊欄切頁，元件首次在瀏覽器掛載、無 hydration）直接取 client snapshot，首次 render 即為真實時間；每次進入頁面（元件新實例）重新取時 = 「頁面載入時間」。同一頁停留期間**不刷新**（範圍外）。
  - `getSnapshot` 以實例內 `store.cached` 快取，滿足「重複呼叫回傳相同值」的要求，避免無限重繪。

### 4. 四處頂列的修改（只換時間 `<span>`，其餘結構／class 不動）

| 檔案 | 修改 |
|------|------|
| `app/cost-dashboard/page.tsx` | `<span>…</span>`（第 19-22 行）-> `<PageHeaderTimestamp />`；刪除 `anchorDate` state（第 11-14 行含舊註解）、`useState` 與 `formatTaiwanDate` import；`<SummarySection onAnchorDate={setAnchorDate} />` -> `<SummarySection />`。 |
| `components/cost-overview/summary-section.tsx` | **移除 `onAnchorDate` prop 與三處呼叫（第 37-39、44、55、62 行）及其上方 doc 註解**；元件其餘邏輯與其他 `summary.anchor_date` 無關的程式碼不動。 |
| `app/anomalies/page.tsx` | `<span>…</span>`（第 25-29 行）-> `<PageHeaderTimestamp />`；刪除 `formatTaiwanDate` import。 |
| `app/agents/page.tsx` | 同上（第 186-190 行）；`import { formatTableCurrency, formatPercent, formatTaiwanDate }` 刪去 `formatTaiwanDate`。 |
| `components/agent-detail/agent-detail-content.tsx` | 第 59-63 行 `<span>` -> `<PageHeaderTimestamp />`；刪除 `formatTaiwanDate` import（第 15 行）。`state.data.anchor_date` 仍用於 `VersionCostChart anchorDate`（第 99 行），不動。 |

四頁的 header 版面（`flex items-center justify-end` / `justify-between`）、`sticky`、padding、邊框皆不變。

## 資料模型

**無新增資料模型。** 無 DB、無 API schema、無持久化；頂列時間是元件內的衍生顯示值（每個元件實例一個記憶體內字串快取，隨元件卸載消失）。

## 關鍵技術決策

1. **新增 `formatSlashDateTimeMinute(date: Date)`，並與 `formatSlashDateTime` 共用私有 `taipeiParts`，而非 `.slice(0, 16)` 或改既有函式**：`slice` 依賴輸出字串固定長度、且要先把 `Date` 轉 ISO 再解析一輪，脆弱；直接改 `formatSlashDateTime` 去掉秒會打破其既有測試與 span 時間顯示（`trace-detail` 的 `YYYY/MM/DD HH:mm:ss`，SDLCCT-95）。抽共用私有函式保證「同一份 Intl／Asia/Taipei／h23 邏輯」，兩個公開函式輸出各自穩定。
2. **用 `useSyncExternalStore`（server snapshot = `null`），不用 `useEffect + setState`**：專案啟用 `react-hooks/set-state-in-effect`，effect 內同步 setState 會 lint 失敗；`useState(() => new Date())` 在 SSR/hydrate 會造成伺服器與客戶端字串不同（hydration mismatch）；`useSyncExternalStore` 是 React 官方「伺服器與客戶端值不同」的標準解，且在純客戶端導覽時首次 render 即有值（無閃爍）。實例級 `useState(() => ({ cached }))` 取代模組級快取，確保每次進頁面重新取「載入時間」。
3. **單一共用無 props 元件 `PageHeaderTimestamp`，放 `components/layout/`**：四處文字、樣式、佔位行為必須永遠一致，單一來源避免四份漂移；無 props 讓「bff 失敗不影響頂列」成為結構保證。
4. **刪除 `costOverview.header.today`／`unavailable`，不保留**：改完零引用（Grep 確認），保留會成為死 key；「無法取得」不再有任何情境能出現（情境 5）。
5. **移除 `anchorDate` state 與 `SummarySection` 的 `onAnchorDate` prop（而非保留）**：該 prop 唯一用途是回填頂列；保留會讓 `SummarySection` 在 render 期間持續呼叫一個無人訂閱的回呼（本來就是 render 內副作用的壞味道）。已 Grep 確認 `SummarySection` 無其他使用方、其測試未使用該 prop、`anchor_date` 在該元件內無其他用途，故移除不影響圖表／期間比較（它們各自讀自己的資料，`VersionCostChart` 的 `anchorDate` 來自 agent-detail 自己的回應，與本 prop 無關）。
6. **390px 換行：訊息拆兩段、各段 `whitespace-nowrap`，外層 span `text-right`**：完整標籤約 245px，agent-detail 第二列在 342px 內寬要與 `BackLink`（約 120-140px）並排放不下。兩段 nowrap 使換行只可能發生在「…HH:mm」與「（台灣時間）」之間（第一行約 170px、第二行「（台灣時間）」），不會把日期與時間拆開或在括號內斷行；`text-right` 讓兩行靠右對齊。佔位與載入後結構完全相同，因此**換行高度在佔位階段就已預留**，載入前後不會出現垂直位移。其餘三頁頂列僅有此 span（`justify-end`），245px < 342px，單行。此為「不改視覺樣式」的唯一例外（行為性防溢位，同 SDLCCT-98 決策 4 的做法），顏色、字級、行高、位置皆不變。
7. **佔位用 `invisible` + 同結構同字數的 `0000/00/00 00:00`，而非骨架條或空字串**：`invisible`（`visibility:hidden`）保留盒模型大小，空字串會讓高度由 18px 掉為 0（頂列高度跳動）；`aria-hidden` 避免螢幕閱讀器朗讀 0 字串；數字比例字型的寬度差異（`1` 較窄）只影響此 span 自身左緣的次像素～數 px，靠右對齊下不推動任何兄弟元素，不另加 `tabular-nums`（避免樣式變更）。
8. **時區固定 `Asia/Taipei`，與瀏覽器／系統時區無關**：標籤明載「台灣時間」；Asia/Taipei 全年 UTC+8、無日光節約，不存在 DST 邊界問題。
9. **測試以固定時鐘取代真實時鐘**：vitest 用 `vi.useFakeTimers()` + `vi.setSystemTime(...)`（因 `useSyncExternalStore` 同步取值，不需 `advanceTimers`）；Playwright 用 `page.clock.setFixedTime(...)`（只固定 `Date`，不凍結計時器，避免 Next 與 `useFetchOnce` 受影響），並在 `goto` 之前呼叫。`test.use({ timezoneId: "America/Los_Angeles" })` 證明結果不隨瀏覽器時區改變。
10. **不處理 `formatTaiwanDate`／`formatTaiwanDateTime` 的刪除**：前者仍被 tooltip 使用，後者雖零引用但清理屬範圍外，維持最小 diff。

## 受影響的既有測試（逐一盤點；Grep `今天（台灣時間）`、`formatTaiwanDate`、`anchorDate`、`onAnchorDate`、`header`、`無法取得`、`年M月D日` 於 `frontend/`）

### A. 必須修改

| 檔案:行 | 現況 | 新內容 |
|---------|------|--------|
| `e2e/date-rollout.acceptance.spec.ts:166` | `getByText("今天（台灣時間）：2026年10月28日")` | 測試前 `await page.clock.setFixedTime("2026-10-28T06:30:00Z")`（放在 `goto` 前）；改為 `page.getByTestId("page-header-timestamp")` `toHaveText("資料更新於 2026/10/28 14:30（台灣時間）")`。測試標題 `:147`「…keep the old 10/1–10/28 style」維持（期間比較範圍仍是舊樣式，第 165 行斷言不動）。 |
| `e2e/date-rollout.acceptance.spec.ts:42-43`（測試 `:27`） | 註解「top-bar date stays in the old style (SDLCCT-103 replaces it)」；`page.locator("header").getByText("2026年10月20日", { exact: true })` | 測試標題 `:27` 去掉「top-bar date keeps old style」字樣；`goto` 前 `setFixedTime("2026-10-20T06:30:00Z")`；第 43 行改為 `page.locator("header").getByTestId("page-header-timestamp")` `toHaveText("資料更新於 2026/10/20 14:30（台灣時間）")`；更新第 42 行註解。 |

### B. 需要新增斷言但不是「失敗」的既有檔案

- `lib/format.test.ts`：新增 `describe("formatSlashDateTimeMinute")`（見測試計畫），`formatSlashDateTime` 既有 `describe`（226-252）**不改**。

### C. 不需修改（已逐一確認）

- 單元：`components/cost-overview/summary-section.test.tsx`（不用 `onAnchorDate`；移除 prop 後仍通過）、`components/agent-detail/version-cost-chart.test.tsx`（`anchorDate` 是圖表自己的 prop；第 857 行 `formatTaiwanDate` 為 tooltip 註解，tooltip 仍用它）、`lib/format.dates.acceptance.test.ts`、`lib/format.acceptance.test.ts`。vitest 內沒有任何頁面頂列斷言。
- e2e：`date-rollout.acceptance.spec.ts:98-104`、`agent-detail.spec.ts:997`（圖表 tooltip `2026年10月18日`，範圍外且仍用 `formatTaiwanDate`）。`cost-dashboard.spec.ts:12` `locator("header").getByText("Agent Control Tower")` 與 `back-link*.spec.ts`／`breadcrumbs*.spec.ts` 的 locator 皆不含頂列日期文字；新文字「資料更新於 2026/…（台灣時間）」不含這些字串（子字串比對無重疊）。
- 其他 spec 的 `anchor_date: "2026-10-20"` mock 只是 API 回應內容，頁面不再讀取其作頂列，無斷言依賴。
- 無任何既有測試斷言「無法取得」（Grep 確認）。

## 測試計畫（情境 -> 測試）

**新增單元測試（vitest + jsdom）**

1. `frontend/lib/format.test.ts` — `describe("formatSlashDateTimeMinute")`，`it.each`：
   - `2026-10-15T06:30:00Z` -> `"2026/10/15 14:30"`（情境 1、3）。
   - `2026-10-15T17:05:00Z` -> `"2026/10/16 01:05"`（情境 4，跨日）。
   - `2026-10-15T16:00:00Z` -> `"2026/10/16 00:00"`（不得出現 `24:`）；`2026-12-31T16:00:00Z` -> `"2027/01/01 00:00"`（跨年）；`2026-10-15T15:59:59Z` -> `"2026/10/15 23:59"`（無秒、不進位）。
   - 輸出不含秒（`toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)`）；`new Date(NaN)` -> `"—"`。
2. `frontend/components/layout/page-header-timestamp.test.tsx`（新檔；`vi.useFakeTimers()` + `vi.setSystemTime`，`afterEach(vi.useRealTimers)`）：
   - 情境 1/3：系統時間 `2026-10-15T06:30:00Z` -> `screen.getByTestId("page-header-timestamp")` 文字為 `資料更新於 2026/10/15 14:30（台灣時間）`。
   - 情境 4：`2026-10-15T17:05:00Z` -> `…2026/10/16 01:05（台灣時間）`。
   - 情境 2：文字不含 `今天`、不含 `年`／`月`／`日` 型日期（`not.toMatch(/\d{4}年/)`）。
   - 情境 5：元件**無 props、無 fetch**——斷言渲染期間 `fetch`（`vi.spyOn(globalThis, "fetch")`）呼叫 0 次，且文字不含「無法取得」。
   - 情境 6（SSR/hydration）：`renderToString(<PageHeaderTimestamp />)`（`react-dom/server`）-> HTML 含 `aria-hidden="true"` 與 `invisible` 佔位、**不含**真實時間字串、結構（外層 span 的 class、兩段 nowrap span）與載入後相同；再 `hydrateRoot(container, <PageHeaderTimestamp />)` 並 `vi.spyOn(console, "error")`，`act` 後斷言 `console.error` 0 次（無 hydration mismatch），且最終文字為真實時間。
3. `frontend/components/cost-overview/summary-section.test.tsx`：不改（回歸，證明移除 prop 無影響）。
4. `app/cost-dashboard` 整頁渲染測試**不新增**（頁面由 e2e 覆蓋，避免重複）。

**新增／更新 e2e（Playwright，一律 `CI=1 npx playwright test --workers=1`）** — 新檔 `frontend/e2e/page-header-timestamp.spec.ts`，對四頁（`/cost-dashboard`、`/anomalies`、`/agents`、`/agents/sales-copilot`）以 `for…of` 參數化，mock 形狀沿用各頁既有 spec（`agents.spec.ts:58`、`anomalies.spec.ts:59`、`cost-dashboard.spec.ts:26`、`agent-detail.spec.ts:15`；agent-detail 另需 mock `/cost-breakdown`）：

- 情境 1/3：`await page.clock.setFixedTime("2026-10-15T06:30:00Z")` 於 `goto` 前 -> `getByTestId("page-header-timestamp")` `toHaveText("資料更新於 2026/10/15 14:30（台灣時間）")`（4 頁）；`test.use({ timezoneId: "America/Los_Angeles" })` 的一個變體證明不隨瀏覽器時區改變。
- 情境 4：`setFixedTime("2026-10-15T17:05:00Z")` -> `…2026/10/16 01:05（台灣時間）`（至少 1 頁，建議 4 頁共用參數表）。
- 情境 2：同頁 `page.getByText("今天（台灣時間）")` `toHaveCount(0)`，`header` 的 `innerText` 不匹配 `/\d{4}年/`。
- 情境 5：API 全部失敗（各頁既有 route glob 改 `route.fulfill({ status: 500 })`，cost-dashboard 另 `route.abort()` 一例）-> 頂列仍 `toHaveText("資料更新於 2026/10/15 14:30（台灣時間）")`，`getByText("無法取得")` 限定在 `header` 內 `toHaveCount(0)`。
- 情境 6：`page.on("console")` 收集 `error`／`warning`，斷言無包含 `hydrat`（不分大小寫）者；以 `addInitScript` 註冊 `PerformanceObserver({ type: "layout-shift", buffered: true })`，載入完成後取累計 `value` 中 `sources` 指向 `header` 或其子孫節點者，斷言總和為 0；另在 `page.goto(…, { waitUntil: "commit" })` 後與時間填入後各取 `header` `boundingBox().height`，斷言相等（頂列高度不變）。
- 情境 7：上述 A 區兩處既有斷言更新（`date-rollout.acceptance.spec.ts:166`、`:43`）。
- 390px（`setViewportSize({ width: 390, height: 844 })`）：四頁皆 `document.documentElement.scrollWidth <= clientWidth`，且時間 span `boundingBox().right <= 390`；agent-detail 頁另斷言 `BackLink` 與時間 span 的 `boundingBox` 不重疊、span 高度 > 18px（兩行）且前後不變；其餘三頁單行（高度 18px）。

**驗收執行**（一次只跑一份 e2e，不與其他 worktree 同時跑）：`cd frontend && NEXT_PUBLIC_BFF_URL=http://localhost:8000 CI=1 npx playwright test --workers=1`；另 `npm run test`（vitest 全套）、lint／型別檢查、`pytest -q` 皆須實際執行並通過（不得以「只改前端」略過後端）。

## UI 原型

見 `docs/design/SDLCCT-103-prototype.html`（靜態、離線可開；token 取自 `frontend/app/globals.css` 與 SDLCCT-98 原型）。內容：

1. 掛載前（SSR／hydration）佔位狀態：頂列高度與寬度已預留，文字不可見。
2. 載入完成：「資料更新於 2026/10/15 14:30（台灣時間）」。
3. bff 失敗狀態：頁面內容區顯示錯誤卡片，**頂列仍顯示時間，沒有「無法取得」**。
4. 390px 變體：三頁單行頂列、Agent 詳情頁兩行換行（含長 Agent 名稱 BackLink 並存）。

## 風險

- **Hydration**：靠 `useSyncExternalStore` 的 `getServerSnapshot = null` 保證；單元（`hydrateRoot` + `console.error` 監聽）與 e2e（console 無 `hydrat`）雙重驗證。若日後有人把取時改回 render 期間的 `new Date()`，這兩個測試會失敗。
- **SSR／CSR 時鐘差**：伺服器時鐘只在 SSR 階段不被使用（server snapshot 為 `null`），所以伺服器與使用者時鐘不一致不會顯示錯誤時間；顯示的永遠是使用者瀏覽器時鐘（PO 決策 C 的語意：頁面載入時間，而非資料新鮮度）。使用者本機時鐘錯誤時顯示錯誤時間，屬 PO 決策的已知取捨，不處理。
- **DST**：Asia/Taipei 無日光節約，不適用；以固定 UTC+8 的測試值（含跨日、跨年）覆蓋。
- **Next `cacheComponents: true`**：元件為 client component 且 `new Date()` 僅在 client snapshot（瀏覽器）呼叫，不在伺服器 render 路徑；`next build` 的 prerender 不會因非確定性時間而報錯。實作後須實際跑 `npm run build` 確認。
- **390px 換行**：Agent 詳情頁第二列會由單行變兩行（僅此頁，因為有左側 BackLink）；已在佔位階段預留，不造成載入後位移；BackLink 名稱過長時由 SDLCCT-98 已有的 `[overflow-wrap:anywhere]` 處理。
- **佔位寬度差**：載入後數字寬度與 `0` 佔位略有差異（次像素～數 px），僅影響此 span 自身左緣，已接受（決策 7）。
- **時間不刷新**：長時間停留的頁面顯示的仍是載入時刻，標籤「資料更新於」可能被誤解為即時；這是 PO 決策 C 的結果，自動刷新明列範圍外。

## 開放設計問題(定稿時必須為空)

（無。）
