# 設計文件 — SDLCCT-83 成本儀表板視覺一致性：統一標題、統計期間標示、中文化卡片說明、增加金額與漲幅拆欄、列可點擊

## 對應需求規格

對應 SDLCCT-83（已過 G1 定稿版）之 Gherkin 驗收條件：標題一致、增加金額
與漲幅分欄顯示＋長度條、紅色只標示在需要強調的位置（長度條與「新增顯著
支出」標籤，其餘金額文字維持一般文字色）、列可點擊進入詳情頁。另涵蓋需
求文字中「統計期間標示」「卡片說明去英文/系統用語」「預算消耗數字旁加
進度條」「增加金額欄兩位小數」「欄位標題期間文字固定第二行」等修正方
向。範圍外：不處理「預算消耗分子分母範圍不一致」「新增顯著支出門檻不
明」兩個資料邏輯問題（PO 另行評估），本票僅沿用現有門檻常數与計算邏
輯,不重新定義;基礎格式函式與可點擊列元件由 SDLCCT-82/101 提供，本票僅
套用。

**現況盤點**（實作前已逐一確認的程式碼事實）：

- 標題不一致**已確認存在**於程式碼：
  `frontend/lib/i18n/messages.ts` 第 10 行 `sidebar.items.costDashboard`
  為「成本儀表板」，但第 30 行 `costOverview.header.title`（頁面 `<h1>`,
  `frontend/app/cost-dashboard/page.tsx` 第 17 行引用）為「成本總覽」，第
  103 行 `app.metadata.title`（`<title>` 標籤）亦為「成本總覽 — Agent
  Control Tower」。三處文字來源各自獨立的 i18n 字串，無共用常數。
- 比較表：`frontend/components/cost-overview/period-comparison-section.tsx`
  目前「增加金額」與「漲幅」合併顯示在同一個 `<td>`（第 70–83 行），且該
  `<td>` 整格文字色以 `agent.delta > 0 ? "text-red-700" : "text-text-
  secondary"` 全列標紅（第 71–73 行）——**已確認為「全列標紅」寫法**，
  需求要求移除。
- 「新增顯著支出」判斷**已是既有常數** `NOTABLE_NEW_SPEND_THRESHOLD_USD
  = 10`（第 15 行，SDLCCT-66 決策：`previous_cost < 10` 時顯示徽章而非百
  分比，嚴格 `<`），**不是**後端回傳的預先計算旗標——
  `PeriodComparisonAgent`（`frontend/lib/generated/bff-types.ts` 第
  277–290 行）只有 `current_cost`/`previous_cost`/`delta`/`delta_pct`/
  `display`/`key`，沒有任何 boolean 旗標欄位。本票沿用此既有常數與判斷
  邏輯原樣套用到新的「增加金額」欄與紅色長度條/徽章，不重新定義門檻（門
  檻定義本身的疑慮屬 PO 另行評估範圍，見上方範圍外）。
- 增加金額兩位小數：`formatSignedTableCurrency`（`frontend/lib/format.ts`
  第 32–36 行）已固定兩位小數，**此項 AC 现状已滿足，不需改動格式函式**，
  拆欄後直接沿用同一函式即可。
- 卡片說明文字英文/系統用語：`frontend/lib/i18n/messages.ts` 第 42 行
  `summary.totalSpend.sub` = 「9 個 Agent 累計（COST，本月至今）」含系統
  用語 `COST`；第 44 行 `summary.totalBudget.sub` = 「已登錄 Agent 的
  budget 加總」含英文 `budget`。**已確認為兩處需中文化的字串**（其餘
  `summary.*.sub`／`governanceGap.*` 字串本身已是完整中文句子，不需改
  動）。
- 預算消耗進度條：`frontend/components/cost-overview/summary-section.tsx`
  的 `budgetConsumedPct` 卡片（第 71–80 行）目前只有數字＋說明文字，沒有
  任何進度條元素；`frontend/components/` 內搜尋不到既有「長度條/進度條」
  共用元件（`frontend/components/common/`、`frontend/components/ui/` 均
  無），本票需新增（內嵌於 `summary-section.tsx`，不另立共用元件，見下方
  決策 5）。
- 可點擊列：`frontend/components/common/clickable-row.tsx`（SDLCCT-101）
  渲染為 `<tr role="button" tabIndex={0}>`，以 `onActivate`/`aria-label`
  接口運作，`frontend/app/agents/page.tsx` 第 104–148 行 `AgentTable` 是
  可直接參考的既有套用範例（含獨立尾端箭頭 `<td>`）。`PeriodComparisonAgent`
  含 `key` 欄位，比對 `AgentTable` 已確立的路由慣例
  (`router.push(`/agents/${agent.key}`)`)，本票沿用相同路由形式導向該
  Agent 詳情頁，`ClickableRow` 可直接重用、無需調整。
