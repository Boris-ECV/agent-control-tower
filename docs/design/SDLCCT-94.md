# 設計文件 — SDLCCT-94 既有頁面金額欄位套用統一格式，表格金額靠右且等寬數字

## 對應需求規格

對應 G1 已核准的需求規格，3 條 Gherkin 情境（已定稿）：

1. 表格金額：任一既有頁面的表格顯示金額 -> `US$ 1,234.56` 格式，欄位靠右並使用 `tabular-nums`。
2. 卡片金額：摘要卡片顯示金額 -> 整數格式（如 `US$ 1,746`）。
3. 既有測試：單元與 e2e 測試期望值已更新且全部通過。

**範圍外**：不改資料欄位、進度條、趨勢合計；不改圖表軸線（SDLCCT-81 已處理）。相依：SDLCCT-92（已在 main）提供 `formatTableCurrency`、`formatCardCurrency`、`formatPercentGrouped`。規格的開放問題：無。

## 現狀查核（實作前已逐字讀取）

- `frontend/lib/format.ts`：`formatTableCurrency`（第 25 行，永遠兩位小數）、`formatCardCurrency`（第 31 行，整數）、`formatPercentGrouped`（第 37 行）已存在；內部共用 helper `groupedAbs`（第 5 行）、`roundsToZero`（第 13 行）、`formatMoney`（第 17 行，`en-US`、負號置於 `US$` 前、四捨五入後為零不帶號、非有限數 -> `—`）。舊 `formatCurrency`（第 49 行）、`formatPercent`（第 61 行）已標 `@deprecated`；`formatSignedCurrency`（第 66 行）**沒有** `@deprecated` 註解，且沒有對應的新函式。
- **呼叫點逐一盤點**（Grep `formatCurrency|formatSignedCurrency`，全 `frontend/`，排除 node_modules，共 17 處呼叫）：

| # | 位置 | 現況 | 分類 | 決定 |
|---|------|------|------|------|
| 1 | `app/agents/page.tsx:122` 預算 `<td>` | `formatCurrency(agent.budget)`（null 時顯示 `agents.unknownBudget`） | TABLE | `formatTableCurrency`；`<td>` 加 `text-right tabular-nums` |
| 2 | `app/agents/page.tsx:124` 本期花費 `<td>` | `formatCurrency(current_period_spend)` | TABLE | 同上 |
| 3 | `app/agents/page.tsx:158` 手機卡片 `<dd>` 預算 | 同 1，在 `AgentCardList`（`md:hidden`） | TABLE（同一份資料的窄螢幕版面，非摘要卡片） | `formatTableCurrency`；`<dd>` 已有 `text-right`，加 `tabular-nums` |
| 4 | `app/agents/page.tsx:162` 手機卡片 `<dd>` 花費 | 同 2 | TABLE（同上） | 同 3 |
| 5 | `components/agent-detail/model-breakdown-table.tsx:30` cost `<td>` | `formatCurrency(entry.cost)` | TABLE | `formatTableCurrency`；`<td>` 加 `text-right tabular-nums` |
| 6 | `components/agent-detail/top-traces-table.tsx:115` cost `<td>` | `formatCurrency(trace.total_estimated_cost)` | TABLE | 同 5 |
| 7 | `components/agent-detail/version-cost-chart.tsx:488` a11y 後備表格日期欄 `<td>` | `formatCurrency(value)` | TABLE | `formatTableCurrency`；`<td>` 加 `text-right tabular-nums` |
| 8 | `version-cost-chart.tsx:224` 終點標籤（SVG `<text>`） | `${version} ${formatCurrency(...)}` | CHART label | **維持舊函式**（見決策 3） |
| 9 | `version-cost-chart.tsx:360` Y 軸標示（SVG `<text>`） | `formatCurrency(label.value)` | CHART AXIS | **維持舊函式**（範圍外：圖表軸線） |
| 10 | `version-cost-chart.tsx:446` hover tooltip（SVG `<text>`） | `${version}: ${formatCurrency(...)}` | CHART label | **維持舊函式**（見決策 3） |
| 11 | `components/cost-overview/summary-section.tsx:71` 總花費卡片 | `formatCurrency(total_spend)` | SUMMARY CARD | `formatCardCurrency`；卡片不改對齊、不加 `tabular-nums` |
| 12 | `summary-section.tsx:76` 總預算卡片 | `formatCurrency(total_budget)` | SUMMARY CARD | `formatCardCurrency` |
| 13 | `summary-section.tsx:91` 預估超支卡片 | `formatCurrency(projected_overspend)` | SUMMARY CARD | `formatCardCurrency` |
| 14 | `summary-section.tsx:121` 未註冊 agent 清單 `<span>` | `formatCurrency(a.spend)`，位於 `<ul>/<li>` 列（非 `<table>`、非卡片） | OTHER（逐列金額清單） | `formatTableCurrency`；`<span>` 已有 `text-right`，加 `tabular-nums`（見決策 4） |
| 15 | `components/cost-overview/period-comparison-section.tsx:65` 本期 `<td>` | `formatSignedCurrency(current_cost).replace(/^[+-]/, "")` | TABLE | `formatTableCurrency(agent.current_cost)`（拿掉 `.replace`）；`<td>` 已有 `text-right`，加 `tabular-nums` |
| 16 | `period-comparison-section.tsx:68` 上期 `<td>` | 同 15（`previous_cost`） | TABLE | 同 15 |
| 17 | `period-comparison-section.tsx:75` 漲幅 `<td>` | `formatSignedCurrency(agent.delta)` | TABLE（帶號金額） | **新函式 `formatSignedTableCurrency`**；`<td>` 加 `tabular-nums` |

  統計：共 17 處呼叫；轉換 14 處（TABLE 10：#1、2、5、6、7、15、16、17 加手機 `<dd>` #3、4；SUMMARY CARD 3：#11–13；OTHER 1：#14）；維持舊函式 3 處（#8–10，圖表 SVG 文字）。trace／span 相關元件經全 `frontend/` Grep 確認**不使用**這兩個函式，無需處理。
