# 設計文件 — SDLCCT-88 版本成本圖資料點 X 座標對齊表格日期欄中心，並移除圖表內 X 軸日期文字

## 對應需求規格

對應 G1 已核准的需求規格（SDLCCT-81 拆分出的第一張子票；另兩張為 SDLCCT-89 多層次格線、SDLCCT-90 面積漸層）。6 條 Gherkin 情境（已定稿）：

1. 圖表與表格位於同一版面容器、至少 1 個版本在 7 天內有非 null 值時，每個日期所有資料點的 X 座標與表格該日期欄位欄寬中心的差距 ≤ 1px。
2. 容器寬度改變（例：1280px → 768px）後，仍對齊（≤ 1px）。
3. 圖表 SVG 內沒有獨立的 X 軸日期文字（`data-axis="x"` 群組不存在）；日期僅出現在表格標題列與 hover tooltip 第一行。
4. hover 與終點標籤跟隨新 X 座標：十字線 X = 該日期資料點 X；tooltip 仍列出全部版本當日金額；終點標籤跟隨最後一個有值點。
5. 缺值不回歸：null 前後斷線、不內插、不顯示 0，表格該格仍顯示「—」。
6. 既有互動與無障礙不回歸：SVG `role="img"` + `aria-label`、表格存在且可讀、Y 軸金額標示與水平格線仍顯示、終點標籤／圖例二選一門檻（序列數 ≤ 4）不變。

**範圍外**：不引入圖表函式庫（維持手刻 inline SVG，`docs/design/SDLCCT-48.md` 決策 3）；不改 Y 軸 max／min 計算（SDLCCT-73）；不新增多層次格線（SDLCCT-89）與面積漸層（SDLCCT-90）；不涉 Agent 清單 sparkline；不改 hover／tooltip 內容與樣式規則（SDLCCT-80），僅其 X 座標來源改變。

**參考資料（非依賴）**：人類提供的參考稿 `docs/design/references/ui-review-v2/agent-control-tower-v2.html` 的 `drawChart()` 以 `x = i => L + (i + 0.5) * colW` 計算 X，本設計的欄中心概念與之相同，但採「量測真實表格」而非「寫死欄寬」，理由見決策 1。本 Story 的規格不依賴該參考稿。

## 現狀查核（實作前已逐字讀取）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一需改動的元件檔，`"use client"`，已有 `hoveredIndex` state）：
  - 版面：外層 `<div>` 內依序為 `<svg viewBox="0 0 480 160" width="100%" height={160} className="mb-3">`、（序列數 > 4 時）圖例 `<ul>`、`<table className="w-full border-collapse text-sm">`。**圖表與表格已經是同一個 `<div>` 的同層子節點**，不需要重組 DOM 層級。
  - 表格：第一欄「版本」，其後 7 個日期欄（`dates` 為 `fixedSevenDates(anchorDate)`，D-6 到 D），`<th className="py-2 pr-3">`，自動表格版面（auto layout），欄寬由內容決定。
  - `xFor(dateIndex)` 現為 `CHART_PADDING + dateIndex / (dates.length - 1) * innerWidth`（0..6 均分在 24..456），與表格欄位位置毫無關聯，這就是本票要解決的錯位。
  - `<g data-axis="x">`（SDLCCT-78）在 `y = CHART_HEIGHT - 6` 畫頭／中／尾 3 個日期文字；本票要刪除。
  - 使用 `xFor` 的地方共 6 處：折線座標 `toXY`、終點標籤（`tailPoint.x`）、`plotMidX`、hover hit-test（`handleMouseMove`）、十字線、tooltip 定位。全部改為從同一份新的 X 座標來源取值（見決策 2）。
  - `viewBox` 固定為 480×160，`<svg width="100%">`：實際寬度大於 480 時，預設 `preserveAspectRatio` 會把內容等比例縮放並水平置中（letterbox），因此即使公式正確也無法與表格欄位對齊；這是必須改為「viewBox 寬度 = 實際渲染像素寬度」的另一個原因（決策 3）。
