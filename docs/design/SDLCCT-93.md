# 設計文件 — SDLCCT-93 共用格式函式：日期 2026/10/06、日期時間（台灣時間）、每日欄標題 10/9 (五)

## 對應需求規格

對應 G1 已核准的需求規格，5 條 Gherkin 情境（已定稿）：

1. 日期：`2026-10-06` -> `2026/10/06`
2. 日期時間：`2026-10-06T09:18:13Z` -> `2026/10/06 17:18:13`（Asia/Taipei）
3. 每日欄標題：`2026-10-09` -> `10/9 (五)`（月/日不補零；星期為單字 日一二三四五六，置於括號內，括號前有一個空格）
4. 缺值：`null` 或空字串 -> `—`（日期時間函式）
5. 單元測試：`lib/format.test.ts` 新增案例全數通過

**範圍外**：不修改任何頁面／元件呼叫點（屬 SDLCCT-95）；不處理「資料更新於」句子（SDLCCT-103）；無 UI 變更。規格的開放問題：無。

## 現狀查核（實作前已逐字讀取）

- `frontend/lib/format.ts`（本分支，含 SDLCCT-92 已合併的新函式 `formatTableCurrency`／`formatCardCurrency`／`formatPercentGrouped`，第 5–46 行；舊函式以 `@deprecated` JSDoc 標示，第 48、60 行）
  - 第 84–92 行 `formatTaiwanDate(isoDate: string)`：`new Date(\`${isoDate}T00:00:00Z\`)` 以 `zh-TW`、`Asia/Taipei`、`month: "long"` 格式化 -> `2026年10月6日`。
  - 第 100–112 行 `formatTaiwanDateTime(iso)`：`!iso` -> `—`；否則 `zh-TW`、`hour12: false`、2-digit 各欄；輸出依 ICU 而定（斜線分隔），且 `hour12: false` 在部分 ICU 會把午夜輸出為 `24`。
  - 第 114–120 行 `formatDateRange(startIso, endIso)`：以 `split("-")` 手動組成 `M/D–M/D`（不補零）；與本票無關，不動。
  - 全檔**無任何星期（weekday）邏輯**；無每日欄標題函式。
- `frontend/lib/format.test.ts`：只 import 金額函式（第 3 行起的具名 import），**目前沒有任何日期函式的單元測試**。
- 全 `frontend/`（排除 node_modules）對日期函式的呼叫點（Grep 全數列出）：
  - `formatTaiwanDate`：`components/anomalies/anomaly-table.tsx:19`、`components/agent-detail/agent-detail-content.tsx:44`、`app/anomalies/page.tsx:27`、`app/cost-dashboard/page.tsx:21`、`app/agents/page.tsx:188`、`components/agent-detail/version-cost-chart.tsx:436, 475`。
  - `formatTaiwanDateTime`：`components/trace-detail/span-tree-row.tsx:46`（start/end 兩處）。
  - `formatDateRange`：`components/cost-overview/period-comparison-section.tsx:42, 47`。
  - 字面值斷言：`e2e/anomalies.spec.ts:96`（`2026年10月18日`）、`e2e/agent-detail.spec.ts:195`（`2026年10月14日`；該檔共 10 處中文日期字面值）、`components/agent-detail/version-cost-chart.test.tsx:855`（`toContain("2026")`）。
  - 前端其他位置無 `getDay(`／`weekday` 用法。
- **跨元素 computed style 耦合檢查**：本票只新增純字串函式、不改任何元素 computed style，**不適用**。

**結論**：舊函式被 7 個檔案、約 10 處呼叫，並被 e2e 以字面值斷言（`2026年10月18日` 與新格式 `2026/10/18` 衝突）。在「不得修改呼叫點」的約束下，直接改寫舊函式不可行。沿用 SDLCCT-92 做法：**新增三個匯出，舊函式輸出逐字不變**（僅加 `@deprecated` JSDoc，不改行為）。可行，無需列為開放問題。

## 介面/API 契約

無 bff 端點、無 request／response 異動。僅 `frontend/lib/format.ts` 新增三個具名匯出（純函式，不使用 React、不讀環境、不讀系統時區）。