- **`<th>` 對齊**：`app/agents/page.tsx:96–97`（預算、本期花費 `<th>`，目前只有 `py-2 pr-3`）、`model-breakdown-table.tsx:21`（cost `<th>`）、`top-traces-table.tsx:93`（cost `<th>`）、`version-cost-chart.tsx:474`（日期欄 `<th data-date-col>`，第 470 行「版本」`<th>` 不動）皆需加 `text-right`；`period-comparison-section.tsx:40–52` 的金額 `<th>` 已是 `text-right`。這些表的 `<tr>` 帶 `text-left`，`<th>` 自己的 `text-right` 會覆蓋。
- **需更新的既有測試字面值**（Grep `US\$` 於 `frontend/` 的 `*.ts`/`*.tsx`/`e2e/*.ts`，逐項核對）：

  | 檔案:行 | 舊值 | 新值 | 原因 |
  |---------|------|------|------|
  | `components/cost-overview/period-comparison-section.test.tsx:56` | `+US$ 250（50.0%）` | `+US$ 250.00（50.0%）` | 漲幅 `formatSignedTableCurrency` |
  | `…period-comparison-section.test.tsx:67` | `+US$ 638` | `+US$ 638.00` | 同上 |
  | `…period-comparison-section.test.tsx:77` | `+US$ 120` | `+US$ 120.00` | 同上 |
  | `components/agent-detail/version-cost-chart.test.tsx:900` | `US$ 100` | `US$ 100.00` | a11y 表格 `<td>` |
  | `…version-cost-chart.test.tsx:904` | `US$ 123` | `US$ 123.00` | 同上 |
  | `…version-cost-chart.test.tsx:1161` | `US$ 100` | `US$ 100.00` | 同上 |
  | `e2e/period-comparison.spec.ts:49` | `+US$ 250（50.0%）` | `+US$ 250.00（50.0%）` | 漲幅（`getByText` 預設為子字串比對，舊字串不再是新字串子字串，必然失敗） |
  | `e2e/period-comparison.spec.ts:77` | `+US$ 638` | `+US$ 638.00` | 同上（舊字串仍是新字串子字串，不更新也會假性通過，仍須更新） |
  | `e2e/period-comparison.spec.ts:106` | `+US$ 120` | `+US$ 120.00` | 同上 |

  共 **9 處字面值**（單元 6 + e2e 3）。測試標題內含舊字面值者（`period-comparison-section.test.tsx:50/61/71`、`e2e/period-comparison.spec.ts:25/53/82` 內的 `US$ 250`／`638`／`120`）建議同步改寫，但屬註解性質。
  **不需更新**（已逐項核對）：`period-comparison-section.test.tsx:87`、`e2e/period-comparison.spec.ts:135`（`+US$ 10.00（100.0%）`，新舊相同）；`version-cost-chart.test.tsx` 第 256–261、912、1149–1155 行（已是兩位小數）與所有 SVG 內文字斷言（第 44–51、75、373–374、569–570、624、698、736、856、970–1064、1370、1724–1725、1815 行及 `e2e/agent-detail.spec.ts:146–149、412–418、461–464、998、1114–1115`）因 Y 軸、終點標籤、tooltip 維持舊函式而不變；`lib/format.test.ts`、`lib/format.acceptance.test.ts` 測的是函式本身，舊函式不動故不變。`e2e/agents.spec.ts`、`e2e/cost-dashboard.spec.ts` 目前沒有任何金額字面值斷言。