- `frontend/components/agent-detail/agent-detail-content.tsx`：`VersionCostChart` 只被此處使用，包在 `<section>` 內，沒有對圖表容器施加固定寬度，容器寬度由頁面版面決定。props 介面不變。
- 單元測試 `frontend/components/agent-detail/version-cost-chart.test.tsx` 中硬編碼舊 X 座標或依賴 X 軸文字者（本票需更新，見「測試策略」）：
  - SDLCCT-78 區塊：「圖表底部顯示日期刻度」、測試者補充的「X 軸標籤文字與表格對應欄位日期逐字相同」、兩個「X 軸日期標籤列為固定渲染」共 4 個測試——斷言 `data-axis="x"` 存在，與情境 3 直接衝突，改寫為斷言「不存在」。
  - SDLCCT-78 格線測試：斷言 `x1 === 24`、`x2 === 456`——格線水平範圍改為由新版面決定。
  - SDLCCT-79 邊界測試：`expectedX = CHART_PADDING + 3/6*innerWidth`（240）與 `plotMidX` 邊界、`CHART_PADDING + innerWidth` 之 `not.toBeCloseTo`——改以新 X 座標來源重算。
  - SDLCCT-80 區塊（含測試者補充）：`xFor(4) = 312`、`xForIndex()` 輔助函式、`plotMidX = 240`、`mockOverlayRectWidth` 以 `svg.getBoundingClientRect` 回傳寬 480——改以新 X 座標來源重算。
- E2E `frontend/e2e/agent-detail.spec.ts`：
  - 第 986-992 行（SDLCCT-80 hover 測試）以 `312 / 480 * box.width` 推算 D-2 的 X——必須改為取 D-2 的 `th[data-date-col]` 欄中心。
  - 第 402-418、459-464、497 行的 `data-axis="y"` 選擇器不受影響（Y 軸群組保留）。
  - 第 722 行起的 390px 行動版「無水平溢出」測試：本設計不改變表格版面模式（決策 4），不受影響。
  - 全檔案 `Grep("toEqual|一致|getComputedStyle|boundingBox")`：只有第 197 行（`<th>` 文字陣列）、254／300 行（`<polyline>` 座標數量 `[1,5]`）、989 行（SDLCCT-80 hover）與 `trace-detail.spec.ts:95,97`（另一元件的 `paddingLeft` 一致性）。**沒有任何測試比較 `VersionCostChart` 內選擇器與其他元件的 computed style 是否相等**，跨元素樣式耦合檢查不適用；折線座標數量斷言（`[1,5]`）因斷線邏輯不變而不受影響。
- `docs/design-system.md` 現有 §11.1「X 軸標籤密度規則」、§11.3「Tooltip 內容格式規則」中「與 X 軸標籤同一日期格式」；`docs/design/SDLCCT-80.md` 同樣有「與 X 軸標籤同一日期格式」與十字線 y 範圍「避開 X 軸標籤文字」的描述。

## 介面/API 契約

無對外介面變更（無 bff 端點、無 request／response 異動）。純前端渲染層。

元件對外 props 不變：

```ts
VersionCostChart({ entries: VersionCostSeriesEntry[]; anchorDate: string })
```

新增的唯一對外可觀察合約（供測試與日後維護）為 DOM 屬性：`<th>` 日期欄加上 `data-date-col="YYYY-MM-DD"`（第一欄「版本」不加）。圖表 `<svg>` 不再含 `<g data-axis="x">`。其餘 DOM 結構、`role`、`aria-label`、`data-axis="y"`、`data-labels="tail"`、`data-tooltip="active"` 皆不變。

## 資料模型

無新增資料模型。唯一新增的是元件內部的版面量測狀態（非資料模型，不經 props 進出）：

```ts
type ChartLayout = {
  width: number;        // <svg> 實際渲染像素寬度，同時作為 viewBox 寬度（1 user unit = 1 CSS px）
  plotLeft: number;     // 「版本」欄右緣相對 svg 左緣的 X；格線與 hover overlay 的左界
  centers: number[];    // 長度 = dates.length（7），每個日期欄中心相對 svg 左緣的 X
};
const [layout, setLayout] = React.useState<ChartLayout>(fallbackLayout(dates.length));
```

`fallbackLayout(n)`：未量測（首次 render、jsdom、任何欄寬為 0）時使用的決定性預設值。`width = 480`、`plotLeft = 72`、日期區均分：`centers[i] = 72 + (i + 0.5) * (480 - 72) / n`（n = 7 時 `centers[3] = 276`，恰為日期區中點）。常數命名 `FALLBACK_WIDTH = 480`、`FALLBACK_LABEL_COL = 72`。

## 關鍵技術決策

### 1. 機制：量測真實 `<th>` 欄中心（`getBoundingClientRect` + `ResizeObserver`），不用 CSS Grid 重做表格、不用寫死欄寬公式

