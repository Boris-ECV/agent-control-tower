# 設計文件 — SDLCCT-80 版本成本圖表 Hover Tooltip／十字線與可存取性備援

## 對應需求規格

對應 G1 已核准的需求規格「版本成本圖表 — Hover Tooltip／十字線與可存
取性備援」（SDLCCT-77 拆分出的第三張、最後一張子票）。2 條 Gherkin
情境（已定稿）：

1. 游標移動到圖表 X 軸上對應某日期（例：D-2）的位置、觸發 hover 時，
   顯示一個 tooltip，列出該天每個 version 的金額（null 顯示「—」）。
2. 使用者無法觸發 hover（例如鍵盤操作／螢幕閱讀器）時，圖表下方表格
   仍完整呈現所有日期與版本的數值，不依賴圖表互動。

**範圍外**（spec 已標明）：不處理 X 軸刻度／格線（SDLCCT-78，已
Done）；不處理線條終點直接標籤（SDLCCT-79，已 Done）；不處理
SDLCCT-76 的資料正確性（本票純前端視覺層，不假設它一定先完成）；不
引入圖表函式庫；不改變 Y 軸自動縮放邏輯。

**依賴**：無阻斷性依賴。與 SDLCCT-78、SDLCCT-79 同一檔案
（`frontend/components/agent-detail/version-cost-chart.tsx`）及同一文
件章節（`docs/design-system.md` 第 11 節），功能上不依賴前兩者的結果
（tooltip／十字線是獨立的 overlay 層），但沿用兩者已抽出的 `xFor`/
`yFor`/`byDate` 等既有函式與座標系統。

## 現狀查核（實作前已逐字讀取的既有程式碼，含 SDLCCT-78/79 已合併的變更）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一
  要改動的元件檔案，目前 289 行，`"use client"`，目前無任何
  `useState`／事件處理，是純函式元件）：
  - `CHART_WIDTH=480`、`CHART_HEIGHT=160`、`CHART_PADDING=24`，
    `innerWidth=432`、`innerHeight=112`。
  - `xFor(dateIndex)`／`yFor(value)`（SDLCCT-78/73 已抽出）：給定
    `dateIndex`（0-6）或 `value`，回傳 SVG 座標。本票需要「反向」運
    算：給定游標的 SVG-space x 座標，找出最接近的 `dateIndex`（見決
    策 1）。
  - `byDate(entry)`（既有函式）：把 `entry.points` 轉成與固定 7 天
    `dates` 陣列長度相同、依日期對齊的 `(number | null)[]`，折線渲
    染、表格渲染、SDLCCT-79 終點標籤皆已重用同一函式。
  - `entries`：`VersionCostSeriesEntry[]`，即 `{ version: string,
    points: { date: string, value: number | null }[] }[]`，不限數
    量（SDLCCT-79 的 `showTailLabels = entries.length <= 4` 門檻只影
    響終點標籤/圖例二選一，與本票的 tooltip 內容無關——tooltip 必須
    列出 `entries` 全部成員，不受該門檻限制，spec 原文「tooltip 只需
    列出 entries 陣列裡實際有的 version」已明文排除沿用該門檻）。
  - `<svg>` 子元素目前渲染順序（SDLCCT-78/79 之後）：格線 `<g>` → 各
    版本 `<polyline>` → `<g data-axis="y">` → `<g data-axis="x">` →
    `{showTailLabels && <g data-labels="tail">...}`。本票新增的
    hit-test overlay／十字線／tooltip 插入在這個既有順序的最後（見決
    策 2-4），確保視覺堆疊順序上位於最上層，不被任何既有元素蓋住。
  - `<table>`（第 257-285 行）：獨立於 `<svg>` 之外的同層 sibling DOM
    元素，逐列渲染 `entries` 與 `byDate(entry)` 對齊後的全部 7 天數
    值，`formatCurrency(value)` 處理 null。這個表格與 `<svg>` 内部
    結構完全無交集（不是 nested 在 SVG 裡面），本票新增的 SVG overlay
    純粹是 `<svg>` 內部新增的 `<g>`/`<rect>` 元素，不觸碰、不包裹
    `<table>` 的任何 DOM 節點或 class，**表格的可存取性與獨立可用性
    不需要任何改動即滿足情境二**（見決策 5 明確確認）。