- 期間文字固定第二行：目前表頭 `t("costOverview.period.currentPeriod")(range)`/
  `previousPeriod(range)` 各自回傳單一字串「本期花費（range）」/「前期花
  費（range）」，未分行。
- **跨元件樣式耦合測試搜尋**：於 `frontend/e2e/` 搜尋
  `toEqual`/`一致`/`getComputedStyle` 等跨元素樣式相等斷言，**未發現**任
  何測試將本票要改動的選擇器（比較表 `<td>` 文字色、卡片說明文字、
  `<th>` 表頭）與另一元件的計算樣式綁定相等。
- **既有測試現狀,會因本票改動而需要開發者同步更新**（非本設計文件要修
  改,僅盤點供 developer 知悉,避免漏改)：
  - `frontend/e2e/cost-dashboard.spec.ts` 第 16 行、
    `frontend/e2e/i18n-cost-dashboard-strings.spec.ts` 第 13、26 行斷言
    `getByRole("heading", { name: "成本總覽" })` 與 `toHaveTitle("成本總
    覽 — Agent Control Tower")`，標題文字改為「成本儀表板」後需同步更
    新。
  - `frontend/components/cost-overview/period-comparison-section.test.tsx`
    的 `deltaCellText` 假設「增加金額＋漲幅」在同一個（最後一個）
    `<td>`，拆欄後此輔助函式與其斷言字串（如
    `"+US$ 250.00（50.0%）"`）需同步更新為兩欄分別斷言。

## 介面/API 契約

無，本票純前端 UI 調整（標題文字、表格欄位拆分、進度條、可點擊列），不
涉及任何後端 API 端點或 request/response 格式變更；沿用現有
`GET /api/cost-overview/summary` 與 `GET /api/cost-overview/period-comparison`
既有回應結構（`PeriodComparisonAgent`：`current_cost`/`previous_cost`/
`delta`/`delta_pct`/`display`/`key`）。

## 資料模型

無新增資料模型。

## 關鍵技術決策

1. **標題統一為「成本儀表板」，修改
   `frontend/lib/i18n/messages.ts` 的 `costOverview.header.title` 與
   `app.metadata.title`，`sidebar.items.costDashboard` 維持不變。**
   理由：後者已是需求要求的正確文字，只需讓前兩處追上；不建立新的共用
   常數（如 `PRODUCT_PAGE_NAME`）是因為目前只有這一個頁面出現此類不一
   致，沿用既有「各頁面各自一組 i18n 字串」慣例，不為單一案例引入新抽
   象層。

2. **比較表欄位拆為「Agent / 本期花費 / 前期花費 / 增加金額（含長度條）
   / 漲幅」五欄，取代現有「Agent / 本期 / 前期 / 漲幅（金額+百分比合
   併）」四欄。**
   理由：直接對應 AC「增加金額與漲幅顯示在兩個獨立欄位」；長度條只放在
   增加金額欄（AC 明確只要求這一欄要有長度條），漲幅欄維持純文字百分比
   或徽章。

3. **長度條寬度計算：`widthPct = delta > 0 ? (delta / maxPositiveDelta) *
   100 : 0`，其中 `maxPositiveDelta = Math.max(1, ...agents.map(a =>
   Math.max(a.delta, 0)))`（取 1 避免全部非正數時除零）。delta ≤ 0 的列
   不顯示長度條（寬度 0）。**
   理由：長度條的語意是「比較各 Agent 增加金額的大小」（AC 原文），對花
   費下降的列畫出長度條沒有意義，也避免長度條顏色需要額外處理「負值」
   語意；以全表最大正增加金額為基準做相對比例，符合「一眼比較各 Agent
   增加金額大小」的使用者故事目標。

4. **移除全列標紅：增加金額文字一律用 `text-text-primary`（一般文字
   色）；紅色只施加在長度條填色（`bg-red-600`／對照既有 `text-red-700`
   同色階，觸發「新增顯著支出」門檻的列）與「新增顯著支出」徽章（沿用
   既有 `border-red-300 bg-red-50 text-red-700` 樣式，不變）；未觸發門
   檻的列之長度條改用中性色 `bg-accent`。**
   理由：直接對應 AC「紅色只用在長度條與新增顯著支出標籤上，其餘列的
   金額文字維持一般文字色」；沿用既有 `--color-accent` token 作為「非強
   調」長度條色，不另創新色值（design-system.md 既定方向）。觸發門檻的
   判斷沿用現有 `NOTABLE_NEW_SPEND_THRESHOLD_USD`（見現況盤點），不重新
   定義。