- 比較過的方案：
  - **(A) 把表格改成 CSS Grid 並讓 SVG 共用同一組 grid template**：需放棄語意化 `<table>`／`<th>`（Gherkin 情境 3、6 與既有測試都以 `thead th`、`tbody tr`、`td` 為準，也是無障礙備援），並重寫全部表格樣式；風險最大。
  - **(B) `table-layout: fixed` + 百分比 `<colgroup>`，SVG 以同一組百分比換算 X**：欄寬雖確定，但仍須知道容器像素寬度才能把座標畫進 viewBox，等於還是要量測；且固定欄寬在 390px 行動版會讓「US$ 1,234」溢出相鄰欄（既有行動版 e2e 目前依賴自動版面伸縮）。
  - **(C) 採用：量測。** 對齊的真實依據就是瀏覽器實際排出的 `<th>` 位置，因此不論字型載入、內容長短、padding、瀏覽器版本造成欄寬如何，只要量測當下表格是什麼樣子，資料點就對得準；誤差來源只剩 `toFixed(1)` 取整（≤ 0.05px），遠小於 1px 門檻。不改表格 DOM 與樣式，回歸面最小。
- 量測函式（元件內，`useLayoutEffect` 呼叫）：
  ```ts
  // 以 svgRef 與 tableRef 取得；回傳 null 代表「不可量測」，維持目前 layout 不變。
  function measureLayout(svg: SVGSVGElement, table: HTMLTableElement): ChartLayout | null {
    const s = svg.getBoundingClientRect();
    const ths = Array.from(table.querySelectorAll<HTMLElement>("thead th[data-date-col]"));
    const first = table.querySelector<HTMLElement>("thead th:first-child");
    if (s.width <= 0 || !first || ths.length === 0) return null;
    const rects = ths.map((th) => th.getBoundingClientRect());
    if (rects.some((r) => r.width <= 0)) return null;
    return {
      width: s.width,
      plotLeft: first.getBoundingClientRect().right - s.left,
      centers: rects.map((r) => r.left + r.width / 2 - s.left),
    };
  }
  ```
  `s.left` 作為原點，所以只要 svg 與 table 同在一個容器內（現狀即是）就不需要額外的容器偏移換算；欄「中心」指 `<th>` 邊框盒（含 padding）的幾何中心，與 e2e 以 `locator.boundingBox()` 取中心的定義一致。
- 重新量測時機：
  - `useLayoutEffect`（deps：`entries`、`anchorDate`，因內容改變會改欄寬）：首次 paint 前量測，避免閃爍錯位。
  - `ResizeObserver` 同時 `observe` 外層容器 `<div>` 與 `<table>`：容器寬度改變（情境 2）、字型載入或內容改變造成表格自身尺寸變化時都會觸發。回呼內重新呼叫 `measureLayout`，並以「`width`、`plotLeft` 與每個 `centers[i]` 與現值差皆 < 0.01px 則不 `setLayout`」避免無謂重繪與回授迴圈（SVG 內容變動不改變 svg／table 外框尺寸，故不會自我觸發）。
  - 元件卸載時 `disconnect()`。
  - 不使用 `window.resize` 事件：容器寬度可因父層版面變化而非視窗縮放改變，`ResizeObserver` 才是直接的訊號。
- 本元件僅在資料載入成功後由 client 端渲染（`agent-detail-content.tsx` 於 `state.status === "success"` 時才掛載），沒有 SSR 渲染，直接使用 `useLayoutEffect` 不會有 SSR 警告。

### 2. 單一 X 座標來源：`xFor(i) = layout.centers[i]`，所有使用處共用

- `xFor` 改為讀 `layout.centers`，折線、終點標籤、hover hit-test、十字線、tooltip 定位自動一起改變，沒有第二套公式，也就沒有「圖表上某元件與資料點錯位」的可能（情境 4）。
- 刪除 `innerWidth` 與 `CHART_PADDING` 的水平用途。`CHART_PADDING`（24）保留給 Y 方向（`yFor`、十字線上緣、tooltip 上緣），**Y 方向幾何完全不動**（`CHART_HEIGHT = 160`、`yFor` 公式與 max／min 計算不變，遵守 SDLCCT-73 範圍外）。
- `plotMidX` 改為 `(layout.plotLeft + layout.width) / 2`，僅用於終點標籤與 tooltip 的左右延伸判斷（`x >= plotMidX` 規則不變）。
- 格線：`x1 = layout.plotLeft`、`x2 = layout.width`（原為 24／456）。Y 軸金額標示仍為 `x = 2`、`textAnchor="start"`，落在「版本」欄寬範圍內（該欄寬通常 ≥ 40px，足以容納「US$ 1,234」），不與資料點重疊。
- hover overlay `<rect>`：`x = layout.plotLeft`、`width = layout.width - layout.plotLeft`；`handleMouseMove` 的像素到 viewBox 換算保留 `scaleX = layout.width / rect.width`（量測成功時恆為 1，fallback 時隨 jsdom 測試的 mock 寬度）；最近鄰比對邏輯與嚴格 `<` 比較（等距取較小索引）不變。
- 十字線：x 仍為 `xFor(hoveredIndex)`；`y2` 由 `CHART_HEIGHT - CHART_PADDING - 10` 改為 `CHART_HEIGHT - CHART_PADDING`（原本多留的 10px 是為了避開已刪除的 X 軸文字，SDLCCT-80 決策 3；spec 明示可調整）。