- `frontend/lib/format.ts::formatCurrency(value: number | null |
  undefined): string`：`null`/`undefined` → `"—"`；非 0 整數 → 千分位
  `US$ 1,234`；絕對值 < 100 且非 0 → 兩位小數。本票的 tooltip 內容直
  接重用這個函式，`null` 情境已經回傳 `"—"`，不需要額外的 null 分
  支（spec 情境一「null 顯示『—』」字面要求已由既有函式滿足）。
- `docs/design-system.md` §11「資料視覺化」目前有 11.1「圖表軸線與格
  線」（SDLCCT-78）、11.2「直接標籤」（SDLCCT-79），尚無「互動
  （hover/tooltip）」子項（本票要新增的 11.3）。
- `frontend/e2e/agent-detail.spec.ts`：
  - 第 197 行 `expect(dateHeaders.slice(1)).toEqual([...])`：比較的是
    `<table>` 的 `<th>` 文字陣列與一個固定的日期字串陣列，不是跨兩個
    元件的 computed style 相等測試，且本票不改動 `<th>` 內容，不受影
    響。
  - 第 254、300 行 `expect(pointCounts.sort()).toEqual([1, 5])`：比較
    的是 `<polyline>` 的 `points` 屬性切出的座標數量，與本票新增的
    hit-test overlay／十字線／tooltip（新增的 `<rect>`/`<line>`/
    `<text>`/`<g>` 元素，不改動任何 `<polyline>`）無關，不受影響。
  - 全檔案 Grep 無其他 `toEqual`/`一致`/`getComputedStyle` 命中。
- 全 repo `Grep("toEqual|一致|getComputedStyle", frontend/e2e/)`：另外
  命中 `frontend/e2e/trace-detail.spec.ts:95,97`（`<tr>` 子列
  `paddingLeft` 與另一列的既有縮排一致性測試），與 `VersionCostChart`
  或其子選擇器完全無關的獨立元件。**沒有任何測試比較
  `VersionCostChart` 內的任何選擇器（含本票新增的 hit-test overlay／
  十字線／tooltip）與其他元件的 computed style 相等**，跨元素樣式耦
  合測試檢查不適用於本票。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點，純前端渲染層與互動層改動，消費的
資料形狀（`VersionCostSeriesEntry[]`、`anchorDate`）與既有完全相同。

## 資料模型

無新增資料模型。Tooltip 要顯示的版本名稱與金額，直接取自既有
`entries[].version` 與既有 `byDate(entry)` 算出的 `values` 陣列（重
用現狀，不新增 props）。唯一新增的狀態是元件內部的 React
`useState`（見下方「元件內部狀態」），不是資料模型，不經由 props 傳
入/傳出，元件外部完全無法觀察到這個狀態的存在。

### 元件內部狀態（非資料模型，記錄於此供 developer 對照）

```ts
const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
```

- `null`：目前無 hover（初始狀態、或游標移出繪圖區）。
- `0..dates.length-1`（即 `0..6`）：目前 hover 對應的 `dateIndex`。

## 關鍵技術決策

### 1. Hit-testing：單一全高透明 `<rect>` overlay + `onMouseMove`/`onMouseLeave`，以 SVG-space x 座標反向最近鄰比對 `dateIndex`

```tsx
const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  // viewBox 寬度 CHART_WIDTH 與實際渲染寬度 rect.width 的比例換算，
  // 因為 <svg> 用 width="100%" 由 CSS 決定實際像素寬度，viewBox 座標
  // 系統與螢幕像素系統不是 1:1。
  const scaleX = CHART_WIDTH / rect.width;
  const svgX = (event.clientX - rect.left) * scaleX;
  // 反向 xFor：找出與 svgX 距離最近的 dateIndex（0..dates.length-1）。
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < dates.length; i++) {
    const dist = Math.abs(xFor(i) - svgX);
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  setHoveredIndex(closest);
};

const handleMouseLeave = () => setHoveredIndex(null);
```

