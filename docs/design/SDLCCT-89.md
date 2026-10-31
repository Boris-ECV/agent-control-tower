# 設計文件 — SDLCCT-89 版本成本圖 Y 軸多層次淡色水平格線

## 對應需求規格

對應 G1 已核准的需求規格（SDLCCT-81 拆分出的第二張子票；SDLCCT-88 對齊表格欄中心已完成，SDLCCT-90 面積漸層另案）。5 條 Gherkin 情境（已定稿）：

1. 至少 1 個非 null 數值且 max != min 時，背景顯示 4 條水平格線：位於 min、max，以及兩者之間 2 條等距層級（4 個等距 Y 位置）。
2. 全部數值相同（max == min）時，只顯示 1 條格線，位置為既有單一 Y 軸標示所在高度。
3. 全部為 null 時，不顯示任何格線，也不出現「0」刻度。
4. 格線顏色為 `--color-border`（淡色），且在 DOM 順序上，每一條格線都先於所有 `<polyline>`。
5. 既有 Y 軸標示不回歸：金額標示仍只有最大值與最小值（或單一值），位置沿用 SDLCCT-73。

**範圍外**：Y 軸 max／min 計算與標示文字（SDLCCT-73）；中間層級格線不帶金額文字；不加 X 方向格線與 X 軸文字（SDLCCT-88 已完成）；不加面積填色（SDLCCT-90）；不引入圖表函式庫（維持手刻 inline SVG，`docs/design/SDLCCT-48.md` 決策 3）。

## 現狀查核（實作前已逐字讀取）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一需改動的元件檔）：
  - `min`／`max` 由所有非 null 值求得；無值時 `min = max = 0`，但 `hasValues` 為 false。
  - `yFor(value)`：`max === min` 時回傳 `CHART_PADDING + innerHeight / 2`（=80）；否則 `CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight`。常數 `CHART_HEIGHT = 160`、`CHART_PADDING = 24`、`innerHeight = 112`。對 `value` 為**嚴格線性（仿射）映射**：`yFor(max) = 24`、`yFor(min) = 136`。
  - `labels`（SDLCCT-73）：無值為 `[]`；`max === min` 為單一 `{ key: "single", y: yFor(max) }`；否則 `max`、`min` 兩筆。
  - 現行格線（SDLCCT-78）：SVG 內第一個 `<g>`（無屬性）逐一把 `labels` 畫成 `<line x1=layout.plotLeft x2=layout.width y1=label.y y2=label.y stroke="var(--color-border)" strokeWidth={1}>`。也就是目前格線**數量與位置完全綁在 `labels`**，只有 max／min（或 single）。該 `<g>` 位於所有 `<polyline>` 的 `<g>` 之前，DOM 順序已滿足情境 4。
  - Y 軸金額標示在 `<g data-axis="y">`，只含 `<text>`，位於折線之後。
  - 其他 `<line>`：hover 十字線，帶 `strokeDasharray="2,2"`，只在 `hoveredIndex !== null` 時存在；hover overlay 為 `<rect>`。**格線不得帶 `stroke-dasharray`**，否則會被既有 `svg line[stroke-dasharray]` 選擇器誤認為十字線。
- 單元測試 `frontend/components/agent-detail/version-cost-chart.test.tsx` 中與格線數量相關的斷言（逐一核對）：
  - 第 368-369 行（SDLCCT-78，max≠min，2 個版本）`querySelectorAll("line")` `toHaveLength(2)`——**會因本票變 4，必須更新**。同測試第 383-385 行 `lineYs` 包含 max／min 文字 y——仍成立（兩端點格線 y 與標示 y 相同）。
  - 第 1404 行（SDLCCT-88 情境 3/6）`svg > g:first-of-type > line` `toHaveLength(2)`——**會變 4，必須更新**（`lineEntries` 為 max≠min）。
  - 第 455-456 行（max === min）`toHaveLength(1)`、第 482／493 行與第 1513 行（全 null／空陣列）`toHaveLength(0)`——**不受影響，維持**。
  - 第 401-409、519-531 行（DOM 順序）——不受影響，可作為情境 4 的既有覆蓋。
  - 第 858-1112 行等 `svg line[stroke-dasharray]`（十字線）——不受影響，前提是格線不帶 dasharray。
