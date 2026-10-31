# 設計文件 — SDLCCT-95 既有頁面日期、日期時間與每日欄標題套用統一格式

## 對應需求規格

對應 G1 已核准的需求規格，4 條情境（已定稿）：

1. 日期：任一既有頁面顯示日期 -> `2026/10/06` 格式。
2. 日期時間：顯示日期時間 -> `2026/10/06 17:18:13`（Asia/Taipei）。
3. 每日欄標題：具每日欄位的表格 -> 標題形如 `10/9 (五)`。
4. 既有測試：單元與 e2e 期望值已更新且全部通過。

**範圍外**：頂列「資料更新於」（SDLCCT-103，等待人類決策，本票不得動 `今天（台灣時間）` 與頂列日期文字）；圖表 SVG 軸線與 tooltip 文字。相依：SDLCCT-93（已在 main）`frontend/lib/format.ts` 提供 `formatSlashDate`（第 159 行）、`formatSlashDateTime`（第 166 行）、`formatDayColumnHeader`（第 188 行）；舊 `formatTaiwanDate`（第 95 行）、`formatTaiwanDateTime`（第 112 行）已標 `@deprecated`，`formatDateRange`（第 126 行）**沒有** `@deprecated`，三者輸出一字不改。

## 現狀查核（實作前已逐字讀取）

### 呼叫點逐一盤點

Grep `formatTaiwanDate|formatTaiwanDateTime|formatDateRange|toLocaleDateString|toLocaleString|Intl.DateTimeFormat|slice(5)|{date}` 於全 `frontend/`（排除 node_modules）。`Intl.DateTimeFormat` 僅出現在 `lib/format.ts`；`toLocaleDateString`、`slice(5)`、`{date}` 插值在非測試程式碼中**不存在**；`lib/i18n/messages.ts` 只有第 58–59 行 `currentPeriod/previousPeriod: (range) => ...（${range}）` 與第 111 行欄名「日期」、第 114 行「持續中」，皆不含日期格式字面值。`version-cost-chart.tsx:95–101` 的 `fixedSevenDates` 以 `toISOString().slice(0, 10)` 產生內部 key（`data-date-col` 與 `byDate` 對應），不是顯示文字，不動。

| # | 位置 | 現況（輸入型別） | 分類 | 決定 |
|---|------|------------------|------|------|
| 1 | `components/anomalies/anomaly-table.tsx:19`（`formatAnomalyDate`，桌面 `<td>` 第 42 行與手機 `<dd>` 第 66 行共用） | `formatTaiwanDate(date)` -> `2026年10月18日`（`YYYY-MM-DD`；`null` -> 「持續中」分支不動） | TABLE/LIST date | **`formatSlashDate`** -> `2026/10/18` |
| 2 | `components/agent-detail/version-cost-chart.tsx:475` a11y 表格 `<th data-date-col>` | `formatTaiwanDate(date)`（`fixedSevenDates` 產生的 `YYYY-MM-DD`） | DAILY COLUMN HEADER | **`formatDayColumnHeader`** -> `10/14 (三)` |
| 3 | `components/trace-detail/span-tree-row.tsx:46`（兩次呼叫：`start_time`、`end_time`） | `formatTaiwanDateTime(...)`–`formatTaiwanDateTime(...)`（bff 原樣轉送 Opik `raw["start_time"]`，`bff/api/trace_spans.py:39`；Opik／seed 為 `...Z` ISO，`seed/client.py:43`；可為 `null`） | DATETIME | **`formatSlashDateTime`**（兩處皆換）；`null` 仍為 `—` |
| 4 | `components/agent-detail/version-cost-chart.tsx:436` hover tooltip 第一行（SVG `<text>`） | `formatTaiwanDate(dates[hoveredIndex])` | CHART-SVG（範圍外） | **維持 `formatTaiwanDate`**（決策 3 範圍界定） |
| 5 | `app/cost-dashboard/page.tsx:21`（前綴 `costOverview.header.today` = `今天（台灣時間）：`） | `formatTaiwanDate(anchorDate)` | TOP-BAR/ANCHOR（範圍外） | **不動**（SDLCCT-103；決策 3 範圍界定） |
| 6 | `app/anomalies/page.tsx:27` 頂列 | `formatTaiwanDate(state.data.anchor_date)` | TOP-BAR/ANCHOR（範圍外） | 同 5 |
| 7 | `app/agents/page.tsx:188` 頂列 | `formatTaiwanDate(state.data.anchor_date)` | TOP-BAR/ANCHOR（範圍外） | 同 5 |
| 8 | `components/agent-detail/agent-detail-content.tsx:44` 頂列 | `formatTaiwanDate(state.data.anchor_date)` | TOP-BAR/ANCHOR（範圍外） | 同 5 |
| 9 | `components/cost-overview/period-comparison-section.tsx:42`（本期）、`:47`（前期） | `formatDateRange(start, end)` -> `10/1–10/28`，嵌入表頭 `本期花費（10/1–10/28）` | OTHER（期間區間，非單一日期、非每日欄） | **不動**（決策 3 範圍界定） |