```tsx
<rect
  x={CHART_PADDING}
  y={0}
  width={innerWidth}
  height={CHART_HEIGHT}
  fill="transparent"
  onMouseMove={handleMouseMove}
  onMouseLeave={handleMouseLeave}
/>
```

- 用單一全高 `<rect>` 覆蓋整個繪圖區水平範圍（`x=24` 到 `x=456`），
  而不是 7 個分段的 hover zone：理由是座標換算（反向 `xFor`）本身已
  經是 O(7) 的最近鄰比對，單一 `<rect>` + 計算比切成 7 個獨立
  `<rect>`（各自有自己的 `x`/`width` 分界點計算）更不容易出錯，也更
  符合「手刻 SVG、不過度工程化」的既有慣例（SDLCCT-48 決策 3、本檔案
  開頭註解）。
- `fill="transparent"`（非 `none`）：SVG 的 `pointer-events` 預設對
  `fill="none"` 的圖形不觸發滑鼠事件，必須有實際（即使透明）的填色
  才能接收 `onMouseMove`——這是 SVG 事件模型的既知限制，不是本票自訂
  規則。
- `scaleX = CHART_WIDTH / rect.width`：`<svg>` 用 `viewBox="0 0 480
  160"` + `width="100%"`，瀏覽器會把 `clientX` 相對座標依實際渲染寬
  度與 viewBox 寬度的比例縮放；本元件所有既有座標計算（`xFor`/
  `yFor`）都是 viewBox 座標系統（0-480 / 0-160），hit-test 必須先把
  螢幕像素座標換算回 viewBox 座標系統，否則在非 480px 實際寬度的畫面
  （RWD 縮放後幾乎必然發生）下會算錯 `dateIndex`。
- overlay `<rect>` 插入在既有 `<svg>` 內容最後（所有 `<polyline>`、
  軸線標籤、終點標籤之後）：保證 overlay 在視覺/事件堆疊順序上位於最
  上層，不被其他元素遮擋導致滑鼠事件被攔截；因為 `fill="transparent"`
  不會遮住底下的折線/標籤視覺。
- React 事件（`onMouseMove`/`onMouseLeave`，合成事件）而非原生
  `addEventListener`：與既有元件風格一致（整個 repo 前端皆為
  React/Next.js 元件，無任何手動 DOM API 操作先例），且不需要額外的
  `useEffect`/cleanup 生命週期管理。
- 元件需改為使用 `React.useState`：本檔案第一行已是 `"use client"`
  （SDLCCT-72 既有），可直接加 `import * as React from "react"`（或
  `import { useState } from "react"`）取用 hook，不需要額外的 client
  component 宣告。

### 2. Tooltip DOM 結構：SVG-native（`<g>` + 背景 `<rect>` + 每行一個 `<text>`），定位在 hover 對應的 `xFor(hoveredIndex)` 附近，而非 HTML `<div>` 絕對定位

```tsx
{hoveredIndex !== null && (
  <g data-tooltip="active">
    <rect
      x={tooltipX}
      y={tooltipY}
      width={tooltipWidth}
      height={tooltipHeight}
      fill="var(--color-bg)"
      stroke="var(--color-border)"
      rx={4}
    />
    <text x={tooltipX + 8} y={tooltipY + 14} fontSize={10} fill="var(--color-text-primary)" fontWeight={600}>
      {formatTaiwanDate(dates[hoveredIndex])}
    </text>
    {entries.map((entry, i) => (
      <text
        key={entry.version}
        x={tooltipX + 8}
        y={tooltipY + 14 + (i + 1) * 14}
        fontSize={10}
        fill={COLORS[i % COLORS.length]}
      >
        {`${entry.version}: ${formatCurrency(byDate(entry)[hoveredIndex])}`}
      </text>
    ))}
  </g>
)}
```