- E2E `frontend/e2e/agent-detail.spec.ts`：全檔 `Grep("\bline\b|stroke")` 僅第 1116 行 `line[stroke-dasharray]`（十字線），**沒有任何 e2e 斷言格線 `<line>` 數量**；第 403-497 行的 `data-axis="y"` `<text>` 數量斷言（2／1／0）屬 Y 標示，不受影響。
- **跨元素 computed style 耦合檢查**：本設計未改變任何既有選擇器的 computed style（格線 stroke 仍為 `var(--color-border)`、粗細 1 不變，僅增加同樣式的元素）。全 `e2e/` 的 `toEqual|一致|getComputedStyle` 僅涉 `<th>` 文字陣列、`<polyline>` 座標數量與另一元件的 `paddingLeft`，與格線無關。**不適用，無需處理。**
- `docs/design-system.md` §11.1「圖表軸線與格線」目前有 X 軸規則、格線顏色規則、疊圖順序規則，**沒有層級數與等距規則**。

## 介面/API 契約

無對外介面變更（無 bff 端點、無 request／response 異動），元件 props 不變：`VersionCostChart({ entries, anchorDate })`。純前端渲染層。

### 格線層級公式（定案）

令 `N = 4`（層級數，常數 `GRIDLINE_LEVELS = 4`），`k = 0, 1, 2, 3`：

- **數值空間**：`level_k = max - k * (max - min) / 3`，即 `max`、`max - Δ/3`、`min + Δ/3`、`min`（Δ = max - min），與規格列的 `min, min+(max-min)/3, min+2(max-min)/3, max` 為同一集合。
- **像素空間（實作採用）**：`y_k = CHART_PADDING + k * innerHeight / 3` = 24、61.333…、98.666…、136。
- 兩者等價：`yFor` 對 `value` 是線性映射（見現狀查核），故 `yFor(level_k) = CHART_PADDING + k * innerHeight / 3`，4 個 Y 位置**相鄰間距恆為 `innerHeight / 3`（≈ 37.33px）**。實作用像素空間公式直接計算，不經 `yFor`，原因：避免浮點數誤差（`(value - min)/(max - min)` 在數值空間先做除法再乘回），並讓「格線位置只依賴版面常數」一目了然。
- 端點對齊保證：`y_0 = 24 = yFor(max)`、`y_3 = 136 = yFor(min)`，與 Y 軸標示的 `y`（由 `yFor` 計算）在 IEEE 754 下完全相等（24 + 3·112/3 = 24 + 112 = 136 皆為精確整數運算結果）；測試仍使用 `toBeCloseTo(…, 1)` 比較以防日後常數調整。

### 渲染規則（以 `hasValues` 與 `max === min` 分三種）

| 條件 | 格線 | 位置 |
| --- | --- | --- |
| `!hasValues`（全 null 或空陣列） | 0 條（不渲染格線群組內任何 `<line>`，也不渲染 0 刻度） | — |
| `hasValues && max === min` | 1 條，`data-gridline="single"` | `yFor(max)` = `CHART_PADDING + innerHeight / 2` = 80，即既有單一 Y 軸標示的 `y` |
| `hasValues && max !== min` | 4 條，`data-gridline` 依序 `"max"`、`"upper"`、`"lower"`、`"min"` | `y_0..y_3`，由上而下 |

### DOM 合約（新增，供測試與維護）

```tsx
<g data-gridlines>          // 取代原本無屬性的第一個 <g>；仍為 <svg> 的第一個子 <g>
  <line data-gridline="max"   x1={plotLeft} x2={width} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
  <line data-gridline="upper" … />
  <line data-gridline="lower" … />
  <line data-gridline="min"   … />   // max===min 時唯一一條為 data-gridline="single"
</g>
```