- **受影響的 e2e spec**：`e2e/period-comparison.spec.ts`（3 處字面值）；`e2e/agents.spec.ts`（新增斷言，見測試策略）；`e2e/cost-dashboard.spec.ts`（新增卡片斷言）；`e2e/agent-detail.spec.ts`（無字面值變動，但 `tabular-nums` 會加寬 a11y 表格欄位，須實跑確認第 722–780、1158、1253–1289、1376–1427 行的「無水平溢出」類測試仍通過，以及圖表 X 座標對齊測試）。
- **跨元素 computed style 耦合檢查**：Grep `getComputedStyle`／`toEqual(reference…)`／「一致」於 `e2e/`：僅 `e2e/trace-detail.spec.ts:94–97`（父子列 `paddingLeft` 比較，與金額欄無關）與 `e2e/agent-detail.spec.ts:1339、1421`（`pointerEvents`，SVG 面積）。**沒有**任何斷言比較兩個元素 computed style 相等且涉及本票變更的 `<th>`／`<td>`／卡片選擇器，故無 style 耦合斷裂風險。唯一的版面耦合是 SDLCCT-88 的「資料點 X 對齊 `<th data-date-col>` 欄中心」，該機制以 `getBoundingClientRect` + `ResizeObserver` 量測真實欄位，欄寬因 `tabular-nums`／更長字串而變動時會自動重算，`text-align` 不改變 `<th>` 方塊中心，故不受影響。

## 介面/API 契約

無 bff 端點、request／response 異動。前端變更如下。

### 新增匯出（`frontend/lib/format.ts`，唯一的新函式）

```ts
/** 帶號表格金額：永遠兩位小數、千分位；正數 "+"、負數 "-"、四捨五入後為零不帶號。
 * 250 -> "+US$ 250.00"、-1234.5 -> "-US$ 1,234.50"、0 -> "US$ 0.00"。 */
export function formatSignedTableCurrency(value: number | null | undefined): string;
```

規格（與 SDLCCT-92 的 `formatMoney` 規則一致）：
- `null`／`undefined`／`NaN`／`±Infinity` -> `"—"`。
- 小數位固定 2；千分位、`en-US`（重用 `groupedAbs`）。
- 符號置於 `US$` 之前（與舊 `formatSignedCurrency` 的 `+US$ 0.02` 位置一致）；符號判斷在四捨五入**之後**（重用 `roundsToZero(value, 2)`）：進位後為零 -> 無符號（`0`、`-0`、`0.004`、`-0.004` 皆 -> `US$ 0.00`）。
- 建議實作：`if (invalid) return "—"; const sign = roundsToZero(value, 2) ? "" : value < 0 ? "-" : "+"; return `${sign}US$ ${groupedAbs(Math.abs(value), 2)}`;`