- 決策：**採用 SVG-native 結構**（`<g>`/`<rect>`/`<text>`），不用 HTML
  `<div>` 絕對定位覆蓋 SVG。理由：(1) 本元件自第一行註解起就明文「手
  刻 inline SVG...不引入圖表函式庫」的既有慣例（SDLCCT-48 決策 3 延
  伸），HTML overlay 需要額外處理 `<svg>` 與其 HTML 父層之間的座標系
  統轉換（viewBox 座標 → CSS 像素 → `position: absolute` 的
  top/left），比 SVG-native 多一層換算與一層容易出錯的 RWD 縮放同步
  問題；(2) SVG-native tooltip 的座標系統與既有 `xFor`/`yFor`、十字
  線、終點標籤完全共用同一套 viewBox 座標，不需要額外的
  `getBoundingClientRect` 換算（決策 1 的 `scaleX` 換算只在 hit-test
  的「螢幕座標 → viewBox 座標」方向需要一次，tooltip 渲染是「viewBox
  座標 → viewBox 座標」，不需要再換算）；(3) `role="img"` 的 `<svg>`
  本身已經是不透過子元素逐一讀出的無障礙呈現單位（見決策 5），tooltip
  是純視覺加強，HTML `<div>` 不會改善無障礙語意，不足以抵銷額外複雜
  度。
- 定位：`tooltipX`/`tooltipY` 以 `xFor(hoveredIndex)` 為錨點，向左或
  向右偏移（與 SDLCCT-79 終點標籤同一套「依左半/右半決定延伸方向、
  避免 viewBox 邊緣裁切」原則，重用 `plotMidX` 判斷）；垂直固定在
  `CHART_PADDING` 附近（繪圖區上緣），不跟隨 `yFor(value)`，因為單一
  tooltip 要同時列出該 dateIndex 下**所有** version 的數值（可能分布
  在繪圖區不同高度），固定在上緣最單純、不需要為每個 version 分別計
  算避讓。
  ```ts
  const tooltipWidth = 140;
  const tooltipHeight = 14 + (entries.length + 1) * 14 + 6;
  const tooltipAnchorRight = xFor(hoveredIndex) >= plotMidX;
  const tooltipX = tooltipAnchorRight
    ? xFor(hoveredIndex) - tooltipWidth - 8
    : xFor(hoveredIndex) + 8;
  const tooltipY = CHART_PADDING;
  ```
- 內容逐行：第一行日期標題（`formatTaiwanDate(dates[hoveredIndex])`，
  重用既有函式，與表格標題列、表格欄位同一日期格式），接著每個
  `entries` 成員各一行「版本名稱: 金額」，文字顏色採該版本的色票色
  （與 SDLCCT-79 終點標籤同一慣例，延續「顏色 ↔ 版本」視覺對應）。
- **列出 `entries` 全部成員，不套用 SDLCCT-79 的 `showTailLabels`（≤4）
  門檻**：spec 原文明確要求「tooltip 只需列出 entries 陣列裡實際有
  的 version，不管是真實版本還是 SDLCCT-76 補上的『其他／未標記版
  本』entry，兩者在渲染層完全等同對待」——tooltip 是獨立於終點標籤/
  圖例二選一的另一種互動呈現，兩者門檻不共用，本票不自行引入新門檻。

### 3. 十字線：垂直 `<line>`，x 固定在 `xFor(hoveredIndex)`，y 範圍 `CHART_PADDING` 到 `CHART_HEIGHT - CHART_PADDING - 10`（避開 X 軸標籤文字基線）

```tsx
{hoveredIndex !== null && (
  <line
    x1={xFor(hoveredIndex)}
    x2={xFor(hoveredIndex)}
    y1={CHART_PADDING}
    y2={CHART_HEIGHT - CHART_PADDING - 10}
    stroke="var(--color-text-secondary)"
    strokeWidth={1}
    strokeDasharray="2,2"
  />
)}
```

- 【SDLCCT-88 更新】X 軸文字已移除，`y2` 改為 `CHART_HEIGHT - CHART_PADDING`
  （= `136`）；以下為 SDLCCT-80 當時為避開 X 軸標籤文字的歷史說明。
