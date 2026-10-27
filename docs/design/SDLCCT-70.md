# 設計文件 — SDLCCT-70 非零小額成本被 formatCurrency() 捨入成 "NT$ 0"（Bug）

## 對應需求規格

對應 G1 已核准的需求規格。根因已由 requirements-analyst 定位、orchestrator
獨立核實程式碼：`frontend/lib/format.ts` 第 5-8 行，`formatCurrency()` 用
`Math.round(value)` 把任何介於 0 與 0.5 之間的非零金額捨入成整數 0，顯示成
"NT$ 0"；`formatSignedCurrency()`（第 15-19 行）對 `Math.abs(value)` 做同樣
的 `Math.round`，有一樣的瑕疵。`VersionCostChart` 的折線圖與其下方表格共用
同一組未經任何 rounding 的原始 `entries`/`byDate()` 資料（單一 API 呼叫、
bff 端只有一條聚合路徑）——折線圖本身不捨入、用 min/max 自動縮放座標軸，
所以微小非零差異在圖上看得出來，但正下方表格套用 `formatCurrency()` 後顯示
"NT$ 0"，造成圖表與表格表面矛盾；兩條資料路徑算出的答案其實一致，問題
完全在這個共用格式化函式。

範圍：僅修正 `frontend/lib/format.ts` 的 `formatCurrency()` 與
`formatSignedCurrency()` 兩個函式本身。

範圍外（G1 已核准，不可擴大）：不修改 `bff/api/agent_detail.py` 或任何 Opik
聚合邏輯；不修改圖表 Y 軸縮放邏輯；不處理 NT$/US$ 幣別符號問題（SDLCCT-67
另行處理）；不新增使用者可調整精度設定。

## 介面/API 契約

無新增/變更對外 HTTP 介面。`bff` 回應格式（送到前端的原始數值欄位）完全
不變，前端 API client（`lib/agent-detail-api.ts`、`lib/cost-overview-api.ts`
等）的型別定義也完全不變——這是一個純展示層格式化函式的內部修正，兩個
函式的簽名（`(value: number | null | undefined) => string`）維持不變，所有
既有呼叫點（`version-cost-chart.tsx`、`summary-section.tsx`、
`period-comparison-section.tsx`、`agents/page.tsx`、
`model-breakdown-table.tsx`）不需要修改任何呼叫方式。

## 資料模型

無新增資料模型。無資料庫、無新欄位、無索引異動——純前端展示層字串格式化
修正。

## 關鍵技術決策

1. **判斷規則用「`Math.round(value)` 的結果是否為 0 但原始值不是 0」，而
   非「永遠顯示到小數點後 2 位」或「設一個固定的最小顯示下限（如
   0.01）」**——這樣只有真正會被整數捨入吃掉的那一小段非零區間
   （`0 < |value| < 0.5`）才改變顯示格式，AC4 要求的一般金額（>=0.5，整數
   顯示如 "NT$ 1,234"）外觀完全不受影響，不需要重新驗證所有既有畫面的
   數字排版；若改成「永遠顯示 2 位小數」會讓所有金額都多出 ".00"，牴觸
   AC4 的回歸要求與既有畫面的視覺慣例。

2. **非零捨入為零的情況，固定顯示到小數點後 2 位（`toLocaleString("zh-TW",
   { minimumFractionDigits: 2, maximumFractionDigits: 2 })`），不是「顯示到
   第一個非零有效位數」之類的動態精度**——2 位小數剛好對應 Jira 票 AC1 給
   的具體範例（0.02 → "NT$ 0.02"），實作最簡單、行為可預期；因為這個分支
   只會在 `|value| < 0.5` 時觸發，`toLocaleString` 不會也不需要做千分位
   分隔，不會跟 AC4 的整數千分位顯示產生格式衝突。

3. **`formatSignedCurrency()` 套用與 `formatCurrency()` 完全對稱的規則
   （對 `Math.abs(value)` 做同樣的「捨入為零但原值非零」判斷），符號
   （`+`/`-`/空字串）邏輯本身不變**——週期比較區塊顯示的是金額差異
   （delta），同樣可能出現一個小流量 Agent 兩期成本差異是 0.0x 元的情況，
   保持兩個函式規則一致，未來維護者不需要記兩套不同的捨入語意。

4. **不改動 `value === null || value === undefined` 的早退路徑、也不改動
   真正 `value === 0` 的行為**——`Math.round(0) === 0` 且 `0 !== 0` 為
   `false`，新判斷式天然略過真正零元，不需要額外的特判分支，直接滿足
   AC2（真正 0 元仍顯示 "NT$ 0"）與 AC3（null 顯示 "—" 不受影響）。

## UI 原型

無，本 Story 不新增或變更任何畫面、元件、版面配置或樣式——這是對既有畫面
（Cost 總覽摘要卡片、Agents 列表、Agent 詳情頁模型拆解表、週期比較區塊、
版本成本圖表下方表格）共用的格式化函式做顯示數字內容的修正，使用的元件、
CSS class、版面結構全部不變，只有特定數值區間（非零小額）的字串內容改變，
不需要靜態原型。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style（沒有調整任何
className、沒有調整任何元件結構），只改變 `formatCurrency()`/
`formatSignedCurrency()` 回傳的文字內容。已檢查
`frontend/e2e/*.spec.ts` 全部 6 個檔案：唯一出現 `getComputedStyle` 的是
`trace-detail.spec.ts`（第 86、88 行，比對 trace 列表列的
`paddingLeft`），與本 Story 的數字顯示範圍無關；`grep "toEqual|一致|
consistent"` 在 `frontend/e2e/` 與 `frontend/**/*.test.ts*` 中的其餘命中
（`use-fetch-once.test.ts`、`group-spans.test.ts`）皆為資料物件相等性斷言，
與樣式耦合無關。結論：不適用，無需列出任何連鎖測試。

## 測試影響摘要（給開發者參考，非規格）

- `frontend/lib/format.ts` 目前沒有對應的單元測試檔
  （`frontend/lib/format.test.ts` 不存在）——開發者應新增此檔，至少涵蓋
  AC1-AC4 四個情境：`formatCurrency(0.02)` → `"NT$ 0.02"`、
  `formatCurrency(0)` → `"NT$ 0"`、`formatCurrency(null)` / `(undefined)`
  → `"—"`、`formatCurrency(1234.4)` → `"NT$ 1,234"`（回歸）；
  `formatSignedCurrency()` 比照對稱案例（含正負號）。
- 既有 e2e（`agent-detail.spec.ts`、`cost-dashboard.spec.ts` 等）若有斷言
  字面金額字串，需確認測資中是否剛好落在 `0 < value < 0.5` 的捨入為零
  區間；若有，預期字串需同步更新為帶 2 位小數的新格式，這屬於開發階段的
  既有測試資料核對，不是新的產品決策。

## 開放設計問題(定稿時必須為空)

（無）
