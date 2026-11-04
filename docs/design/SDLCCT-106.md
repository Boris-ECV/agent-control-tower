# 設計文件 — SDLCCT-106 Sparkline 旁顯示近 7 天花費合計

## 對應需求規格
SDLCCT-106（G1 通過版本，拆分自 SDLCCT-85 原始範圍第 2 條）。範圍：在
`AgentTable`／`AgentCardList`（`frontend/app/agents/page.tsx`）的 `<Sparkline>`
旁加上該 Agent trend 陣列（近 7 天，`agent.trend: AgentTrendPoint[]`）中
非 null 數值的合計金額文字；trend 全為 null 時合計顯示「—」。

## 介面/API 契約
無。不新增、不修改任何 API 端點或 request/response 格式。`AgentTrendPoint`
型別（`frontend/lib/agents-api.ts`，由 OpenAPI schema 生成）不變。

## 資料模型
無新增資料模型。純前端衍生值：合計金額由既有 `agent.trend` 陣列在渲染端即時
計算，不落地、不新增後端欄位。

## 關鍵技術決策

1. **合計函式 `sumTrend` 與 `Sparkline` 同檔共置** —
   `sumTrend(trend: AgentTrendPoint[]): number | null`，過濾
   `value !== null` 後 reduce 加總；若過濾後長度為 0 回傳 `null`。放在
   `page.tsx` 中 `Sparkline` 函式正上方/下方，因為兩者都要對同一份
   trend 陣列做「過濾 null」的操作，邏輯上是一對（sparkline 畫線用非 null
   點，合計也用非 null 點），方便未來一起維護、避免兩處各自寫一次過濾邏輯。

2. **直接餵 `null` 給 `formatTableCurrency`，不額外寫「全為 null 顯示 —」
   的分支** — `formatTableCurrency`（`frontend/lib/format.ts` →
   `formatMoney`）在值為 `null`/`undefined`/非 finite 時已回傳 `"—"`，
   這正是 AC2「trend 全為 null 時合計顯示『—』，不顯示『US$ 0.00』」要的
   行為。沿用既有 Budget 欄位（`agent.budget !== null ? formatTableCurrency(...) : ...`
   其實該欄位是另一種「null 用佔位文字」模式，但合計這裡沒有獨立的
   unknown 語意要表達，單純是「沒有花費資料」，故不仿造 Budget 欄另包一層
   placeholder span，直接讓 `formatTableCurrency(null)` 原生回傳的「—」
   顯示即可，省掉一個分支、也避免兩種「—」樣式不一致。

3. **版面：合計文字疊在 Sparkline 下方（flex-col），不是並排** —
   `SPARKLINE_WIDTH` 固定為 84px，表格欄寬已依這個寫死寬度排版；並排會讓
   Trend 欄寬度隨金額文字長度變動（例如 `US$ 1,234.56` vs `—`），改變既有
   欄寬與其他欄位的對齊。改為上下疊放（比照同一元件內 `BudgetConsumedPct`
   把數字疊在進度條上方的既有模式），欄寬不受影響，手機卡片版同理。

4. **合計文字樣式：`text-xs text-text-secondary tabular-nums`** —
   次要資訊、不與欄位主要數字（`current_period_spend` 等用
   `text-sm`/預設字級）搶視覺權重，比照頁首副標題／表格頁尾的次要文字樣式；
   `tabular-nums` 沿用 SDLCCT-94 對金額數字的既有慣例，雖然此處不要求嚴格
   對齊多列,但與同頁其他金額欄位保持一致字型特性。

## UI 原型
見 `docs/design/SDLCCT-106-prototype.html`（純靜態 HTML，可直接在瀏覽器開啟）。
呈現三種狀態：
- 一般 Agent（trend 有數值）：Sparkline 下方顯示例如「US$ 1,234.56」。
- trend 全為 null：Sparkline 顯示「—」，合計文字也顯示「—」（兩者視覺上都是
  淡色「—」，與 UI 原型中既有「未設定」淡色佔位文字做區分，合計的「—」沿用
  `formatTableCurrency` 預設灰階，不額外套用 `text-text-tertiary`）。
- 手機卡片版同一元件、同一邏輯，驗證欄位堆疊不破版。

## 開放設計問題(定稿時必須為空)
無。
