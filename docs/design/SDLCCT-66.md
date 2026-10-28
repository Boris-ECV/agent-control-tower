# 設計文件 — SDLCCT-66 跨 Agent 期間比較的百分比在基期過小時呈現方式容易誤導

## 對應需求規格
對應 G1 已核准的需求規格。4 條 Gherkin AC（已定稿，含具體門檻 US$10）：
1. 前期金額充足（≥US$10）時維持現狀：`"+US$ 250（50.0%）"`，無標籤。
2. 前期金額過小（<US$10，例如 US$1）：只顯示 `"+US$ 638"`，不顯示百分比，
   顯示「新增顯著支出」標籤。
3. 前期金額為零：同上，只顯示金額 + 標籤，不顯示百分比。
4. 門檻邊界：`previous_cost == US$10` 本身仍視為「正常」（不觸發門檻），
   顯示 `"+US$ 10（100.0%）"`，無標籤。即門檻判斷是 `previous_cost < 10`
   （嚴格小於，不是 `<=`）。

範圍外：像素級視覺細節、後端成本計算邏輯（`current_cost`/`previous_cost`/
`delta` 不變）、其他畫面的類似問題。依賴：SDLCCT-32（本畫面與
`period-comparison` 端點的原始設計）、SDLCCT-67（金額符號已改為 US$，本票
延續 `formatSignedCurrency`/`formatCurrency` 既有輸出格式，不重新改符號）。

## 介面/API 契約
**BFF 契約不變更。** 確認依據：`bff/api/cost_overview.py::get_period_comparison()`
回傳的 `agents[]` 陣列每個元素已經包含 `current_cost`、`previous_cost`（原始
數字，非僅衍生後的 `delta`/`delta_pct`）——見該函式第 150-163 行：

```python
agents.append({
    "key": key,
    "display": r["display"],
    "current_cost": current_cost,
    "previous_cost": previous_cost,
    "delta": delta,
    "delta_pct": delta_pct,   # None when previous_cost == 0（既有行為，本票不變更）
})
```

`frontend/components/cost-overview/period-comparison-section.tsx` 第 60-61
行已經直接讀取並渲染 `agent.previous_cost`（原始數字，供左側「前期花費」欄
顯示），因此前端在渲染 Delta 欄時，同一個 `agent` 物件上本來就有
`previous_cost` 可以做門檻判斷，不需要後端新增任何欄位（例如
`is_notable_new_spend` 之類的布林欄位是不必要的——會變成「同一個判斷邏輯
兩邊都要維護」的重複，違反 CONSTITUTION「scope discipline：規格沒要求的不
做」，且門檻值 US$10 是純展示層判斷，與 SDLCCT-32 決策「台灣時間換算在
前端/展示層，不在 bff」的精神一致：衍生展示判斷留在展示層）。

**結論：純前端變更**，只修改 `period-comparison-section.tsx` 的 Delta 欄
渲染邏輯，`GET /api/cost-overview/period-comparison` 的 request/response
格式、狀態碼完全不變。

## 資料模型
無新增資料模型，無新增/變更欄位。既有 `agents[].previous_cost`/
`current_cost`/`delta`/`delta_pct`（SDLCCT-32 定案）原樣保留。

## 關鍵技術決策

- **門檻判斷放在前端元件，不放 BFF**——理由見上方「介面/API 契約」：前端
  已持有判斷所需的原始值 `previous_cost`，新增 BFF 欄位只是把同一個比較
  搬到另一層，徒增兩層程式碼要保持邏輯同步的維護成本，且與 SDLCCT-32
  「展示層判斷留在展示層」的既有決策方向一致。
