# 設計文件 — SDLCCT-92 共用格式函式：金額（兩位小數）、摘要卡片金額（整數）、百分比（千分位與正負號）

## 對應需求規格

對應 G1 已核准的需求規格，6 條 Gherkin 情境（已定稿）：

1. 表格金額：`1234.5` -> `US$ 1,234.50`
2. 小額與零：`0` -> `US$ 0.00`；`0.02` -> `US$ 0.02`
3. 卡片金額：`1746.4` -> `US$ 1,746`
4. 百分比：`1893.8`（需要正負號時）-> `+1,893.8%`
5. 缺值：`null`／`undefined` -> `—`，三個函式皆然
6. 單元測試：`lib/format.test.ts` 更新並全數通過

**範圍外**：不修改任何頁面／元件呼叫點（屬 SDLCCT-94）；不含日期函式（SDLCCT-93）；不含圖表軸標示；無前端 UI 變更。規格的開放問題：無。

## 現狀查核（實作前已逐字讀取）

- `frontend/lib/format.ts`
  - 第 5–14 行 `formatCurrency(value)`：null/undefined -> `—`；`Math.abs(value) < 100 && value !== 0` 時 `zh-TW` 兩位小數，否則 `Math.round(value).toLocaleString("zh-TW")`。故 `0` -> `US$ 0`、`1234.4` -> `US$ 1,234`（與新規格情境 2 的 `US$ 0.00`、情境 1 的兩位小數**不相容**）。
  - 第 16–19 行 `formatPercent(value, digits = 1)`：`${value.toFixed(digits)}%`，無千分位、無正負號（與情境 4 不相容）。
  - 第 21–32 行 `formatSignedCurrency`：同 `formatCurrency` 的雙模式，正負號置於 `US$` 之前（`+US$ 0.02`、`-US$ 1,234`）。規格未提及，不變動。
  - 第 34–75 行日期函式：與本票無關，不動。
- `frontend/lib/format.test.ts`（91 行）只 import `formatCurrency`、`formatSignedCurrency`（第 3 行）；第 5–49 行斷言 `formatCurrency(0)` = `US$ 0`、`1234.4` = `US$ 1,234`、`100.4` = `US$ 100` 等舊輸出；第 51–91 行斷言 `formatSignedCurrency` 舊輸出。**目前沒有 `formatPercent` 的單元測試。**
- 全 `frontend/`（排除 node_modules）對三個函式的呼叫點（Grep 全數列出）：
  - `components/cost-overview/summary-section.tsx`：第 71、76、91、121 行 `formatCurrency`；第 81 行 `formatPercent`。
  - `components/cost-overview/period-comparison-section.tsx`：第 65、68、75 行 `formatSignedCurrency`（65、68 行並 `.replace(/^[+-]/, "")`，依賴正負號在最前面）；第 81 行 `formatPercent`。
  - `components/agent-detail/version-cost-chart.tsx`：第 224、360、446、488 行 `formatCurrency`（第 417 行為註解）。
  - `components/agent-detail/top-traces-table.tsx:115`、`model-breakdown-table.tsx:30`：`formatCurrency`。
  - `app/agents/page.tsx`：第 122、124、158、162 行 `formatCurrency`；第 125、166 行 `formatPercent`。
  - 測試／e2e 中僅有註解提及：`e2e/agent-detail.spec.ts:414`、`components/agent-detail/version-cost-chart.test.tsx:45`（兩者皆斷言 SDLCCT-71 的舊輸出，例如 `US$ 50.00`；字面值斷言散見於各元件測試與 e2e，皆以顯示字串為準）。
- **跨元素 computed style 耦合檢查**：本票只改純字串函式、不改任何元素 computed style，**不適用**。

**結論**：既有三個函式被 6 個檔案、約 20 處呼叫，並被既有單元／元件／e2e 測試以字面值斷言；規格情境 1、2 與現行 `formatCurrency` 的輸出直接衝突（`0` -> `US$ 0` vs `US$ 0.00`）。在「不得修改呼叫點」的約束下，**直接改寫既有函式不可行**（會讓所有頁面與既有測試立即改變）。因此採「新增函式、既有函式輸出逐字不變」。此為可行，無需列為開放問題。

## 介面/API 契約

無 bff 端點、無 request／response 異動。僅 `frontend/lib/format.ts` 新增三個具名匯出（皆為純函式，不使用 React、不讀環境）。

