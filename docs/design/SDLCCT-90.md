# 設計文件 — SDLCCT-90 版本成本圖折線下方面積漸層填色

## 對應需求規格

對應 G1 已核准的需求規格（SDLCCT-81 拆分出的第三張子票；SDLCCT-88 X 座標對齊、SDLCCT-89 四層格線皆已完成）。5 條 Gherkin 情境（已定稿）：

1. 每個連續（非 null）線段下方有面積填色：該序列每一段連續非 null 的值各對應一個面積區塊；顏色取自該序列的分類色票顏色；漸層由上往下淡出。
2. 缺值處面積斷開：null 日把面積切成互不相連的區塊，不跨缺值內插，也絕不當作 0 畫出。
3. 單點線段不產生錯誤面積：恰好 1 點的線段不產生面積區塊（或寬度為 0 的區塊），頁面不報錯。
4. 面積位於格線與折線之間且不遮擋互動：DOM 順序為格線、面積、折線；hover 十字線與 tooltip 照常運作；面積不攔截滑鼠事件（pointer-events: none）。
5. 面積為裝飾：不含獨立文字或 role；表格 a11y 後備與 svg 的 `aria-label` 不變。

**範圍外**：折線、格線、Y 軸標示、hover／tooltip 行為的任何變更；X 座標對齊（SDLCCT-88）；不引入圖表函式庫（漸層以 inline SVG `<defs>` 實作）；不新增色票顏色（顏色僅能來自 `docs/design-system.md` §11）。

## 現狀查核（實作前已逐字讀取）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一需改動的元件檔）：
  - 連續線段在 `entries.map` 內建立：`values = byDate(entry)`（固定 7 日、缺日為 `null`），逐日掃描，遇 `null` 就收束 `current`，否則 `current.push(toXY(dateIndex, value))`；`toXY` 回傳字串 `"x.toFixed(1),y.toFixed(1)"`。產生 `segments: string[][]`，每段直接渲染為 `<polyline points=segment.join(" ") fill="none" stroke={color} strokeWidth={2}>`。**目前 segments 只存字串，沒有數值座標。**
  - 色票：模組常數 `COLORS`（6 色：`#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300`），序列顏色為 `const color = COLORS[entryIndex % COLORS.length]`（>6 個序列時以取模輪替）。終點標籤、tooltip、圖例都用同一表達式。
  - `yFor(value)` 對 value 為線性映射，`yFor(max)=24`、`yFor(min)=136`（`CHART_HEIGHT=160`、`CHART_PADDING=24`、`innerHeight=112`）；`max===min` 時為 80。繪圖區底部 `CHART_HEIGHT - CHART_PADDING = 136` 恰等於最小值格線（SDLCCT-89 的 `data-gridline="min"`）與 min 的 Y 軸標示高度。
  - `xFor(i) = layout.centers[i]`（SDLCCT-88 量測表頭欄中心；jsdom／量測失敗時用 `fallbackLayout`）。
  - SVG 子節點順序：`<g data-gridlines>`（SVG 第一個 `<g>`）→ 每序列一個 `<g key=version>` 內含 `<polyline>` → `<g data-axis="y">` → `<g data-labels="tail">`（≤4 序列才渲染）→ 全高透明 `<rect>`（hover overlay，`svg > rect`）→ hover 時才有的十字線 `<line stroke-dasharray>` 與 `<g data-tooltip="active">`。
  - hover 事件只掛在最後一個 `<rect>`，且 overlay 在 DOM 最後（最上層）。
  - 元件目前**沒有任何 `<path>`、`<defs>`、`<linearGradient>`、`fill="url(...)"`**，也沒有 `useId`。React 19.3、Next 16.4（`"use client"` 元件但仍會 SSR，故 id 必須 SSR／hydration 穩定）。
