# 設計文件 — SDLCCT-67 成本/金額顯示單位應為 US$，目前顯示 NT$

## 對應需求規格
G1 通過版本（2026-10-28 finalize）。核心要求：`frontend/lib/format.ts` 的
`formatCurrency()` / `formatSignedCurrency()` 回傳字串中的 `"NT$"` 字面值全部
改為 `"US$"`；數字本身（四捨五入、千分位、兩位小數規則）完全不變；不做匯率換算。
範圍外：locale 千分位慣例、幣別切換功能、其他計算邏輯。

## 現狀調查（code grep 結果）
- repo 全文搜尋 `NT\$`（排除 node_modules）僅命中：
  - `frontend/lib/format.ts` — 4 處字面值（`formatCurrency` 2 處、
    `formatSignedCurrency` 2 處）
  - `frontend/lib/format.test.ts` — 10 個斷言依賴 `"NT$"` / `"+NT$"` / `"-NT$"`
  - `docs/PRD.md`、`metrics/session-report-2026-10-27.md`、
    `docs/design/SDLCCT-70.md` — 歷史文件引用，非本次修改範圍（不回溯改寫既往
    設計文件/報告）
- 其餘 6+ 個畫面元件（成本總覽、Agent 清單、Agent 詳情、執行詳情、異常與告警、
  預算模擬）全部透過 import `formatCurrency`/`formatSignedCurrency` 顯示金額，
  未在元件層直接寫 `"NT$"` 字面值 — 確認「改一處、全畫面生效」的 AC4 前提成立。
- **cross-element 樣式耦合測試檢查**（本職責步驟 4）：本次變更是純文字內容
  （字串常數）替換，不涉及任何 CSS/computed style 屬性或 DOM 結構變更。搜尋
  `toEqual`/「一致」等 computed-style 比對測試與本次改動的程式路徑無交集
  （`format.ts` 不輸出任何樣式，只輸出字串）。結論：不適用，無需列出。

## 介面/API 契約
無。本 Story 不涉及任何 API/BFF 端點變更，純前端展示層字串常數替換。

## 資料模型
無新增資料模型。不改動任何金額數字、計算邏輯或資料來源（符合 CONSTITUTION.md
「資料正確性」原則：本次變更不觸碰可追溯性鏈，只改單位符號顯示）。

## 關鍵技術決策
1. **只改字面值，不改 `toLocaleString` 的 locale 參數（`"zh-TW"`）**——
   locale 參數只影響千分位分隔符號/預設小數位規則，不影響幣別符號本身（符號
   是手寫字首 `` `NT$ ${...}` ``，不是用 `Intl.NumberFormat` 的
   `currency: "TWD"` 自動產生）。範圍外明確排除「不同 locale 下千分位/小數
   顯示慣例差異」，維持 `"zh-TW"` 是遵循「不做任何非 spec 要求改動」原則，也
   避免 `toLocaleString("en-US")` 之類替換間接改變千分位符號外觀的風險。
2. **四個字面值改法一致**：`NT$ ${...}` → `US$ ${...}`，`${sign}NT$ ${...}` →
   `${sign}US$ ${...}`。不抽出共用常數（如 `const CURRENCY_SYMBOL = "US$"`）
   ——依 CONSTITUTION.md「Prefer three similar lines over a premature
   abstraction」，4 處字面值屬小改動，不值得為此新增抽象層；維持現有程式碼
   結構對 reviewer 的 diff 最小、最容易驗證「數字沒變、只有符號變」。
3. **測試檔案同步更新**：`format.test.ts` 內所有 `"NT$"` / `"+NT$"` /
   `"-NT$"` 字面值斷言改為 `"US$"` / `"+US$"` / `"-US$"`，測試案例結構、涵蓋
   的數值情境（0.02、0、null、undefined、1234.4、0.6、0.49、負數）完全不變
   ——驗證的是「符號變了、數字邏輯沒變」，不是新增或移除測試案例。

## UI 原型
無，本 Story 不需新增原型檔案。理由：本次變更是既有版面中單一字首符號的
文字置換（`NT$` → `US$`），不新增/調整元件、不改變版面配置、不改變樣式
（class、間距、對齊、字體皆不動）。現有畫面的 `$-prefix + 數字` 顯示模式
（docs/design-system.md 既定樣式）不受影響，渲染後唯一肉眼可見差異是文字
內容本身，一份靜態原型無法比文字 diff 本身提供更多資訊。developer 可直接
對照 Gherkin AC（期望輸出字串）與現有畫面截圖（渲染前後比對符號）驗證，不
需要額外原型檔案。

## 開放設計問題(定稿時必須為空)
無。