```ts
/** 表格金額：永遠兩位小數、千分位。1234.5 -> "US$ 1,234.50"、0 -> "US$ 0.00"。 */
export function formatTableCurrency(value: number | null | undefined): string;

/** 摘要卡片金額：四捨五入到整數、千分位。1746.4 -> "US$ 1,746"。 */
export function formatCardCurrency(value: number | null | undefined): string;

/** 百分比：千分位；signed 為 true 時加正負號。1893.8 + signed -> "+1,893.8%"。 */
export function formatPercentGrouped(
  value: number | null | undefined,
  options?: { digits?: number; signed?: boolean },
): string;
```

- `options.digits` 預設 `1`（與現行 `formatPercent` 預設一致）；`options.signed` 預設 `false`。
- 既有 `formatCurrency`、`formatPercent`、`formatSignedCurrency` **一字不改**（輸出逐字不變）。可在每個舊函式上加 `@deprecated` JSDoc 指向新函式（僅註解，不改行為）；SDLCCT-94 遷移呼叫點後再處理舊函式的去留。

### 共通規則（三個函式一致）

1. **缺值**：`null`、`undefined` -> `"—"`（U+2014，與既有函式相同字元）。
2. **非有限數**：`NaN`、`±Infinity` -> `"—"`（`!Number.isFinite(value)`）。理由：不得顯示 `US$ NaN`；與「缺值一律 em dash，不顯示 0 或空白」既有慣例一致。
3. **Locale**：固定 `"en-US"`（非 `zh-TW`、非預設 locale），用 `Number.prototype.toLocaleString("en-US", …)`。`en-US` 在 Node 的 small-icu 與 full-icu 皆內建，千分位固定為 `,`、小數點固定為 `.`，與 Node／瀏覽器的預設 locale 無關（確定性）。
4. **千分位**：`useGrouping` 預設（`true`），四位數即分組（`1,234`）。
5. **負數（金額）**：負號置於 `US$` 之前，格式 `-US$ 1,234.50`，與既有 `formatSignedCurrency` 的 `-US$ …` 位置一致。實作以絕對值格式化後前綴 `-`。
6. **進位後為零不帶負號**：先依該函式的小數位數把值四捨五入，若結果為 0（含 `-0`、`-0.004`），一律視為 0，輸出無負號（`US$ 0.00`、`US$ 0`）。理由：避免 `-US$ 0.00` 這種視覺雜訊。
7. **四捨五入**：沿用 `toLocaleString`／`Intl.NumberFormat` 的 round-half-expand（遠離零）；不另行實作。

### 各函式細則

- `formatTableCurrency`：`{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`；格式 `US$ ${abs.toLocaleString("en-US", …)}`，負數前綴 `-`（規則 5）。
- `formatCardCurrency`：`{ minimumFractionDigits: 0, maximumFractionDigits: 0 }`（等同整數四捨五入）；格式 `US$ ${…}`，負數前綴 `-`。`0` -> `US$ 0`。
- `formatPercentGrouped`：以 `{ minimumFractionDigits: digits, maximumFractionDigits: digits }` 對絕對值格式化，後綴 `%`。`signed: true` 時正號 `+`（進位後 > 0）、負號 `-`（進位後 < 0）、進位後為 0 不帶號；`signed: false`（預設）時負數仍保留 `-`（負百分比不可丟失符號），正數與 0 不帶號。`digits` 非整數或為負數屬呼叫端誤用，不做額外防護（沿用 `toLocaleString` 對範圍錯誤丟 `RangeError` 的行為；合法範圍 0–100）。

## 資料模型

無新增資料模型（無 table、欄位、索引、state、props）。

## 關鍵技術決策