統計：`formatTaiwanDate` 7 處（轉換 2、維持 5：頂列 4 + tooltip 1）；`formatTaiwanDateTime` 1 行 2 次呼叫（全轉換）；`formatDateRange` 2 處（全維持）。合計 11 次呼叫：轉換 4 次（#1、#2、#3 兩次）、維持 7 次。分類：TABLE/LIST 1、DAILY COLUMN HEADER 1、DATETIME 1（2 次呼叫）、CHART-SVG 1、TOP-BAR 4、OTHER 1（2 次呼叫）。

其他可能顯示日期的位置已逐項確認**無**日期文字：`app/agents/page.tsx` 的 `trend` 只供 Sparkline（第 20 行，無日期文字）、`top-traces-table.tsx`、`model-breakdown-table.tsx`、`trace-detail-content.tsx`、`app/settings/system/page.tsx` 均無日期／時間顯示。

### 輸入型別查核（SDLCCT-93 審查提醒）

- `formatSlashDate` 只接受**嚴格** `YYYY-MM-DD`（`parseCalendarDate` 正規式 `^(\d{4})-(\d{2})-(\d{2})$`），否則回 `—`。#1 的 `row.date` 與 #2 的 `fixedSevenDates` 輸出皆符合；bff 的 `anchor_date`／anomaly `date` 為 `YYYY-MM-DD`（e2e mock 一致，如 `anomalies.spec.ts:64`）。**不得**把含時間的字串傳進 `formatSlashDate`。
- `formatSlashDateTime` 的 #3 輸入為 Opik 真實 ISO（`2026-10-01T00:00:00.123Z`，毫秒、結尾 `Z`），符合「只傳結尾 Z 或帶 offset 的 ISO」。V8 會把「空白分隔、無 offset」字串當本地時間解析，但本專案資料路徑上沒有此型態（seed `iso()` 與 Opik 皆為 `Z`），故不需防禦性前處理；若日後出現，屬資料來源問題，不在本票。
- 行為差異（皆為改善，非回歸）：舊 `formatTaiwanDateTime` 用 `hour12:false` 的 zh-TW，午夜可能顯示 `24:00:00`；新函式用 `hourCycle: "h23"`。對一般時間輸出字面相同（`2026/10/01 08:00:00`），故 `span-tree-row` 的視覺結果幾乎不變，本項主要是統一來源。

### 需更新的既有測試字面值（逐項核對）

單元（vitest）：

| 檔案:行 | 舊值 | 新值 | 原因 |
|---------|------|------|------|
| `components/agent-detail/version-cost-chart.test.tsx:1417` | `expect(first?.textContent).toBe(secondDate)`（tooltip 第一行 == `th` 文字） | `toBe("2026年10月15日")`（tooltip 維持舊格式）；另加 `expect(secondDate).toBe("10/15 (四)")` | `th` 改為每日欄標題，兩者不再相等 |
| `…version-cost-chart.test.tsx:1543–1545` | `toBe(ths[1].textContent)` | `toBe("2026年10月14日")`；另加 `expect(ths[1].textContent).toBe("10/14 (三)")` | 同上 |
| `…version-cost-chart.test.tsx:1548–1550` | `toBe(ths[7].textContent)` | `toBe("2026年10月20日")`；另加 `expect(ths[7].textContent).toBe("10/20 (二)")` | 同上 |

e2e（Playwright）：

