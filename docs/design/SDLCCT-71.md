# 設計文件 — SDLCCT-71 版本成本時間序列表格在小額金額時顯示小數精度

## 對應需求規格
G1 已核准的需求規格(本票單描述,14 個 Gherkin 情境)。核心規則變更:
`formatCurrency`/`formatSignedCurrency`(`frontend/lib/format.ts`)目前只在
「捨入後恰為 0 且原值非 0」(SDLCCT-70 建立的規則)時才顯示 2 位小數,其餘一律
整數捨入 + 千分位。本次把觸發條件從「捨入後 === 0」放寬為「`Math.abs(value) < 100`」,
使所有小額金額(< US$100)都顯示 2 位小數,`>= 100` 則維持原本整數捨入 + 千分位
行為不變。修正範圍已在票單中定案為只修改 `frontend/lib/format.ts` 這兩個函式,
不修改呼叫端、不修改圖表座標計算邏輯。

## 介面/API 契約
無新增或變更的對外介面。這是純前端展示層邏輯變更,不涉及 bff/API。

`formatCurrency`/`formatSignedCurrency` 的函式簽章(輸入/輸出型別)**不變**:

```ts
export function formatCurrency(value: number | null | undefined): string
export function formatSignedCurrency(value: number | null | undefined): string
```

兩者的呼叫端(`version-cost-chart.tsx` 表格儲存格、Y 軸標籤等所有既有呼叫處)
**完全不需修改** —— 回傳值仍是 `string`,只是同一組輸入在 `< 100` 區間會回傳不同
(更精確)的字串內容。這也是本票單範圍外事項之一:不變更任何呼叫方式。

## 資料模型
無新增資料模型。本票單不涉及任何資料庫欄位、資料表、索引或 API payload 結構變更,
純粹是前端格式化函式內部的 if 條件邏輯調整。

## 關鍵技術決策

1. **門檻值選擇「`< 100`」而非「`<= 100`」或其他邊界,直接取自 Gherkin 情境
   6/7 的逐字定案值** —— `99.99` → 2 位小數、`100.4` → 整數,所以判斷式用嚴格
   小於:`Math.abs(value) < 100`。理由:規格已明確定案邊界行為,不需架構師二次決策。

2. **沿用 SDLCCT-70 既有的「先判斷區間、再決定要不要加
   `minimumFractionDigits`/`maximumFractionDigits`」寫法,只替換判斷條件本身**,
   不引入新的格式化策略(例如依賴序列整體波動動態決定小數位數,票單已明確排除
   此做法)。理由:維持與前次設計一致的程式碼形狀,降低 reviewer 認知負擔,也符合
   「只做規格要求的最小變更」原則。

3. **`formatSignedCurrency` 的判斷門檻用 `Math.abs(abs) < 100`(即對取絕對值後的
   `abs` 變數做判斷),對稱沿用 `formatCurrency` 的邏輯,不額外為正負號分支**。
   理由:Gherkin 情境 10/11 要求正負值對稱套用同一門檻,現有程式碼已經先算出
   `abs` 再做判斷,直接複用既有變數即可,不需新邏輯。

4. **真正的 `0` 不受影響,仍落在「`Math.abs(0) < 100`」為真的分支,但因為
   `0.toLocaleString(...)` 在 `minimumFractionDigits: 2` 下會變成 `"0.00"`,
   與 Gherkin 情境 3 要求的 `"US$ 0"` 不符** —— 因此判斷式必須保留 SDLCCT-70
   原有的「`value !== 0`」排除條件,寫成
   `Math.abs(value) < 100 && value !== 0`(`formatCurrency`)/
   `Math.abs(abs) < 100 && abs !== 0`(`formatSignedCurrency`),而不是單純把
   `Math.round(value) === 0` 換成 `Math.abs(value) < 100`。這是唯一容易在實作時
   漏掉的細節,developer 需特別注意:新條件是「取代原有 `Math.round(value) === 0`
   這一半」,`&& value !== 0` 那一半原封不動保留。

### 具體程式碼變更(供 developer 直接依此實作,不需自行設計)

`frontend/lib/format.ts`:

```ts
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) < 100 && value !== 0) {
    return `US$ ${value.toLocaleString("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `US$ ${Math.round(value).toLocaleString("zh-TW")}`;
}
```

```ts
export function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 100 && abs !== 0) {
    return `${sign}US$ ${abs.toLocaleString("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${sign}US$ ${Math.round(abs).toLocaleString("zh-TW")}`;
}
```

唯一的程式碼差異:`Math.round(value) === 0`→`Math.abs(value) < 100`
(`formatCurrency`),`Math.round(abs) === 0`→`abs < 100`(`formatSignedCurrency`)。
`&& value !== 0` / `&& abs !== 0` 不變。其餘函式(`formatPercent`、
`formatTaiwanDate`、`formatTaiwanDateTime`、`formatDateRange`)不受影響,
本票單範圍外。

### 測試變更(供 developer/tester 對照)

- `frontend/lib/format.test.ts` 第 26-28 行既有斷言
  `expect(formatCurrency(0.6)).toBe("US$ 1")` 必須改為
  `expect(formatCurrency(0.6)).toBe("US$ 0.60")`(規格 Gherkin 情境 9 定案)。
  同一測試標題「renders a boundary amount of exactly 0.5 with integer
  rounding (AC4 regression boundary)」已不再準確(0.6 現在落在 < 100 分支),
  建議連同標題一併更新為反映新行為(例如「renders 0.6 with 2-decimal
  precision now that it falls under the US$100 threshold」),避免誤導後續
  讀者,但這屬於測試描述文字調整,developer 可自行決定措辭,不是開放設計問題。
- 建議在 `frontend/components/agent-detail/version-cost-chart.test.tsx`
  依 Gherkin 情境 14(10/9~10/14 六天 2.1/1.3/2.8/1.9/2.4/1.6)新增回歸測試,
  斷言六個儲存格分別顯示 "US$ 2.10"/"US$ 1.30"/"US$ 2.80"/"US$ 1.90"/
  "US$ 2.40"/"US$ 1.60" 且彼此不完全相同。

### 跨元素樣式耦合測試檢查(流程步驟 4)

本票單不涉及任何 CSS/計算樣式(computed style)變更,只變更文字內容
(格式化後的字串),未變更任何 selector 的樣式規則。已檢查
`frontend/` 下 `*.test.tsx`/`tests/e2e/` 是否存在比較兩元素 computed style
相等的測試(如 `toEqual`、測試名含「一致」/「一致性」等) —— 本次變更的
`formatCurrency`/`formatSignedCurrency` 不是任何樣式選擇器,不涉及此類耦合
測試,無需額外處理。

## UI 原型
本票單變更「版本成本時間序列」表格內顯示的每日成本金額文字內容(從整數捨入
改為小額金額顯示 2 位小數),屬於畫面可見內容變更,已附上靜態原型:
`docs/design/SDLCCT-71-prototype.html`。原型以 Gherkin 情境 14 的
10/9~10/14 六天數值(2.1, 1.3, 2.8, 1.9, 2.4, 1.6,皆 < US$100)並排呈現
「修正前」與「修正後」兩個表格,讓人類 reviewer 不需執行專案即可直接看出
視覺差異(修正前六格皆顯示相同捨入值看起來持平,修正後呈現逐日波動)。

## 開放設計問題(定稿時必須為空)
無。本票單的修正範圍、門檻值、邊界行為、既有測試斷言更新內容,皆已在票單的
「修正範圍決策(已定案)」與 14 個 Gherkin 情境中逐字定案,設計階段不需也未
做任何規格未定的產品決策。