- 單元測試 `version-cost-chart.test.tsx` 逐項核對（關鍵字 `path`、`defs`、`linearGradient`、`first-of-type`、`children`、`svg >`、`svg *`、`innerHTML`、`fill`、`snapshot`）：
  - 無任何 `querySelectorAll("path")`／`defs`／`linearGradient`／snapshot 斷言；無依賴 SVG 子節點索引的斷言。
  - `svg > g:first-of-type > line`（第 1405 行 = 4、第 1514 行 = 0）：**維持成立**——`<defs>` 放在面積 `<g>` 內而非 SVG 直接子節點，且面積 `<g>` 排在格線 `<g>` 之後，故 SVG 第一個 `<g>` 仍是格線群組。
  - `svg > rect`（第 1355、1413、1493、1840、2016 行）：仍是唯一的 SVG 直接子 `<rect>`（面積用 `<path>`，不用 `<rect>`），**維持成立**。
  - `svg polyline` 數量／points／stroke 斷言（第 127–292、738–773、1259–1490 行）：折線輸出須與現狀逐字相同（見決策 1），**維持成立**。
  - `svg text`／`g[data-axis="y"] text`／`g[data-labels="tail"] text`：面積不含 `<text>`，**維持成立**。
  - 第 573–574 行與第 738–773 行（終點標籤 fill 與 polyline stroke 配對）：未動。
  - 第 1878 行 `container.innerHTML` 不含 `"NaN"`：面積座標與折線同源，須維持無 NaN（新增測試涵蓋）。
  - `svg line[stroke-dasharray]`（十字線）：面積不含 `<line>`，**維持成立**。
  - **結論：不需要更新任何既有單元測試。** 實作後仍須整套 `npm run test` 實跑確認。
- E2E `frontend/e2e/agent-detail.spec.ts`：沒有任何 `path`／`fill`／`defs` 斷言；`svg polyline` 計數（第 125、249、295、337 行）與 SDLCCT-88 的折線座標對齊測試（第 1006–1200 行）只看 `polyline`，**不受影響**。SDLCCT-89 的 `svg g[data-gridlines] > line` 測試不受影響。
- **跨元素 computed style 耦合檢查**：本設計不改變任何既有元素的 computed style（折線、格線、標籤、表格皆未動），只新增裝飾性元素。全 `e2e/` 的 `toEqual`／`getComputedStyle` 僅涉 `<th>` 文字陣列、折線點數與另一元件的 padding，與面積無關。**不適用，無需處理。**
- `docs/design-system.md` §11.1 已有 X 軸、格線顏色、疊圖順序、格線層級數規則；§11 色票表有 8 色（順位 1～8），§11 並無任何關於面積／不透明度的規則。元件實際使用 `COLORS` 前 6 色且以取模輪替，此為既有現況（本票不更動色票機制）。

## 介面/API 契約

無對外介面變更（無 bff 端點、無 request／response 異動），元件 props 不變：`VersionCostChart({ entries, anchorDate })`。純前端渲染層。

### 面積幾何（定案）

1. **連續線段重用同一份資料**：把 `segments` 由 `string[][]` 改為數值座標 `runs: { x: number; y: number }[][]`（`x = xFor(dateIndex)`、`y = yFor(value)`）。折線 `points` 與面積 `d` 都由同一個 `runs` 格式化（同一個 `toFixed(1)`），因此**兩者不可能在斷點或座標上不一致**。折線輸出字串須與修改前逐字相同。
2. **每個 `run.length >= 2` 的線段產生一個封閉路徑**：

   ```
   d = "M x0,y0 L x1,y1 … L xn,yn  L xn,B  L x0,B  Z"        // B = 基線
   ```

   其中 `B = CHART_BASELINE = CHART_HEIGHT - CHART_PADDING`（= 136，繪圖區底部，新增模組常數）。由第一點沿折線走到最後一點，垂直下落到基線，沿基線回到第一點的 X，`Z` 封閉。
3. **`run.length === 1`（單點）不產生面積**（情境 3）：單點的封閉路徑寬度為 0，繪出無意義；直接略過，不渲染 `<path>`、不報錯。
4. **缺值斷開**（情境 2）：由 `runs` 本身保證——null 日不在任何 run 中，相鄰兩 run 之間沒有路徑相連，也沒有座標落在 null 日的 X 上，不內插、不當 0。
5. **全 null／無資料**：沒有 run，所以沒有 `<path>`；面積群組仍渲染但為空（見 DOM 合約）。
6. **單一序列**：與多序列同一邏輯，無特例。
7. **`max === min`**：折線在 Y=80，面積自 80 填到 136（與其他情況一致：面積永遠向下到繪圖區底部，不特殊處理）。
8. **線段恰在最小值（Y = 136）**：面積高度為 0，視覺上不可見，屬正常；漸層用 objectBoundingBox 時零高度 bbox 不會渲染，不會報錯。