其餘 `lib/format.ts` 變更僅為註解：在 `formatSignedCurrency` 上加 `/** @deprecated Use formatSignedTableCurrency. */`。**舊函式輸出一字不改**（`version-cost-chart.tsx` 仍使用 `formatCurrency`；`formatSignedCurrency` 遷移後無呼叫者，但仍被 `lib/format.test.ts` 測試，去留不在本票範圍）。

### 元件變更（Tailwind class，見上表）

- 表格金額 `<td>`／`<th>`：`text-right`；`<td>` 另加 `tabular-nums`。
- 手機卡片 `<dd>`、未註冊清單 `<span>`：已有 `text-right`，只加 `tabular-nums`。
- 摘要卡片：只換函式，不加 class。
- 不得改動：`formatPercent` 呼叫（`agents/page.tsx:125,166`、`summary-section.tsx:81`、`period-comparison-section.tsx:81`；百分比與進度條屬範圍外）、日期函式、Sparkline、`app/agents/page.tsx` 的 `unknownBudget` 分支。

## 資料模型

無新增資料模型（無 table、欄位、索引、state、props）。

## 關鍵技術決策

1. **為漲幅金額新增 `formatSignedTableCurrency`，而非留在舊函式**：漲幅欄位是表格金額，規格情境 1 明確要求表格金額為兩位小數；若留舊函式，同一張表的本期／上期為 `US$ 750.00` 而漲幅為 `+US$ 250`，違反情境 1 與整欄一致性。SDLCCT-92 未提供帶號金額版本，故在本票補上最小函式（一個、純函式、重用既有 helper）。
2. **期間比較表本期／上期直接用 `formatTableCurrency`、移除 `.replace(/^[+-]/, "")`**：原做法是借用帶號函式再剝符號；成本值非負，直接用不帶號函式語意更清楚，且行為等價（非負值）。
3. **圖表內 SVG 文字（Y 軸標示、終點標籤、hover tooltip）維持舊 `formatCurrency`**：規格範圍明寫「不改圖表軸線」，且情境只涵蓋「表格」與「摘要卡片」；終點標籤與 tooltip 是圖表標註，既非表格也非卡片。保守解讀：只改 a11y 後備**表格**（#7）。代價是同一元件內表格為 `US$ 100.00`、tooltip 為 `US$ 100`，這是規格範圍的直接結果，不另行擴張；若產品希望 tooltip 一併統一，需另開票（見開放設計問題的註記）。
4. **未註冊 agent 清單（#14）轉為 `formatTableCurrency`**：該清單是逐列「名稱 — 金額」的欄式資料，視覺上是只有一欄的表格，金額 `<span>` 已 `text-right`，與卡片（單一彙總數字）不同；兩位小數 + `tabular-nums` 讓各列小數點對齊。
5. **手機版 agent 卡片（#3、#4）用 `formatTableCurrency`**：它是同一份 agent 資料表在窄螢幕的版面，同一 agent 在桌面表格與手機卡片應顯示同一字串；「摘要卡片」指 cost-overview 的彙總卡片（#11–13）。
6. **摘要卡片不加 `tabular-nums`／對齊**：規格情境 2 只要求整數格式；卡片是單一數字，無縱向對齊需求。
7. **`tabular-nums` 用 Tailwind utility（`font-variant-numeric`）**：專案已用 Tailwind，不新增 CSS 檔、不改 design-system token；系統字體堆疊（`docs/design-system.md` 第 2 節）的數字在 `tnum` 支援下等寬，不支援時退回比例數字但仍靠右，不影響正確性。
8. **a11y 表格 `<th>` 加 `text-right` 但不動 `data-date-col`／ref 結構**：避免干擾 SDLCCT-88 量測；`text-align` 不改變欄方塊位置。