| 檔案:行 | 舊值 | 新值 |
|---------|------|------|
| `e2e/anomalies.spec.ts:102`（註解第 96 行同步改） | `getByText("2026年10月18日").first()` | `getByText("2026/10/18").first()` |
| `e2e/anomalies.spec.ts:264` | `cardList.getByText("2026年10月18日")` | `cardList.getByText("2026/10/18")` |
| `e2e/agent-detail.spec.ts:197–205`（註解第 195 行同步改） | 7 個 `"2026年10月14日"` … `"2026年10月20日"` | `"10/14 (三)"`, `"10/15 (四)"`, `"10/16 (五)"`, `"10/17 (六)"`, `"10/18 (日)"`, `"10/19 (一)"`, `"10/20 (二)"` |
| `e2e/agent-detail.spec.ts:984` | `page.getByText("2026年10月18日")`（hover 前只有 `th` 含此字） | `versionSection.locator('thead th[data-date-col="2026-10-18"]')` `toHaveText("10/18 (日)")`（避免 getByText 子字串歧義） |

合計：**7 個斷言點**（單元 3 + e2e 4），涉及字面值：單元 3 處改寫（各加 1 條新格式斷言）、e2e 共 10 個字面值（2 + 7 + 1）。

**不需更新**（逐項核對）：`e2e/agent-detail.spec.ts:997`（tooltip `2026年10月18日`，tooltip 維持舊格式，仍成立）；`:1060`（`/\d{4}年\d{1,2}月\d{1,2}日/` 對 SVG 文字的負向斷言，hover 前 SVG 無日期，仍成立）；`version-cost-chart.test.tsx:855`（`texts[0]` 含 `2026`，tooltip 不變；僅註解「formatTaiwanDate」仍正確）、`:124`、`:338`、`:1412`（`svgTexts` 不含 `th` 文字，新格式更不可能相等，仍成立）；`lib/format.test.ts`、`lib/format.dates.acceptance.test.ts`（測函式本身，舊函式不動）。`e2e/agents.spec.ts`、`cost-dashboard.spec.ts`、`period-comparison.spec.ts`、`currency-rollout.acceptance.spec.ts`、`trace-detail.spec.ts` 經 Grep（`年`、`/`、`–`、`00:00`）**沒有**任何頂列日期、期間區間或 span 時間的字面值斷言，頂列與 `formatDateRange` 維持原樣因此亦無測試變動。

### 跨元素 computed style／文字耦合檢查

Grep `getComputedStyle`／`toEqual(reference…)`／「一致」於 `e2e/`：僅 `trace-detail.spec.ts:94–97`（父子列 `paddingLeft`）與 `agent-detail.spec.ts` 的 `pointerEvents`，與本票選擇器無關。但發現兩組**文字相等耦合**，已列入上表：(a) 單元測試 `version-cost-chart.test.tsx:1417、1543、1548` 斷言「tooltip 第一行 == 對應 `th` 文字」；(b) e2e `agent-detail.spec.ts:984` 與 `:997` 以同一字面值分別在 `th` 與 tooltip 上斷言。因 tooltip 屬範圍外必須維持舊格式、`th` 必須改新格式，這兩組耦合**必然**被打斷，處理方式如上（拆開、各自斷言字面值）；tooltip 不一併統一，見決策 3 範圍界定。反向斷言（`svgTexts` 不含 `th` 文字：`test.tsx:338、1412`）仍成立。另外 SDLCCT-88「資料點 X 對齊 `th` 欄中心」以 `getBoundingClientRect` + `ResizeObserver` 量測真實欄位，欄寬變動會自動重算，不受影響。

## 介面/API 契約

無 bff 端點、request／response 異動，無新函式（`lib/format.ts` 不改）。前端變更僅限呼叫點替換：

```ts
// components/anomalies/anomaly-table.tsx (import 與第 19 行)
import { formatSlashDate } from "@/lib/format";
return date === null ? t("anomalies.table.ongoing") : formatSlashDate(date);

// components/agent-detail/version-cost-chart.tsx (第 6 行 import 與第 475 行)
import { formatCurrency, formatDayColumnHeader, formatTableCurrency, formatTaiwanDate } from "@/lib/format";
<th key={date} data-date-col={date} className="py-2 pr-1 sm:pr-3 text-right">
  {formatDayColumnHeader(date)}
</th>
// 第 436 行 tooltip 仍用 formatTaiwanDate（範圍外），故 import 保留

// components/trace-detail/span-tree-row.tsx (第 6 行 import 與第 46 行)
import { formatSlashDateTime } from "@/lib/format";
{formatSlashDateTime(node.start_time)}–{formatSlashDateTime(node.end_time)}
```