- 下邊界取 `CHART_HEIGHT - CHART_PADDING - 10`（= `160 - 24 - 10 =
  126`）而非 `CHART_HEIGHT - CHART_PADDING`（= `136`）：X 軸標籤文字
  渲染在 `y = CHART_HEIGHT - 6 = 154`，字高約 10px，文字視覺範圍約落
  在 `144-154`；十字線延伸到 `136` 已經在標籤文字上方留出足夠間距
  （見 spec 技術備註「不應與 X 軸標籤重疊」），`126` 再多留 10px 餘
  裕，確保在任何瀏覽器字體渲染差異下都不會視覺重疊，數值本身無特殊
  意義，純粹是「夠安全」的保守留白。
- `strokeDasharray="2,2"`（虛線）＋ `--color-text-secondary`（既有次
  要文字色 token，不新增色票）：與資料折線（`COLORS` 分類色票、實
  線）在視覺上明顯區隔，避免使用者誤認十字線為一條資料序列——與
  11.1 格線規則「格線是座標參考線，不是資料序列，不可讓使用者誤認格
  線為某條資料線」同一精神的延伸，十字線本質上也是參考線而非資料。
- 插入順序：十字線插在 overlay `<rect>`（決策 1）之後、tooltip
  `<g>`（決策 2）之前，三者皆在既有 SVG 內容最後，確保視覺堆疊順序
  正確（overlay 無視覺、十字線在資料線之上、tooltip 在最上層蓋住十
  字線上緣的交會處）。

### 4. Null 處理：tooltip 每行金額直接傳 `byDate(entry)[hoveredIndex]` 進既有 `formatCurrency`，不另寫 null 分支

- `formatCurrency(null)` 已回傳 `"—"`（見「現狀查核」），表格、Y 軸
  標示、SDLCCT-79 終點標籤皆已是這個慣例；tooltip 照搬同一呼叫方式
  （`formatCurrency(byDate(entry)[hoveredIndex])`），不新增判斷分
  支，維持整個元件「null 顯示規則只在 `formatCurrency` 一處維護」的
  單一真實來源，滿足 spec 情境一「null 顯示『—』」字面要求。

### 5. 可存取性：hit-test overlay／十字線／tooltip 完全是 `<svg>` 內部新增節點，`<table>` 是同層 sibling，零改動、零影響

- 「現狀查核」已確認 `<table>` 不是 `<svg>` 的子節點，是 `<div>` 包
  裹下的獨立 sibling 元素；本票新增的所有節點（hit-test `<rect>`、
  十字線 `<line>`、tooltip `<g>`）都限定在 `<svg>` 內部，不修改
  `<table>` 的任何標籤、屬性、className 或渲染邏輯——情境二「圖表下
  方表格仍完整呈現所有日期與版本的數值，不依賴圖表互動」在**不需要
  任何程式碼變更**的前提下自動成立，因為表格渲染路徑（`entries.map`
  → `byDate(entry)` → `formatCurrency`）與本票新增的 hover 狀態機完
  全獨立，彼此不共用任何條件分支。
- `<svg role="img" aria-label="...">`（既有屬性，SDLCCT-72）維持不
  變：整個圖表對螢幕閱讀器而言仍是單一不可逐節點讀取的影像，hover
  tooltip 的內容不會、也不需要透過 ARIA 暴露給螢幕閱讀器——這正是
  spec 把表格定位為「可存取性備援」而非「讓 tooltip 本身可存取」的
  字面安排，本票不額外加 `aria-live` 或 `role="tooltip"` 等屬性，避
  免無法被鍵盤操作觸發的視覺 tooltip 被誤判為可存取的互動元件（若加
  了 ARIA role 卻無法鍵盤觸發，反而可能讓輔助技術誤判該元件支援鍵盤
  互動，造成比完全不標註更差的使用者體驗）。