1. **新增函式、保留舊函式輸出逐字不變**：呼叫點不得在本票修改，而規格輸出與舊函式衝突（`0` -> `US$ 0.00`），改寫舊函式會同時改變 6 個檔案約 20 處顯示並打破既有字面值斷言；故新增三個函式，由 SDLCCT-94 遷移呼叫點。代價是暫時並存兩套函式，已用 `@deprecated` 註解標示。
2. **函式命名依用途而非行為**（`Table` / `Card` / `Grouped`）：讓 SDLCCT-94 遷移時能直接按位置選擇（表格 vs 摘要卡片），不必記得「兩位小數 vs 整數」的細節。
3. **金額函式不收 options、百分比函式收 options**：金額兩種版面各一函式（規格明確區分表格／卡片），百分比只有「是否帶號」與位數兩個旋鈕；情境 4 以「需要正負號時」描述，故以 `signed` 旗標表達，不再另開 `formatSignedPercent`。
4. **固定 `en-US`**：確保千分位在任何 Node ICU 與瀏覽器 locale 下都是 `,`（舊函式用 `zh-TW`，同樣是 `,`，但依賴 locale 資料；`en-US` 是最保守選擇）。
5. **非有限數 -> `—`**：規格只定義 null/undefined；對 NaN／Infinity 的處理是實作層的防禦性決定（不引入新產品行為，僅避免顯示 `NaN`），與缺值慣例一致，故不列為開放問題。
6. **負號置於 `US$` 之前**：沿用 `formatSignedCurrency` 既有慣例；規格未涵蓋負金額，此為既有樣式的延伸，不是新產品需求。
7. **四捨五入後再判斷符號**：避免 `-0.00`／`-US$ 0.00`／`+0.0%` 這類語意矛盾的輸出。

## 測試策略（`frontend/lib/format.test.ts`）

**既有測試：不更新**（`formatCurrency`、`formatSignedCurrency` 輸出不變，其 `describe` 區塊原封保留）。同檔新增 import 與下列 `describe`（`formatPercent` 舊函式原本無測試，另加 2 個回歸測試鎖定「輸出不變」）。

`describe("formatTableCurrency")`
1. `1234.5` -> `US$ 1,234.50`（情境 1）
2. `0` -> `US$ 0.00`（情境 2）
3. `0.02` -> `US$ 0.02`（情境 2）
4. `99.999` -> `US$ 100.00`（進位到下一位仍兩位小數）
5. `1234567.891` -> `US$ 1,234,567.89`（多組千分位）
6. `-1234.5` -> `-US$ 1,234.50`
7. `-0.004` -> `US$ 0.00`；`-0` -> `US$ 0.00`（進位後為零無負號）
8. `null`、`undefined` -> `—`（情境 5）
9. `NaN`、`Infinity`、`-Infinity` -> `—`

`describe("formatCardCurrency")`
1. `1746.4` -> `US$ 1,746`（情境 3）
2. `1746.5` -> `US$ 1,747`（half 進位）
3. `0` -> `US$ 0`；`0.4` -> `US$ 0`
4. `1234567.8` -> `US$ 1,234,568`
5. `-1746.4` -> `-US$ 1,746`；`-0.4` -> `US$ 0`
6. `null`、`undefined` -> `—`（情境 5）
7. `NaN`、`Infinity` -> `—`

`describe("formatPercentGrouped")`
1. `1893.8`、`{ signed: true }` -> `+1,893.8%`（情境 4）
2. `1893.8`（無 options）-> `1,893.8%`
3. `-12.34`、`{ signed: true }` -> `-12.3%`；`-12.34`（無 options）-> `-12.3%`
4. `0`、`{ signed: true }` -> `0.0%`（零無號）；`0.04`、`{ signed: true }` -> `0.0%`（進位後為零無號）
5. `12.345`、`{ digits: 2, signed: true }` -> `+12.35%` 或 `+12.34%`：浮點二進位表示會影響結果，**測試改用 `12.5`、`{ digits: 0, signed: true }` -> `+13%`**（遠離零進位，無浮點歧義）
6. `1234567.8`、`{ digits: 1 }` -> `1,234,567.8%`
7. `null`、`undefined`（含 `signed: true`）-> `—`（情境 5）
8. `NaN`、`Infinity` -> `—`

`describe("legacy outputs unchanged")`
1. `formatPercent(12.34)` -> `12.3%`；`formatPercent(1893.8)` -> `1893.8%`（確認舊函式無千分位無號，保證本票未動舊行為）
2. `formatCurrency(0)` -> `US$ 0`（已存在於既有測試，不重複新增）

**驗收**：`npm run test`（vitest 全套）與 `npm run lint`／型別檢查通過；e2e 與元件測試不應有任何變動（因為呼叫點未動）。developer 仍須依 CLAUDE.md 規則實跑全套，不得以「只改 lib」為由略過。

## UI 原型

無。本票僅新增純格式化函式，不改變任何畫面（呼叫點由 SDLCCT-94 遷移），故無 UI 原型。

## 開放設計問題（定稿時必須為空）

（無）