`formatAnomalyDate` 維持匯出（簽名 `(date: string | null) => string` 不變）。不得改動：頂列四處、`period-comparison-section.tsx` 的 `formatDateRange`、tooltip、`lib/format.ts` 內任何函式（含 `@deprecated` 註解；`formatDateRange` 是否加註不在本票）。

## 資料模型

無新增資料模型（無 table、欄位、索引、state、props）。

## 關鍵技術決策

1. **日期 -> `formatSlashDate`、日期時間 -> `formatSlashDateTime`、每日欄 -> `formatDayColumnHeader`，一對一替換**：SDLCCT-93 已提供並驗證這三個函式，本票不新增函式、不改 `format.ts`。
2. **每日欄標題 `th` 不加 `whitespace-nowrap`，並明確允許在日期與星期之間換行**：見下方「390px 溢位風險預測」；`10/14 (三)` 中的空白是唯一換行點，窄螢幕換成兩行（`10/14` / `(三)`）可讓欄最小寬度由「整串」降為「`10/14`」，避免加寬欄位。
3. **範圍界定（依規格範圍外條款）**：下列三項屬「是否擴大範圍」，規格範圍外條款已保守回答，裁定為範圍決策（非產品決策），一律維持現狀：
   - **頂列四處日期維持不動**（`cost-dashboard/page.tsx:21`、`anomalies/page.tsx:27`、`agents/page.tsx:188`、`agent-detail-content.tsx:44`）：規格範圍外明列不處理頂列「資料更新於」（S10），SDLCCT-103 將整行取代，現在轉換只會被丟棄。
   - **版本成本圖 tooltip 第一行維持 `formatTaiwanDate`**（`version-cost-chart.tsx:436`）：圖表 SVG／tooltip 文字不在範圍，與 SDLCCT-94 把圖表文字留在舊格式器的界線一致；代價是 tooltip（`2026年10月18日`）與同欄 `th`（`10/18 (日)`）並存，原「tooltip == th 文字」的 3 條單元斷言改為各自字面值。
   - **`formatDateRange` 期間表頭維持不動**（`本期花費（10/1–10/28）`，`period-comparison-section.tsx:42、47`）：沒有任何驗收情境涵蓋。
   - **給 PO 的後續建議（非阻擋）**：SDLCCT-103 完成頂列後，頂列、tooltip 與期間表頭仍會是舊的中文日期風格，而表格為斜線格式；若 PO 希望全站單一風格，請另開後續票，本票不處理。
4. **span 時間改用 `formatSlashDateTime` 而非留舊函式**：規格情境 2 明確要求日期時間統一；輸出字面幾乎相同但修正午夜 `24:00:00` 邊角，並讓兩個 `@deprecated` 函式逐步無呼叫者。
5. **不為 `formatSlashDateTime` 加輸入前處理**：資料路徑上輸入皆為 `Z` ISO，加防禦碼會偏離「只傳真實 ISO」的契約。

### 390px 溢位風險預測與緩解（SDLCCT-88 對齊與 no-overflow 測試）

- **現況量測推論**：a11y 表格為 `w-full` 自動版面，欄的最小內容寬度取該欄 `th`／`td` 的最大「不可斷行片段」。`td` 為 `text-sm`（14px）的 `US$ 100.00`，在空白處可斷行，最小片段約 `100.00`/`1,234.56`（約 47–55px）；舊 `th`（12px）`2026年10月14日` 無空白，但 CJK 字元間可斷行，最小片段約 `2026`（約 27px）。故目前欄寬由 `td` 數字決定，SDLCCT-94 為此把日期欄 padding 收成 `pr-1 sm:pr-3`（`version-cost-chart.tsx:474、487`；見 `SDLCCT-94.md`「實作期間決策」，曾溢位 15px）。
- **新標題**：`10/14 (三)` 12px 全長約 54px；若允許換行，最小片段為 `10/14`（約 30px）或 `(三)`（約 20px），**小於** `td` 最小片段，因此欄最小寬度仍由 `td` 決定，**不新增溢位風險**；若 `th` 被加上 `nowrap`，最小片段升為約 54px，略大於 `td` 的 47–55px，在 7 欄 × 390px 情境下可能再度逼近／超出 342px 可用寬度。這正是決策 2 禁用 `nowrap` 的原因。
- **預測**：390px 下 `scrollWidth <= clientWidth` 的既有測試（`agent-detail.spec.ts:722–780`、`:1195–1200`、`:1286–1290`、`:1422–1427`）應維持通過；寬螢幕（>= 640px）空間足夠，標題自然單行。表頭在 390px 可能換成兩行，增加表頭列高度，但 SDLCCT-88 只量測欄的水平中心，不受高度影響。
- **緩解層級（依序，僅在實跑 e2e 出現失敗時才啟用，且不得放寬測試）**：(1) 維持 `th` 預設可換行（本設計預設，無額外 class）；(2) 窄螢幕縮小標題字級：`th` 加 `text-[11px] sm:text-xs`；(3) 窄螢幕進一步收 padding（`pr-0.5 sm:pr-3`）。**不採用** `overflow-x-auto` 外包容器與放寬 no-overflow 測試（SDLCCT-94 已否決，理由相同）。
- 其他頁面：`anomaly-table` 的日期由 `2026年10月18日`（10 字元）縮為 `2026/10/18`（10 字元，且為半形），手機卡片 `<dd>` 不會變寬，無新增溢位風險。