- **門檻邏輯**：`agent.previous_cost < 10`（嚴格小於）時進入「基期過小」
  分支：不渲染 `delta_pct`（即使 BFF 回傳的 `delta_pct` 非 null，例如
  AC2 的 US$1→US$639 情境 BFF 仍會算出一個百分比，前端主動忽略它、不
  顯示），改渲染「新增顯著支出」標籤。`previous_cost === 10` 不觸發（AC4
  邊界），對應 `< 10` 而非 `<= 10`。`previous_cost === 0` 時 BFF 本來就回傳
  `delta_pct: null`（除以零防呆，SDLCCT-32 既有行為），天然落在同一個
  `< 10` 分支內，不需要為零值另開一個 `=== null` 分支——用同一個數值比較
  同時覆蓋 AC2（金額過小）與 AC3（金額為零）兩個 Scenario，避免兩套互相
  獨立的條件判斷在邊界上出現不一致。
- **標籤文案「新增顯著支出」、位置與樣式**：標籤渲染在 Delta 欄內、金額
  文字的右側（inline，同一個 `<td>`），即原本 `agent.delta_pct !== null`
  時顯示百分比的位置改為顯示標籤——因為兩者（百分比 vs 標籤）是互斥的
  "次要資訊"，佔用版面上同一個視覺位置，使用者看 Delta 欄的視覺掃讀路徑
  不變（金額在前、補充說明在後）。
  樣式沿用本畫面既有的「治理缺口」強調樣式語彙（`summary-section.tsx`
  第 99 行同一套 badge class，本票沿用其縮小變體，對應 `agents/page.tsx`
  第 76 行 `未登錄` badge 的 class，視覺權重相同——都是
  `border-red-300 bg-red-50 text-red-700 font-semibold` 的紅色強調
  badge，等同既有「顯眼標示」的視覺基準，滿足 spec 範圍內「視覺權重不低於
  現有強調樣式」的要求）：
  ```tsx
  <span className="ml-1.5 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
    新增顯著支出
  </span>
  ```
  Delta 數字本身（`formatSignedCurrency(agent.delta)`）在「基期過小」分支
  仍維持原本的 `text-red-700 font-semibold`（`agent.delta > 0` 必為真，
  因為 AC2/AC3 的 `delta` 恆為正——前期過小或為零、本期有花費，兩者相減
  必為正)，不需要額外改動既有的金額顏色判斷邏輯。
  新增 i18n 字串 `costOverview.period.notableNewSpendBadge: "新增顯著支出"`
  於 `frontend/lib/i18n/messages.ts` 的 `costOverview.period` 區塊（與既有
  `delta: "漲幅"` 同層級），不寫死字串在元件內（沿用本專案既有 i18n 慣例）。
- **門檻常數集中定義**：新增 `const NOTABLE_NEW_SPEND_THRESHOLD_USD = 10;`
  於 `period-comparison-section.tsx` 檔案層級（或抽到 `lib/format.ts` 若
  developer 認為未來其他畫面會重用——但本票範圍內只有這一個畫面用到，依
  CONSTITUTION「三行重複優於過早抽象」，預設放在元件檔案內即可，不強制
  抽出共用模組）。常數命名與數值明確對應 spec 的「US$10」，不埋成魔術數字。

## UI 原型
**需要。** 本票變更既有畫面的渲染邏輯與新增一個顯眼標籤，屬於「調整元件
樣式」的 UI 變更。新增 `docs/design/SDLCCT-66-prototype.html`（純 HTML/CSS
靜態原型，可直接在瀏覽器開啟），涵蓋 spec 的 4 個 Scenario 各一行範例：
- Row 1：前期 US$500 → 本期 US$750，顯示 `+US$ 250（50.0%）`，無標籤。
- Row 2：前期 US$1 → 本期 US$639，顯示 `+US$ 638` + 「新增顯著支出」標籤。
- Row 3：前期 US$0 → 本期 US$120，顯示 `+US$ 120` + 「新增顯著支出」標籤。
- Row 4（邊界）：前期 US$10 → 本期 US$20，顯示 `+US$ 10（100.0%）`，無標籤。
套用 `docs/design-system.md` 已定稿的色彩/字級/間距 token，標籤樣式與本文
件「關鍵技術決策」段落所定的 class 一致，供人類在 G1b 直接比對 4 個
Scenario 的呈現差異。

## 開放設計問題（定稿時必須為空）
（無）