- 鍵盤操作者：overlay `<rect>` 不設 `tabIndex`、不綁定
  `onFocus`/`onKeyDown`，`<svg>` 本身維持不可鍵盤 focus（`role="img"`
  語意上就是非互動影像）——spec 情境二字面要求是「無法觸發 hover 時
  表格仍完整呈現」，不是要求「讓 tooltip 本身也支援鍵盤觸發」，本票
  不自行擴大範圍去實作鍵盤版 tooltip（那會是另一個產品決策，spec 未
  要求，見開放設計問題確認為空）。

## UI 原型

`docs/design/SDLCCT-80-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，無需安裝任何套件，沿用 `docs/design/SDLCCT-78-prototype.html`/
`SDLCCT-79-prototype.html` 相同的色彩/字級 token 與版面骨架）。涵蓋 2
個區塊，對應 2 條 Gherkin 情境：

- 情境一：靜態呈現「hover 中」狀態的完整畫面——十字線固定畫在 D-2
  對應的 x 座標，tooltip 固定顯示在該位置旁，列出該天每個版本的金
  額（含一個 null → 「—」的示範）。由於靜態 HTML 無法重現真實滑鼠
  事件，原型用一個 checkbox（「顯示 hover 狀態」）切換十字線／
  tooltip 的顯示與隱藏，並在旁邊註明「此 checkbox 僅為原型示範用途，
  代表滑鼠移動到該位置時的畫面，實作中無任何 checkbox，純粹由
  `onMouseMove`/`onMouseLeave` 驅動」。
- 情境二：靜態呈現圖表下方表格區塊，獨立於上方 SVG，示範即使完全不
  觸發任何 hover 互動，表格仍完整列出所有日期與版本數值（含 null →
  「—」）。

本票是對既有圖表的小幅互動層新增（overlay/十字線/tooltip 皆為新增的
SVG 節點，不移除/修改既有折線、軸線、標籤、表格的任何既有渲染邏
輯），原型只聚焦這兩個新增互動狀態的呈現，不重複
`docs/design/SDLCCT-48-prototype.html` 已涵蓋的整頁版面，比例上符合
CONSTITUTION「設計文件應與故事規模成比例：小改動用短設計」。

## 設計系統文件異動（本票同時交付）

`docs/design-system.md` §11「資料視覺化」新增子項 11.3「互動
（hover/tooltip）」（接續 SDLCCT-78 的 11.1「圖表軸線與格線」、
SDLCCT-79 的 11.2「直接標籤」），內容對應上方關鍵技術決策 1-5 定案
的規則：

- Tooltip 內容格式：第一行為該資料點對應的日期（與表格標題列同一日期
  格式），接著每個資料序列各一行「序列名稱: 金額」，文字顏色採該序
  列本身的色票顏色（延續「顏色 ↔ 序列」視覺對應）；列出該資料點下
  **全部**資料序列，不受「直接標籤 vs 圖例」門檻（11.2）限制——兩者
  是獨立的呈現維度，互不套用對方的門檻。
- Tooltip 定位：以該資料點的 x 座標為錨點，依落在繪圖區左半或右半決
  定向右或向左延伸（與 11.2 直接標籤同一套「往有空間的一側延伸，避
  免被繪圖區邊緣裁切」原則），垂直固定在繪圖區上緣。
- 十字線樣式：垂直虛線（`strokeDasharray`），顏色採
  `--color-text-secondary`（次要文字色，非分類色票），與資料折線的
  實線＋分類色票在視覺上明顯區隔，避免被誤認為資料序列——延續 11.1
  格線「不可讓使用者誤認格線為某條資料線」同一精神。
- 何時顯示「—」：資料序列在該資料點的數值為 `null`（含上游缺資料，
  依既有「缺日期視為 null」規則統一處理）時，tooltip 該行金額顯示
  「—」，與圖表其他數值呈現位置（表格、Y 軸標示、直接標籤）同一條
  規則，不另訂獨立的 tooltip 專屬 null 顯示邏輯。

此為本票範圍內的文件交付（spec 第 3 點明文要求），由開發者在同一個
PR 內一併完成 `docs/design-system.md` 的編輯（append 既有章節，不可
重寫/刪減既有內容）。

## 開放設計問題（定稿時必須為空）

（無）