### 漸層定義（定案）

- **每個「有至少一個面積」的序列一個 `<linearGradient>`**（同一序列的多個 run 共用），放在 `<g data-areas>` 內第一個子節點 `<defs>` 中。
- `x1="0" y1="0" x2="0" y2="1"`，採預設 `gradientUnits="objectBoundingBox"`：每個面積區塊以自身外框為準，**頂端（折線最高點）= 最不透明、底端（基線）= 完全透明**，由上往下淡出（情境 1）。不用 `userSpaceOnUse`：後者以整個繪圖區為座標，低值區塊會幾乎全透明而看不到面積。
- 兩個 `<stop>`：
  - `offset="0"`：`stopColor={color}`、`stopOpacity={0.15}`
  - `offset="1"`：`stopColor={color}`、`stopOpacity={0}`
  
  其中 `color = COLORS[entryIndex % COLORS.length]`，**與折線 stroke、終點標籤 fill、tooltip 文字、圖例色點為同一個變數**，因此序列超過 6 個時色票輪替規則自動一致（第 7 個序列面積色 = 第 1 個序列色）。新增模組常數 `AREA_TOP_OPACITY = 0.15`。
- **不透明度取 0.15（而非例示的 0.25）的理由**：面積在視覺上必須是「淡色」且不削弱折線與標籤。折線 `stroke` 為不透明實色，疊在面積上方，辨識度不受影響。終點標籤文字（疊在最上層）有可能壓在面積最亮處：以 `#2a78d6` 文字為例，白底對比約 4.4:1；壓在 0.15 的同色相最亮處約 3.6:1（0.25 時約 3.2:1，降幅更大）。此降幅只出現在標籤剛好落在該段最高點、且文字下半部的少數像素；標籤以折線端點的 Y 為垂直中心，上半部在面積之外，下半部不透明度隨高度線性遞減。多條序列面積重疊時，最亮處最多疊加為 0.30 的混合，但重疊的兩個尖峰需在同一 X 同一 Y 附近，且該處每條折線仍是實色，屬可接受風險。標籤與折線之外的文字（Y 軸標示、格線）不受面積影響，因為它們在面積 `<g>` 之外且格線在面積之下。數值本身另有表格後備。
- **漸層 id 方案**：元件頂端 `const uid = React.useId().replace(/:/g, "")`（React 的 id 形如 `:R1a:`，冒號會讓 CSS 選擇器與 `url(#…)` 引用變得需要跳脫，故先去除冒號），每個序列的 id 為 `` `${uid}-area-${entryIndex}` ``。理由：
  - `useId` 在 SSR 與 hydration 之間穩定（不會 hydration mismatch），在 React StrictMode 雙重渲染下穩定，且同一頁面上多個 `VersionCostChart` 實例各得不同的 uid，**不會有重複 id**（重複 id 會使第二張圖的 `url(#…)` 解析到第一張圖的漸層，色彩錯亂）。
  - 以 `entryIndex`（而非版本名稱）區分序列：版本名稱可能含空白或特殊字元不適合當 id，而序列順序在一次渲染內固定且唯一。
  - 不用 `Math.random()`／模組層級遞增計數器：兩者在 SSR／hydration 會不一致。