### 3. `viewBox` 寬度 = 實際像素寬度，消除 letterbox 縮放

- `viewBox={`0 0 ${layout.width} ${CHART_HEIGHT}`}`，`<svg width="100%" height={160}>` 不變。量測成功時 user unit 與 CSS px 1:1，折線的 X 與表格欄中心在螢幕上直接重合，不再有等比例縮放造成的水平置中偏移。
- `<svg>` 加 `style={{ overflow: "visible" }}`：極端窄寬下若表格被內容撐寬超出容器，超出的資料點與標籤仍可見而不被裁切（資料點仍與欄中心對齊）。

### 4. 不改表格版面模式（維持 `auto`），僅在日期 `<th>` 加 `data-date-col`

- 理由：行動版 390px e2e（無水平溢出）依賴現行自動版面；量測方案不需要等寬欄，因此不必為了對齊而改版面。副作用是各日期欄寬可能略不相等（取決於內容），資料點間距因而不嚴格等距——這是規格「對齊欄中心」的直接結果，不是缺陷。
- `data-date-col` 同時供量測（選擇器）、單元測試與 e2e 使用，不依賴欄位順序或文字內容。

### 5. 移除 X 軸文字後，日期只由表格標題列與 tooltip 第一行承載

- 刪除 `xAxisLabelIndices`、`xAxisLabels` 與整個 `<g data-axis="x">`。tooltip 第一行仍用 `formatTaiwanDate(dates[hoveredIndex])`（與表格標題列同一格式，SDLCCT-80 內容規則不變）。
- 圖表底部在移除 X 軸文字後留有原 `CHART_PADDING` 的底部空白，與表格標題列之間的視覺距離由 `mb-3`（12px）加底部 padding 構成，本票不調整（避免連動 Y 軸幾何），視覺上表格標題列即為 X 軸。

### 6. 測試可注入性（jsdom 無版面）

- jsdom 的 `getBoundingClientRect()` 恆回傳全 0，`measureLayout` 因 `width <= 0` 回傳 `null`，元件使用 `fallbackLayout`，所有既有互動測試仍可決定性地計算預期 X（`centers[i] = 72 + (i + 0.5) * 408 / 7`）。
- 要測「量測路徑」時，單元測試以兩種方式注入寬度：
  1. 抽出並 `export` 純函式 `computeLayout(svgRect, firstThRect, thRects): ChartLayout | null`（`measureLayout` 內不碰 DOM 的部分），直接餵入手寫的 rect 物件測試公式與 `null` 判斷，不需要任何 DOM mock。
  2. 元件整合測試：用 `vi.spyOn(Element.prototype, "getBoundingClientRect")` 依 `this`（`svg`、`th[data-date-col]`）回傳指定矩形，並以 stub `globalThis.ResizeObserver`（記錄 callback 與 `observe` 目標）模擬「容器 1280 → 768」：先以第一組矩形 render，再改變 spy 回傳值並手動呼叫已記錄的 callback（以 `act` 包住），斷言各 `<polyline>` 點 X、十字線 X、終點標籤 X 等於新的 `centers[i]`。
- 真實像素精度（≤ 1px）只由 Playwright e2e 驗證（jsdom 做不到），見測試策略。

## 測試策略（供 developer／tester 對照，非新增需求）

**單元（vitest + jsdom，`version-cost-chart.test.tsx`）**
- 新增：`computeLayout` 公式與不可量測（寬度 ≤ 0）回傳 `null`；整合測試以 mock 矩形驗證折線點 X = 注入的欄中心（含 `toFixed(1)` 容差）、改變 mock 並觸發 ResizeObserver callback 後重新對齊；`data-axis="x"` 不存在（情境 3，取代 SDLCCT-78 的 4 個測試）；日期文字僅在 `thead th` 與 hover tooltip 第一行；`<th data-date-col>` 共 7 個且值為 `fixedSevenDates` 結果；null 斷線與表格「—」不回歸（既有 SDLCCT-72 測試維持）；`role="img"`／`aria-label`／Y 軸標示／格線／序列數 ≤ 4 門檻不回歸。
- 更新：「現狀查核」所列依賴舊 X 座標（24..456 均分、240、312）的斷言，改以 fallback 公式或注入的 centers 計算。
- 十字線 `y2` 改為 136 的斷言（若有）同步更新。