## 測試策略

**更新既有測試**：依「現狀查核」表更新 9 處字面值（單元 6、e2e 3）。

**新增單元測試**
- `lib/format.test.ts` 新增 `describe("formatSignedTableCurrency")`：`250` -> `+US$ 250.00`；`-1234.5` -> `-US$ 1,234.50`；`0`、`-0`、`0.004`、`-0.004` -> `US$ 0.00`；`0.02` -> `+US$ 0.02`；`1234567.891` -> `+US$ 1,234,567.89`；`null`、`undefined`、`NaN`、`Infinity` -> `—`。
- 元件測試（vitest + testing-library；新檔或擴充既有）：
  - `summary-section`：mock `fetchCostOverviewSummary`，三張金額卡顯示 `US$ 1,746`（整數）而非兩位小數（情境 2）；未註冊清單金額為兩位小數且 class 含 `tabular-nums`。
  - `model-breakdown-table`、`top-traces-table`（需 mock `next/navigation`）：cost `<td>` 文字為 `US$ 1,234.56` 格式、class 含 `text-right` 與 `tabular-nums`，對應 `<th>` 含 `text-right`；`null` 仍為 `—`。
  - `period-comparison-section`：本期／上期為兩位小數（例如 `US$ 750.00`）且含 `tabular-nums`。
  - `version-cost-chart`：a11y 表格 `<td>` 含 `text-right tabular-nums`、`<th data-date-col>` 含 `text-right`；SVG tooltip／終點標籤／Y 軸文字**仍為舊格式**（鎖定範圍邊界）。
  - agents 頁（`app/agents/page.tsx` 目前無元件測試，如環境不易 mock，改以 e2e 覆蓋）。

**e2e**（一律 `cd frontend && CI=1 npx playwright test --workers=1`；project-profile `frontend_e2e` 為 `npm run test:e2e`）
- `e2e/agents.spec.ts`：既有 mock（budget 1000、spend 500，第 71–72、114–115 行）新增斷言：桌面表格顯示 `US$ 1,000.00`、`US$ 500.00`；金額 `<td>` 的 computed `text-align` 為 `right`、`font-variant-numeric` 含 `tabular-nums`；390px 手機卡片也顯示同字串。
- `e2e/cost-dashboard.spec.ts`：以 `page.route` mock summary，斷言卡片為整數格式。
- `e2e/period-comparison.spec.ts`：更新 3 處字面值；可加一條斷言本期／上期儲存格為兩位小數。
- `e2e/agent-detail.spec.ts`：無字面值變動；須全套實跑確認無水平溢出與 X 對齊測試通過。

**驗收**：`pytest -q`（若專案宣告）、`npm run test`（vitest 全套）、`npm run lint`／型別檢查、e2e 全套皆須實際執行並通過；不得以「只改前端」為由略過任一側。

## UI 原型

見 `docs/design/SDLCCT-94-prototype.html`（靜態、離線可開，使用專案真實 token：`--color-bg #ffffff`、`--color-text-primary #1f2937`、`--color-text-secondary #4b5563`、`--color-border #e5e7eb`、`--color-accent #2563eb`，與系統字體堆疊）。內容：(1) Agent 清單表格金額欄改前／改後（靠右、`tabular-nums`、`US$ 1,234.56`）；(2) 期間比較表含帶號漲幅 `+US$ 250.00（50.0%）`；(3) 摘要卡片 `US$ 1,746` 與小額卡片 `US$ 12.50` -> `US$ 13` 的改前／改後。

## 開放設計問題（定稿時必須為空）

（無）

註記（非阻擋，供 G1b 審閱者知悉）：圖表內 tooltip 與終點標籤（`version-cost-chart.tsx:224、446`）依規格範圍保留舊格式，與同元件表格的新格式並存；若產品希望統一，屬後續獨立需求，不在本票。