5. **預算消耗進度條直接內嵌於 `summary-section.tsx` 的
   `budgetConsumedPct` 卡片內（一個 `<div className="h-1.5 rounded-full
   bg-gray-100">` 包一個依百分比設寬的填色 `<div>`），不另立共用元件。**
   理由：目前全站僅此一處需要「數字旁的簡單水平進度條」，與增加金額欄
   的長度條用途、資料來源（百分比 vs 金額相對比例）、觸發強調色的條件都
   不同，抽成共用元件抽象層級訂得太早（違反「只設計本票需求」原則）；
   若未來有第三處類似需求再評估抽共用元件。填色超過 100% 時（`overBudget`
   既有判斷）用 `bg-red-600`，否則用 `bg-accent`，與卡片既有 `danger`
   邏輯一致，不新增判斷條件。

6. **表頭「本期花費」/「前期花費」與期間文字（如「10/1–10/28」）拆成兩
   行渲染（`<span className="block">本期花費</span><span
   className="block text-text-secondary">10/1–10/28</span>`），`t()` 的
   `currentPeriod`/`previousPeriod` 函式簽名不變（仍回傳可內插的字串),
   改為在呼叫端用 `.split` 或新增 `currentPeriodLabel`/
   `previousPeriodLabel` 純標籤鍵 + 既有 `formatDateRange` 分開渲染。**
   理由：期間文字本身已由既有 `formatDateRange` 產生,只是過去跟標籤字
   串接成一行；改成兩個獨立 i18n 鍵（標籤純文字 + 既有的 range 格式化函
   式分開渲染)比起用正規表達式切原本組合字串更不易壞,且不影響
   `formatDateRange` 本身。

7. **比較區塊標題右側的「統計期間 2026/10/01 – 2026/10/15」用
   `current_period.start`/`current_period.end`（API 既有欄位）分別透過
   `formatSlashDate` 格式化後以「 – 」串接,不新增 `lib/format.ts` 函
   式。**
   理由：`formatSlashDate` 已產生「YYYY/MM/DD」格式,與需求範例文字格式
   相符;只有這一個呼叫點需要「兩個日期中間加 – 」的組合,直接在元件內
   組字串即可,不需要為單一呼叫點新增一個新的 `formatDateRangeWithYear`
   之類函式(避免 `lib/format.ts` 堆積僅一處使用的高度特化函式)。

8. **表格每列改用既有 `ClickableRow`（SDLCCT-101）包裝,`onActivate` 導
   向 `` `/agents/${agent.key}` ``,並依 `AgentTable` 既有慣例新增一個
   尾端 `aria-hidden` 箭頭 `<td>`（欄位數因此由 5 變 6)。**
   理由：直接套用「已過 G1 定稿、已驗證可用」的共用元件與既有慣例（見
   SDLCCT-101 設計文件決策 1、6），不重新發明可點擊列或箭頭樣式；
   `agent.key` 已存在於現有 API 回應,不需新增欄位。

9. **卡片說明英文/系統用語中文化：`summary.totalSpend.sub` 改為「9 個
   Agent 累計（本月至今）」(移除 `COST`)、`summary.totalBudget.sub` 改為
   「已登錄 Agent 的預算加總」(移除 `budget`)。**
   理由：直接對應 AC「卡片說明文字去除英文/系統用語，改用完整中文句
   子」；只改動這兩處已確認含英文的字串，其餘 `summary.*` 字串經逐一檢
   查已是完整中文句子，不動它們（避免無謂改動既有已通過的文案）。

## UI 原型

見 `docs/design/SDLCCT-83-prototype.html`（可直接在瀏覽器開啟），示範：
統一後的頁面標題與「統計期間」標示、拆欄後的比較表（增加金額欄含長度
條、漲幅獨立欄、表頭期間文字固定第二行、一般列與觸發「新增顯著支出」
門檻列的紅色僅用在長度條/徽章而非整列文字）、可點擊列的 hover 狀態、以
及預算消耗卡片的進度條。

## 開放設計問題(定稿時必須為空)

無。「新增顯著支出」門檻定義本身的疑慮屬 G1 規格已明確列為範圍外（PO 另
行評估的資料邏輯問題），本票沿用現有程式碼常數 `NOTABLE_NEW_SPEND_
THRESHOLD_USD = 10` 原樣套用，不構成本票需要 PO 再決策的開放問題。