- 面積路徑：`<path data-area={entry.version} data-run={runIndex} d={…} fill={`url(#${gradId})`} stroke="none" pointerEvents="none" />`。`runIndex` 為該 run 在 `runs` 中的索引（**含單點 run**），因此與同序列第 `runIndex` 條 `<polyline>` 一一對應；單點 run 被略過時，`data-run` 會有缺號，這是預期。

### DOM 合約（新增，供測試與維護）

SVG 直接子節點順序（由下到上，後者蓋前者）：

```tsx
<svg role="img" aria-label=… /* 不變 */>
  <g data-gridlines>…</g>                                     {/* 不變，仍是 SVG 第一個 <g> */}
  <g data-areas aria-hidden="true" pointerEvents="none">      {/* 新增，永遠渲染（可為空） */}
    <defs>
      <linearGradient id={`${uid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity={0.15} />
        <stop offset="1" stopColor={color} stopOpacity={0} />
      </linearGradient>
      {/* 僅輸出「至少有一個面積」的序列 */}
    </defs>
    <path data-area="v1" data-run="0" d="M… Z" fill="url(#…)" stroke="none" pointerEvents="none" />
    …
  </g>
  {entries.map(… <g key=version><polyline/>…</g>)}            {/* 不變 */}
  <g data-axis="y">…</g>                                      {/* 不變 */}
  {showTailLabels && <g data-labels="tail">…</g>}             {/* 不變 */}
  <rect hover overlay />                                      {/* 不變，仍在最上層 */}
  {hover 十字線 / tooltip}                                     {/* 不變 */}
</svg>
```

- 面積群組位於 `<g data-gridlines>` 之後、所有 `<polyline>` 之前（情境 4）；`<defs>` 位於面積 `<g>` 內，不增加 SVG 直接子節點，避免擾動 `svg > g:first-of-type` 之類的位置選擇器。
- 面積 `<g>` 與每個 `<path>` 皆帶 `pointer-events="none"`（`<g>` 上的屬性可繼承，`<path>` 上再寫一次作為明確保險）；雙重保險之外，hover overlay 本來就在 DOM 最後，面積不可能擋到它。
- `aria-hidden="true"` 在面積 `<g>` 上；不輸出任何 `<text>`、`<title>`、`<desc>`、`role`、`aria-label`（情境 5）。`<svg>` 的 `role="img"` 與 `aria-label` 以及表格後備一律不動。
- 渲染順序的取捨：面積 `<g>` 必須在「所有序列的折線」之前，因此不能在現有 `entries.map` 的同一個 `<g>` 內與折線並排輸出。實作方式為：先在 `entries.map` 之前（或同一個迴圈前）預先為每個序列算出 `values`／`runs`／`color`／`tail`，再分別輸出面積與折線兩個 map；或在單一迴圈內同時 push 面積節點與折線節點到兩個陣列、最後依序渲染。tail label 目前已採「迴圈內 push 到 `tailLabels` 陣列、之後渲染」的同款手法，沿用即可。

## 資料模型

無新增資料模型。不新增 state、props 或後端欄位。元件內僅新增常數與衍生值：

```ts
const CHART_BASELINE = CHART_HEIGHT - CHART_PADDING; // 136，繪圖區底部
const AREA_TOP_OPACITY = 0.15;
// 元件內
const uid = React.useId().replace(/:/g, "");
type Pt = { x: number; y: number };
const fmtPt = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
// 每個序列： runs: Pt[][]；polyline points = run.map(fmtPt).join(" ")
// 面積 d = `M ${run.map(fmtPt).join(" L ")} L ${last.x.toFixed(1)},${B.toFixed(1)} L ${first.x.toFixed(1)},${B.toFixed(1)} Z`
```

`toXY` 可移除（由 `fmtPt` 取代；折線輸出逐字相同）。

## 關鍵技術決策

1. **面積與折線共用同一份 `runs`**：先前只存字串，面積需要數值座標；改存數值並由同一函式格式化，使面積與折線在斷點、座標、單點判斷上永不分歧（情境 2、3 的結構性保證），且折線輸出逐字不變以免回歸。
2. **基線 = 繪圖區底部 `CHART_HEIGHT - CHART_PADDING`（136）**：與 min 格線與 min 標示同高，面積不會伸出繪圖區、不蓋到下方表格；不用 `CHART_HEIGHT`（會超出格線範圍）。
3. **每序列一個漸層 + objectBoundingBox**：每個區塊自身頂端最濃，確保低值序列也看得見；同序列多個 run 共用漸層以減少 DOM。
4. **不透明度 0.15 → 0**：見上方對比計算；折線與標籤清晰度優先於面積強度。
5. **id 用 `React.useId`（去冒號）+ `entryIndex`**：SSR／hydration／StrictMode／同頁多圖皆安全。
6. **單點 run 略過而非輸出零寬路徑**：避免無意義 DOM 與潛在的 `d` 退化；情境 3 兩種結果皆被接受，選較簡單的一種。
7. **`<defs>` 放在面積 `<g>` 內、`<g data-areas>` 永遠渲染**：不改變 SVG 直接子節點與 `g:first-of-type` 的語意，空狀態 DOM 位置穩定，測試可固定用 `g[data-areas]` 取得。
8. **面積色與序列色同一變數**：輪替規則（>6 個序列取模）自動一致，不另外維護對應表；色票本身（6 色 vs 設計系統 8 色）為既有現況，本票不改動，也不新增顏色。
9. **面積 `aria-hidden` + 無文字**：純裝飾，a11y 由 `svg aria-label` 與表格後備承擔，不重複朗讀。

## 測試策略（供 developer／tester 對照，非新增需求）

**需更新的既有測試：無。**（逐項核對結果見「現狀查核」；唯一須注意的是折線輸出必須逐字不變。）

**新增單元測試（`version-cost-chart.test.tsx`，新 `describe("SDLCCT-90 …")`，沿用既有 layout mock／fallbackLayout 手法）**
1. 情境 1：7 日皆有值的單一序列 → `g[data-areas] path[data-area]` 恰 1 個；`d` 以 `M` 開頭、以 `Z` 結尾；`fill` 為 `url(#id)` 且該 id 對應到同一 SVG 內的 `linearGradient`；漸層 `x1=0 y1=0 x2=0 y2=1`、第一個 stop `stop-color` 等於該序列 `polyline` 的 `stroke`、`stop-opacity` 為 `0.15`、第二個 stop 同色 `0`。
2. 情境 1 補強：面積路徑前 n 個頂點與對應 `polyline` 的 `points` 逐點相等；最後兩個頂點的 Y 皆為 `CHART_HEIGHT - CHART_PADDING`（測試內以 `160 - 24` 推算，容許 `toBeCloseTo(…,1)`），且 X 分別為最後點與第一點的 X。
3. 情境 1 多序列：3 個序列各自 path 的漸層 stop color 依序等於 `COLORS` 前 3 色且等於各自折線 stroke；7 個序列時第 7 個序列的面積色等於第 1 個序列的色。
4. 情境 2：`[v,v,null,v,v,v,v]` → 2 個面積（`data-run` 為 0、1）；第 1 塊所有 X 的最大值 < 第 2 塊所有 X 的最小值；任何頂點的 X 都不等於第 3 個日期欄中心；`innerHTML` 不含 `NaN`。另測「缺日（entries 內根本沒有該日期的 point）」結果同上。
5. 情境 3：`[v,null,v,v,v,v,v]` → 單點 run 不產生面積，其餘 run 正常（`data-run` 為 `1` 而非 `0`，與折線索引對應）；整條序列只有 1 個點 → 該序列 0 個 path 且不丟錯；此序列的 `linearGradient` 不輸出。
6. 全 null／`entries=[]`：`g[data-areas]` 存在、`path` 為 0、`linearGradient` 為 0、無錯誤、無 `NaN`；max===min 單一序列 → 面積存在且頂點 Y 為 80。
7. 情境 4 DOM 順序：`g[data-gridlines]` 在 `g[data-areas]` 之前、`g[data-areas]` 內所有 `path` 在第一個 `polyline` 之前（以 `compareDocumentPosition` 或 `querySelectorAll` 的 document 順序驗證）；`svg > g:first-of-type` 仍為 `data-gridlines`；面積 `<g>` 與每個 `path` 的 `pointer-events` 為 `none`。
8. 情境 4 互動：沿用既有 hover 測試手法對 `svg > rect` 觸發 `mouseMove`，十字線 `svg line[stroke-dasharray]` 為 1 條且 `g[data-tooltip="active"]` 存在；移開後消失。
9. 情境 5：`g[data-areas]` 的 `aria-hidden="true"`；其內 `text`／`title`／`desc`／`[role]` 皆為 0 且 `textContent` 為空字串；`svg` 的 `role="img"` 與 `aria-label` 等於 `t("agentDetail.versionSeries.title")`；表格欄與儲存格數不變。
10. id 唯一性：同一 `document` 內以 `render` 兩次（相同 entries）→ 兩張圖的所有 `linearGradient` id 在全文件中無重複，且每個 `path` 的 `fill` 指向自己所在 SVG 內的漸層；另用 `<React.StrictMode>` 包裹渲染一次，仍無重複 id 且 `path` 的 `fill` 皆可解析。
11. 回歸：折線 `points` 與 SDLCCT-88 的 `polylineXs` 結果不變（既有測試已涵蓋，不另寫）。

**新增 E2E（Playwright，`frontend/e2e/agent-detail.spec.ts`；一律 `CI=1 npx playwright test --workers=1`）**
- 測試名稱 `SDLCCT-90: version-cost chart draws gradient areas under each continuous run, behind the lines, without blocking hover`：以 `page.route` 模擬 cost-breakdown（2 個版本；v1 含一個 null 缺日使其有 2 段 ≥2 點線段，v2 全日有值；視窗 1280×800）。斷言：
  1. `svg g[data-areas] path[data-area]` 共 3 個（`data-area="v1"` 2 個、`"v2"` 1 個）；`svg polyline` 數量與改動前相同。
  2. 第一個面積 `path` 的 `getComputedStyle().pointerEvents === "none"`；`g[data-areas]` 的 `aria-hidden === "true"`。
  3. 以 `evaluate` 驗證 DOM 順序：`g[data-gridlines]` < `g[data-areas]` < 第一個 `polyline`（`compareDocumentPosition`）。
  4. 將滑鼠移到繪圖區（落在面積上方的座標）→ `svg g[data-tooltip="active"]` 可見、`svg line[stroke-dasharray]` 為 1 條；面積不阻擋事件。
  5. `svg` 的 `aria-label` 與 `role="img"` 不變；表格列數不變。
  6. 面積實際著色：取 v1 面積的 `fill` 引用漸層，其第一個 stop 的 `stop-color` 等於 v1 `polyline` 的 `stroke`。

## 設計系統文件異動（本票同一個 PR 內一併交付，由 developer 實作）

本設計階段不編輯下列檔案，列為實作任務（就地新增段落，不可刪減其他內容）：

1. `docs/design-system.md` §11.1 新增「**面積填色規則**」（SDLCCT-90）：面積顏色與所屬序列的折線色票顏色相同（超過色票數量時輪替規則與折線一致，不新增顏色）；漸層方向為由上往下淡出（頂端不透明度 0.15、底端 0，各區塊以自身外框為準）；每個連續非 null 且至少 2 點的線段一個封閉面積，向下封至繪圖區底部（`CHART_HEIGHT - CHART_PADDING`），null 日斷開、單點線段不畫面積；疊圖順序為格線 → 面積 → 折線 → 軸標示／直接標籤 → hover 覆蓋層；面積為純裝飾（`aria-hidden`、`pointer-events: none`、無文字與 role）。並把既有「疊圖順序規則」的敘述補上「格線與資料折線之間為面積」。
2. 元件檔頂部註解補一行指向本設計文件（`docs/design/SDLCCT-90.md`：折線下方面積漸層，重用折線 runs，`React.useId` 產生漸層 id）。

## UI 原型

`docs/design/SDLCCT-90-prototype.html`（可直接在瀏覽器開啟的靜態 HTML，無需安裝任何套件；沿用 SDLCCT-88／89 原型的色彩、字級、版面 token 與「量測表頭欄中心」機制）。原型以按鈕切換五種資料情境，並即時顯示讀數：

- 情境 1：預設「一般資料（含缺值斷開）」：每條連續線段下方有同色淡漸層，由上往下淡出。
- 情境 2：同一預設資料中的 v1（第 3 日缺值）與 v2（第 6 日缺值）面積各斷成兩塊，缺值日沒有面積。
- 情境 3：「含單點線段」與「整條序列僅 1 點」：單點不產生面積，頁面與讀數皆無錯誤。
- 情境 4：DOM 順序為格線、面積、折線；移動滑鼠可看到虛線十字線；讀數面板驗證順序、`pointer-events`、漸層 id 唯一。
- 情境 5：面積群組 `aria-hidden`，讀數驗證其內無文字與 role、`svg` 的 `aria-label` 不變。
- 另附「全部為 null」（無面積、無錯誤）與「7 個序列」（色票輪替、改用圖例）兩個情境，以及「隱藏面積」勾選（僅供對照有無面積）。

原型中的讀數面板、情境按鈕與「隱藏面積」勾選僅供示範，實作中不存在。

## 開放設計問題（定稿時必須為空）

（無）