**E2E（Playwright，一律以 `CI=1 npx playwright test --workers=1` 執行；`frontend/e2e/agent-detail.spec.ts` 新增）**
- 以 `page.route` 模擬 cost-breakdown（≥ 2 個版本、含至少一個 null），`page.setViewportSize({ width: 1280, height: 800 })`。
- 取每個日期欄 `th[data-date-col]` 的 `boundingBox()` 中心 X；取 `svg[role='img']` 的 `boundingBox().x` 為原點；在頁面內 `evaluate` 解析所有 `<polyline>` 的 `points` 屬性 X 座標並加上 svg 左緣，逐一與同日期欄中心比較，`Math.abs(diff) <= 1`（情境 1）。因版面量測透過 `ResizeObserver`，斷言用 `expect.poll`／`toPass` 等待收斂。
- `page.setViewportSize({ width: 768, height: 800 })` 後重複同一比較（情境 2）。
- `svg.locator('g[data-axis="x"]')` count 為 0；頁面 `svg text` 不含任何日期字串（情境 3）。
- hover 某日期欄中心：十字線 `line[stroke-dasharray]` 的 `x1` + svg 左緣與該欄中心差 ≤ 1px；tooltip 列出全部版本（情境 4）。
- 更新 SDLCCT-80 既有 hover 測試的目標 X（第 986-992 行）為 D-2 欄中心。
- 缺值不回歸沿用第 254／300 行既有斷言（情境 5）。

## 設計系統文件異動（本票同一個 PR 內一併交付，由 developer 實作）

本設計階段不編輯下列檔案，列為實作任務（append／就地改寫該段，不可刪減其他內容）：

1. `docs/design-system.md` §11.1「X 軸標籤密度規則」整段改寫為「圖表不繪製 X 軸日期文字，以表格標題列為 X 軸、資料點 X 座標對齊對應日期欄的中心」，並可補一句機制規則：對齊以量測實際 `<th>` 欄中心為準，容器尺寸改變時重新量測；§11.1 標題「圖表軸線與格線」可視需要微調為仍涵蓋「軸線」語意。
2. `docs/design-system.md` §11.3「Tooltip 內容格式規則」中「與 X 軸標籤同一日期格式」改為「與表格標題列同一日期格式」。
3. `docs/design/SDLCCT-80.md` 中所有「與 X 軸標籤同一日期格式」改為「與表格標題列同一日期格式」（含「設計系統文件異動」段的對應敘述）；決策 3 十字線 y 範圍「避開 X 軸標籤文字」的說明加註「SDLCCT-88 起 X 軸文字已移除，`y2` 改為 `CHART_HEIGHT - CHART_PADDING`」。
4. 元件檔頂部註解補一行指向本設計文件（機制：量測表格欄中心）。

## UI 原型

`docs/design/SDLCCT-88-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，無需安裝任何套件；沿用 SDLCCT-80 原型的色彩與字級 token）。原型內嵌的小段 JavaScript 就是本設計機制的縮小版（`getBoundingClientRect` 量測 `th[data-date-col]` 欄中心 + `ResizeObserver`），因此可實際看到並驗證：

- 情境 1、2：圖表資料點對齊下方表格各日期欄中心；以按鈕或滑桿切換容器寬度（約 1280／768／窄版），資料點隨之重新對齊；頁面顯示「最大偏差」讀數，由瀏覽器即時量測圓點中心與表頭欄中心之差（驗收門檻 ≤ 1px）。可勾選「顯示欄中心輔助線」直觀看出對齊。
- 情境 3：圖表內無任何 X 軸日期文字，日期只在表格標題列與 hover tooltip 第一行。
- 情境 4：游標移動時十字線落在該欄中心；tooltip 列出全部版本金額；終點標籤跟隨最後一個有值點；可勾選「保持 hover 在 D-2」固定顯示。
- 情境 5：v1 在 2026年10月16日、v2 在 2026年10月19日為 null，折線斷開，表格顯示「—」。
- 情境 6：`role="img"`、`aria-label`、Y 軸金額標示與水平格線、表格皆保留；序列數 2（≤ 4）使用終點標籤。

原型中的資料點小圓點、欄中心輔助線、寬度控制元件與偏差讀數僅供示範與驗證，實作中不存在（實作只畫折線，不畫圓點與輔助線）。

## 開放設計問題（定稿時必須為空）

（無）