```ts
/** 純日期：YYYY-MM-DD -> "YYYY/MM/DD"。"2026-10-06" -> "2026/10/06"。 */
export function formatSlashDate(isoDate: string | null | undefined): string;

/** 日期時間（Asia/Taipei，24 小時制）："2026-10-06T09:18:13Z" -> "2026/10/06 17:18:13"。 */
export function formatSlashDateTime(iso: string | null | undefined): string;

/** 每日欄標題：YYYY-MM-DD -> "M/D (週)"。"2026-10-09" -> "10/9 (五)"。 */
export function formatDayColumnHeader(isoDate: string | null | undefined): string;
```

### 輸入語意

- **`formatSlashDate` / `formatDayColumnHeader`**：輸入為 bff 的純日期字串 `YYYY-MM-DD`（anchor 的 UTC 午夜慣例）。**以日曆日解讀，不經任何時區換算**：直接以正規表示式 `^(\d{4})-(\d{2})-(\d{2})$` 取出年月日。理由：與 `formatTaiwanDate` 的語意相同（UTC 午夜轉 UTC+8 仍是同一個日曆日，見第 79–83 行註解），而台北為 UTC+8、無日光節約，故兩種解讀結果一致；直接取字串欄位最簡單，且不可能因系統時區或 ICU 而位移日期。
- **`formatSlashDateTime`**：輸入為完整 ISO 8601 datetime（含 `Z` 或偏移，如 span 的 `2026-10-01T00:00:01Z`），以 `new Date(iso)` 取得時間點，再以 `Asia/Taipei` 呈現。不接受純日期（純日期交給 `formatSlashDate`）；若傳入純日期，`new Date("2026-10-06")` 為 UTC 午夜 -> 顯示 `2026/10/06 08:00:00`，屬呼叫端誤用，不特別防護。
- **星期**：由日曆日（y, m, d）計算：`new Date(Date.UTC(y, m - 1, d)).getUTCDay()`（使用 UTC getter，與系統時區無關），索引固定陣列 `["日","一","二","三","四","五","六"]`，**不使用 locale／`weekday` Intl 選項**。

### 輸出規則

1. **缺值**：`null`、`undefined`、空字串（`""`）-> `"—"`（U+2014，與既有函式相同字元）。三個函式一致（規格僅明列日期時間函式；其餘兩個比照以保持一致，見決策 5）。
2. **無效輸入**：格式不符、日期不存在（如 `2026-02-30`、`2026-13-01`）、`new Date(iso)` 為 `Invalid Date` -> `"—"`，絕不丟例外、不顯示 `NaN` 或 `Invalid Date`。日期驗證方式：以 `Date.UTC(y, m-1, d)` 建立後回讀年／月／日，三者須與輸入相同。
3. **`formatSlashDate`**：輸出 `${yyyy}/${mm}/${dd}`，沿用輸入的零補位（輸入已是兩位）。
4. **`formatDayColumnHeader`**：輸出 `${Number(mm)}/${Number(dd)} (${週})`；月日不補零；括號前一個半形空格；括號為半形 `(` `)`。
5. **`formatSlashDateTime`**：使用 `new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })` 的 **`formatToParts`**，依 `type` 取 `year`／`month`／`day`／`hour`／`minute`／`second` 後手動組成 `${year}/${month}/${day} ${hour}:${minute}:${second}`。**不使用 `.format()` 的整串輸出**，因分隔符與順序隨 locale／ICU 版本而異；只取各 part 的數值。
   - **`hourCycle: "h23"`（不用 `hour12: false`）**：保證午夜為 `00` 而非 `24`（`hour12: false` 在部分 ICU 實作會對應到 h24）。
   - 將各 part 的值再 `padStart(2, "0")` 作為保險（年不補）。
   - 台北無 DST，偏移固定 +8；`2026-10-06T16:30:00Z` 跨日 -> `2026/10/07 00:30:00`。

## 資料模型

無新增資料模型（無 table、欄位、索引、state、props）。

## 關鍵技術決策