- 格線群組沿用「SVG 內第一個 `<g>`」位置，因此既有選擇器 `svg > g:first-of-type > line` 與「所有格線先於所有 `<polyline>`」仍成立（情境 4）；新增 `data-gridlines`／`data-gridline` 供測試以語意選擇器取代位置選擇器。
- 格線 `<line>` **不帶 `strokeDasharray`**、不帶任何 `<text>` 子節點；群組內不得放 `<text>`。中間層級（`upper`／`lower`）不輸出金額文字（範圍外）。
- 格線水平範圍沿用 SDLCCT-88：`x1 = layout.plotLeft`、`x2 = layout.width`。
- Y 軸金額標示保持原樣：仍由 `labels`（max／min 或 single）驅動，渲染於 `<g data-axis="y">` 的 `<text>`，**數量恆為 2（或 1／0）**。格線與標示在 DOM 上分屬兩個群組，標示與格線的唯一關聯是端點 `y` 相同。

## 資料模型

無新增資料模型。不新增 state、props 或後端欄位。元件內僅新增一個衍生值：

```ts
const GRIDLINE_LEVELS = 4;
type Gridline = { key: "max" | "upper" | "lower" | "min" | "single"; y: number };
const gridlines: Gridline[] = !hasValues
  ? []
  : max === min
    ? [{ key: "single", y: yFor(max) }]
    : (["max", "upper", "lower", "min"] as const).map((key, k) => ({
        key,
        y: CHART_PADDING + (k * innerHeight) / (GRIDLINE_LEVELS - 1),
      }));
```

`labels` 不變，不再被格線 `.map` 使用。

## 關鍵技術決策

1. **格線與 Y 標示解耦**：原格線 `.map(labels)` 把「幾條格線」綁死為「幾個標示」；本票格線數（4）與標示數（2）不同，故獨立為 `gridlines` 陣列，`labels` 完全不動，確保情境 5（SDLCCT-73 不回歸）。
2. **像素空間等距、端點對齊標示**：`yFor` 線性，故兩空間等價；選像素空間避免多餘浮點運算並把等距性直接寫在公式裡。
3. **層級數固定為 4（含兩端點）**：spec 定案；以常數 `GRIDLINE_LEVELS` 命名，不做成可設定 prop（YAGNI）。
4. **`max === min` 只畫 1 條且位於垂直中央**：沿用既有 `yFor` 的退化規則，不新發明；不補畫上下對稱格線（情境 2）。
5. **不新增或調整顏色**：沿用 `var(--color-border)`、`strokeWidth={1}`。「淡色」靠既有 token，且層級間不做深淺區分（spec 未要求），避免誤認為資料線（`docs/design-system.md` §11.1 顏色規則）。
6. **新增 `data-gridlines`／`data-gridline` 屬性**：讓測試能區分格線與十字線，而不依賴位置選擇器或 `stroke-dasharray` 的反向排除。

## 測試策略（供 developer／tester 對照，非新增需求）

**需更新的既有單元測試（`version-cost-chart.test.tsx`）**
1. 第 368-369 行（SDLCCT-78 格線與標示對齊測試）：`toHaveLength(2)` 改 `4`；`lineYs` 包含 max／min 文字 y 的斷言保留。
2. 第 1404 行（SDLCCT-88 情境 3/6）：`svg > g:first-of-type > line` 數量由 `2` 改 `4`。

**維持不變（經核對不受影響）**：第 455-456（single=1）、482／493／1513（0 條）、401-409／519-531（DOM 順序）、所有 `line[stroke-dasharray]` 十字線測試、`data-axis="y"` `<text>` 數量測試。