## 測試策略

**更新既有測試**：依「需更新的既有測試字面值」更新 7 個斷言點。

**新增單元測試**
- `version-cost-chart.test.tsx`：第 124 行附近，`dateHeaderTexts` 於 `anchorDate="2026-10-20"` 時 `toEqual(["10/14 (三)", "10/15 (四)", "10/16 (五)", "10/17 (六)", "10/18 (日)", "10/19 (一)", "10/20 (二)"])`；`th` 不含「年」字。
- 新檔 `components/anomalies/anomaly-table.test.tsx`（或擴充既有）：`formatAnomalyDate("2026-10-18")` -> `2026/10/18`；`null` -> 「持續中」；表格列與手機卡片皆顯示 `2026/10/18`。
- 新檔 `components/trace-detail/span-tree-row.test.tsx`：span `start_time: "2026-10-01T00:00:00Z"`、`end_time: "2026-10-01T00:00:05Z"` -> 文字含 `2026/10/01 08:00:00–2026/10/01 08:00:05`；任一為 `null` -> 該側 `—`。
- 鎖定範圍邊界：頂列四處與 `formatDateRange` 輸出維持舊格式（可用 `period-comparison-section.test.tsx` 斷言表頭含 `本期花費（10/1–10/28）`，若該檔尚無此斷言則新增）。

**e2e**（一律 `cd frontend && NEXT_PUBLIC_BFF_URL=http://localhost:8000 CI=1 npx playwright test --workers=1`）
- 依上表更新 `anomalies.spec.ts`、`agent-detail.spec.ts`。
- `trace-detail.spec.ts`：現有 mock（`start_time: "2026-10-01T00:00:00Z"`）新增斷言可見 `2026/10/01 08:00:00`。
- `agent-detail.spec.ts` 全套實跑，特別確認 `:722–780`、`:1006–1200`（X 對齊 1280／768／390px、5 序列 legend 模式）與 `:1253–1289`、`:1376–1430`（390px 無水平溢位）仍通過；若失敗依「緩解層級」處理並記錄於「實作期間決策」。
- e2e 一次只跑一份，不得與其他 worktree 的 Playwright 並行。

**驗收**：`pytest -q`、`npm run test`（vitest 全套）、`npm run lint`／型別檢查、e2e 全套皆須實際執行並通過；不得以「只改前端」為由略過任一側。

## UI 原型

見 `docs/design/SDLCCT-95-prototype.html`（靜態、離線可開，使用專案真實 token：`--color-bg #ffffff`、`--color-text-primary #1f2937`、`--color-text-secondary #4b5563`、`--color-border #e5e7eb`、`--color-accent #2563eb`，與系統字體堆疊，沿用 `SDLCCT-94-prototype.html`）。內容：(1) 版本成本 a11y 表格每日欄標題改前（`2026年10月14日`）／改後（`10/14 (三)`），含桌面寬度與 390px 手機寬度（真實 `text-xs` 標題 + `text-sm` 數字 + `pr-1` padding，標題可換行）；(2) 異常清單日期儲存格 `2026年10月18日` -> `2026/10/18`；(3) span 日期時間儲存格 `2026/10/01 08:00:00`（含 `null` -> `—`）；(4) 範圍外項目（頂列、tooltip、期間表頭）維持原樣的標示。

## 開放設計問題（定稿時必須為空）

（無）