1. **新增函式、舊函式輸出逐字不變**：呼叫點不得在本票修改，且 e2e 以字面值斷言 `2026年10月18日`；改寫舊函式會破壞既有測試與畫面。由 SDLCCT-95 遷移呼叫點；舊函式僅加 `@deprecated` JSDoc（指向新函式），行為不變。
2. **命名**：`formatSlashDate`／`formatSlashDateTime`／`formatDayColumnHeader`——以「輸出形態」命名而非沿用 `formatTaiwan*`，避免與舊函式混淆；`Slash` 系列表示 `YYYY/MM/DD`。每日欄標題依用途命名，方便 SDLCCT-95 按位置選用。
3. **純日期不經 Date／時區**：以正規表示式取欄位，天然不會位移（台北 UTC+8 無 DST，UTC 午夜與台北日曆日一致，故與 `formatTaiwanDate` 語意相同），也不受執行環境時區影響。
4. **日期時間用 `formatToParts` + `hourCycle: "h23"` + 固定 `en-US`**：輸出完全由我們組字串，ICU 版本、分隔符或預設 locale 差異無法改變結果；h23 避免午夜 `24`。
5. **缺值與無效輸入一律 `—`**：規格只定義日期時間函式的 null／空字串；其餘兩個函式與無效字串採相同處理屬實作層防禦（不引入新產品行為，僅避免顯示 `Invalid Date`／`NaN`），與既有「缺值一律 em dash」慣例一致，故不列為開放問題。
6. **星期用固定陣列**：不依賴 `Intl` weekday 的 locale 資料，保證單字 `日一二三四五六`（`zh-TW` 的 `short` 可能輸出「週五」）。
7. **簽名接受 `string | null | undefined`**：方便呼叫端直接傳可為空的 API 欄位（如 anomaly 的 `end_date`），與 `formatTaiwanDateTime` 現有簽名風格一致。

## 測試策略（`frontend/lib/format.test.ts`）

既有測試不動；同檔新增 import 與下列 `describe`（舊日期函式原無測試，**不為其補測試**，亦不改動）。

`describe("formatSlashDate")`
1. `"2026-10-06"` -> `2026/10/06`（情境 1）
2. `"2026-01-01"` -> `2026/01/01`；`"2026-12-31"` -> `2026/12/31`（年／月邊界、零補位）
3. `"2024-02-29"` -> `2024/02/29`（閏日）
4. `null`、`undefined`、`""` -> `—`
5. 無效：`"abc"`、`"2026-02-30"`、`"2026-13-01"`、`"2026-10-06T00:00:00Z"` -> `—`

`describe("formatSlashDateTime")`
1. `"2026-10-06T09:18:13Z"` -> `2026/10/06 17:18:13`（情境 2）
2. `"2026-10-06T16:30:00Z"` -> `2026/10/07 00:30:00`（跨日邊界；午夜為 `00` 非 `24`）
3. `"2026-10-06T16:00:00Z"` -> `2026/10/07 00:00:00`（恰好午夜，驗證 h23）
4. `"2026-12-31T16:00:01Z"` -> `2027/01/01 00:00:01`（跨年）
5. `"2026-10-06T15:59:59Z"` -> `2026/10/06 23:59:59`（日末）
6. 含偏移輸入：`"2026-10-06T17:18:13+08:00"` -> `2026/10/06 17:18:13`
7. `null`、`undefined`、`""` -> `—`（情境 4）
8. 無效：`"not-a-date"` -> `—`

`describe("formatDayColumnHeader")`
1. `"2026-10-09"` -> `10/9 (五)`（情境 3）
2. 一週七天各一案例：`2026-10-04` -> `10/4 (日)`、`10-05` -> `10/5 (一)`、`10-06` -> `10/6 (二)`、`10-07` -> `10/7 (三)`、`10-08` -> `10/8 (四)`、`10-09` -> `10/9 (五)`、`10-10` -> `10/10 (六)`（`it.each`）
3. 月日不補零與兩位數：`"2026-01-05"` -> `1/5 (一)`；`"2026-12-31"` -> `12/31 (四)`
4. 月／年邊界：`"2026-11-01"` -> `11/1 (日)`；`"2027-01-01"` -> `1/1 (五)`
5. `null`、`undefined`、`""` -> `—`
6. 無效：`"2026-02-30"`、`"abc"` -> `—`

（所有星期預期值已以 2026-10-09 為週五推算：10/4 週日 ... 10/10 週六；2026-11-01 為週日；2027-01-01 為週五；2026-12-31 為週四；2026-01-05 為週一。developer 於實作時以 `new Date(Date.UTC(...)).getUTCDay()` 獨立驗算一次。）

**驗收**：`npm run test`（vitest 全套）、`npm run lint`／型別檢查通過；e2e 與元件測試不應有任何變動（呼叫點未動）。developer 仍須實跑全套，不得以「只改 lib」為由略過。

## UI 原型

無。本票僅新增純格式化函式，不改變任何畫面（呼叫點由 SDLCCT-95 遷移），故無 UI 原型。

## 開放設計問題（定稿時必須為空）

（無）