**新增單元測試**
1. 情境 1：max≠min 時 `svg g[data-gridlines] > line` 恰 4 條；`data-gridline` 順序為 `max, upper, lower, min`；`y` 嚴格遞增且相鄰差皆 `≈ innerHeight/3`（`toBeCloseTo`，用 `(CHART_HEIGHT - 2*CHART_PADDING)/3` 推算，不硬編碼 37.33）；首條 `y` 等於 max 標示 `y`、末條等於 min 標示 `y`。
2. 情境 1 補強：中間兩條 `y` 等於 `yFor` 對 `min + Δ/3`、`min + 2Δ/3` 的結果（在測試內以相同線性公式獨立計算），證明數值／像素空間一致。
3. 情境 2：`max === min` 時恰 1 條、`data-gridline="single"`、`y` 等於單一標示 `y`（既有第 455 行測試可補 `data-gridline` 斷言）。
4. 情境 3：全 null 與 `entries=[]` 時 `g[data-gridlines] > line` 為 0 且整個 SVG 中沒有 `<text>` 內容為「US$ 0」／「0」（任何 Y 標示 `<text>` 為 0）。
5. 情境 4：每條格線 `stroke === "var(--color-border)"`、無 `stroke-dasharray`；DOM 順序中 max≠min、多版本（3 條 polyline）時所有格線先於所有 `<polyline>`（沿用第 519-531 行寫法並納入 4 條）。
6. 情境 5：max≠min 時 `svg g[data-axis="y"] text` 恰 2 個、文字為 max／min 的 `formatCurrency`；`g[data-gridlines]` 內無 `<text>`；`upper`／`lower` 層級金額字串（例如 `US$ 200`、`US$ 300` 類）不在任何 `<text>` 出現。
7. 資料含 null 但仍有非 null 值（至少一個）時格線仍為 4 條（max≠min）。
8. hover 回歸：hover 後 `svg line[stroke-dasharray]` 恆為 1 條（格線不被誤計）。

**新增 E2E（Playwright，`frontend/e2e/agent-detail.spec.ts`；一律 `CI=1 npx playwright test --workers=1`）**
- 以 `page.route` 模擬 cost-breakdown（≥ 2 個版本、max≠min），視窗 1280×800：斷言 `svg g[data-gridlines] > line` 為 4 條；取各條 `boundingBox().y`（或 `getAttribute("y1")`，因量測後 viewBox 與像素 1:1）驗證相鄰間距相等（容差 ≤ 1px）；最上與最下條與 `svg g[data-axis="y"] text` 兩個標示的 `y` 差 ≤ 1px；`g[data-axis="y"] text` 仍為 2。此單一 e2e 同時涵蓋情境 1、5；情境 2、3、4 由單元測試承擔（e2e 無法比 jsdom 更精確，且既有 e2e 已有單一值／全 null 的 Y 標示場景）。

## 設計系統文件異動（本票同一個 PR 內一併交付，由 developer 實作）

本設計階段不編輯下列檔案，列為實作任務（就地新增段落，不可刪減其他內容）：

1. `docs/design-system.md` §11.1「圖表軸線與格線」新增「**格線層級數與等距規則**」：有至少一個非 null 值且 max≠min 時，水平格線固定 4 層、Y 位置等距（含 min 與 max 兩端點，相鄰間距 `innerHeight / 3`）；max===min 只畫 1 條、位於單一 Y 標示高度；全 null 不畫格線且不顯示 0 刻度；只有最大／最小值（或單一值）帶金額文字，中間層級不帶文字；格線顏色與疊圖順序沿用本節既有兩條規則。
2. 元件檔頂部註解補一行指向本設計文件（`docs/design/SDLCCT-89.md`：4 層等距格線，像素空間公式）。

## UI 原型

`docs/design/SDLCCT-89-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，無需安裝任何套件；沿用 SDLCCT-88 原型的色彩、字級、版面 token 與「量測表頭欄中心」機制）。原型以按鈕切換三種資料情境，並即時顯示格線條數、各格線 Y 與相鄰間距、與 DOM 順序檢查：

- 情境 1、5：預設「一般資料（max≠min）」：4 條淡色水平格線等距分佈，Y 軸金額標示只有最大與最小兩個；中間兩條格線沒有文字。
- 情境 2：「所有數值相同」：僅 1 條格線，位於單一標示高度。
- 情境 3：「全部為 null」：無格線、無 0 刻度、無折線。
- 情境 4：格線為 `#E5E7EB`（`--color-border`），畫在折線之後方；可勾選「把格線改成醒目紅色」僅為示範格線位於折線底層（實作中不存在）。「DOM 順序檢查」讀數由頁面即時掃描 `<svg>` 子孫產生，驗證所有 `<line data-gridline>` 先於所有 `<polyline>`。

原型中的讀數面板、情境按鈕與醒目紅色切換僅供示範，實作中不存在。

## 開放設計問題（定稿時必須為空）

（無）
