# 設計文件 — SDLCCT-73 版本成本時間序列圖表加入 Y 軸刻度與數值標示

## 對應需求規格

對應 G1 已核准的需求規格「版本成本時間序列圖表加入 Y 軸刻度與數值標
示」。3 條 Gherkin 情境（已定稿）：

1. 數值有落差（`max !== min`，且至少一個非 null value）時，SVG 內出現
   **恰好兩個** Y 軸金額 `<text>`：`formatCurrency(max)` 對齊 max 的高
   度、`formatCurrency(min)` 對齊 min 的高度，皆落在 `x < CHART_PADDING
   = 24` 的左側留白區，不與 polyline/圖例/表格重疊。
2. 所有非 null value 彼此相等（`max === min`）時，只出現**一個**
   `<text>`，不出現兩個重疊的標示。
3. 所有 points 的 value 皆為 null（或 entries 為空）時，**不出現任何**
   Y 軸金額 `<text>`，不顯示 `"US$ 0"` 或任何臆測數值。

**範圍外**（spec 已標明）：不實作完整座標軸系統（無格線/軸線/中間刻
度，僅 max/min 兩點收斂為一）；不新增 X 軸標示；不處理 Agent 清單頁
Sparkline；不引入圖表函式庫（沿用手刻 inline SVG，決策記錄在
`docs/design/SDLCCT-48.md` 決策 3）；不改動既有折線渲染邏輯/圖例/表
格。

**依賴**：無（SDLCCT-47、SDLCCT-48 皆已 Done）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一
  要改動的檔案）：
  - `CHART_WIDTH=480`、`CHART_HEIGHT=160`、`CHART_PADDING=24`，
    `innerWidth`/`innerHeight` 皆為 `CHART_*  - CHART_PADDING * 2`。
  - `allValues` 取所有 `entry.points[].value` 中非 null 者；
    `min = allValues.length > 0 ? Math.min(...allValues) : 0`、
    `max` 同理用 `Math.max`——**兩者在無任何非 null 值時都退回
    `0`，而不是 `NaN`/`undefined`**，本票不可依賴「`min`/`max` 是否
    為 0」來判斷有無資料，必須另外用 `allValues.length > 0` 判斷（見
    下方決策 3）。
  - `toXY(dateIndex, value)` 的 y 分支：
    ```ts
    const y =
      max === min
        ? CHART_PADDING + innerHeight / 2
        : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;
    ```
    除以零防呆：`max === min` 時收斂到 `CHART_PADDING + innerHeight /
    2`（置中水平線），**不是**丟錯誤或 `NaN`。這個收斂高度正是情境 2
    「只顯示一個標示」時，該標示應該對齊的 y 座標——本票不需要另外發
    明一套「單點時標示畫在哪」的邏輯，直接重用這個既有防呆分支的輸出
    值即可（見下方決策 1/2）。
  - 代入 `value = max` 時，`y = CHART_PADDING + innerHeight -
    innerHeight = CHART_PADDING`；代入 `value = min` 時，
    `y = CHART_PADDING + innerHeight - 0 = CHART_PADDING + innerHeight`。
    也就是說 max/min 的 y 座標其實是 toXY 現有公式在
    `value=max`/`value=min` 這兩個特例下的結果，**不需要另外推導新公
    式**，只需要把 y 的計算邏輯抽成一個獨立函式 `yFor(value)` 讓
    `toXY` 與新的標示渲染共用（見決策 1，不重複發明數學）。
  - `<svg viewBox="0 0 480 160" width="100%" height={160} ...>`：
    `height` 是字面像素值（非百分比），`width` 是百分比——瀏覽器以
    `preserveAspectRatio` 預設 `xMidYMid meet` 等比例縮放 viewBox 塞進
    渲染框；只要容器寬度 ≥ 480px（本專案 `<main>` 內容欄寬度皆遠大於
    此），縮放比例由高度那一軸決定且等於 1，即 **viewBox 單位 ≈ 實際
    CSS px**。本票新增的 `font-size` 數值可直接以「近似 CSS px」理解，
    不需要額外換算係數。
  - `formatCurrency`/`t` 已是既有 import，本票新增的 `<text>` 直接重
    用 `formatCurrency`，不新增格式化邏輯。
  - 圖表內目前**沒有任何既有 `<text>` 元素**（折線圖只有
    `<polyline>`），因此本票字級/顏色沒有「既有 SVG 文字」可直接照
    搬，改以 `docs/design-system.md` 的字級階層與既有 HTML 輔助文字
    （`text-text-secondary`，CSS 變數
    `--color-text-secondary: #4B5563`，定義於
    `frontend/app/globals.css`）為依據（見決策 2）。
- `frontend/lib/format.ts::formatCurrency`：`null`/`undefined` → `"—"`；
  非 0 整數 → 千分位 `US$ 1,234`；四捨五入後為 0 但原值非 0 → 顯示兩位
  小數。本票傳入的 `max`/`min` 必為真實非 null 數值（已用
  `allValues.length > 0` 守門），不會把 `null` 傳進
  `formatCurrency`，與下方「表格那一欄」的既有用法一致，不新增分支。
- `docs/design-system.md` §3 字級階層：輔助文字（Meta，時間戳/說明文
  字/單位標註）12px、`--color-text-secondary`。本票的 Y 軸金額標示屬
  性質上最接近「單位標註/說明文字」，採同一顏色 token；字級因 SVG 內
  左側留白區（24 viewBox 單位 ≈ 24px）明顯比一般 HTML 文字容身空間
  小，采 10px（略小於 Meta 的 12px，是本票在既有字級階層與可用空間之
  間的具體落地選擇，見決策 2）。
- `frontend/e2e/agent-detail.spec.ts`：既有測試只斷言折線
  `<polyline>` 數量/`points`屬性、圖例 `<li>` 數量、表格文字——**沒有
  任何測試斷言 SVG `<text>` 元素**（因為目前完全不存在），本票新增
  的 `<text>` 不會與既有斷言衝突，但開發者需要新增對應的 e2e/單元測
  試覆蓋 3 條 Gherkin 情境（AC 對應測試是開發者的工作，非本設計文件
  範圍，僅在此記錄現狀供開發者承接）。
- 全 repo `Grep("toEqual|getComputedStyle|一致")`：命中
  `frontend/e2e/trace-detail.spec.ts`（比較 `<tr>` 子列 `paddingLeft`
  與另一列的既有縮排一致性測試,與本圖表元件的任何選擇器無關)、
  `frontend/components/trace-detail/group-spans.test.ts`、
  `frontend/AGENTS.md`（文件說明文字)、
  `frontend/lib/use-fetch-once.test.ts`（與樣式無關的 hook 單元測
  試)。**沒有任何測試比較 `VersionCostChart` 或其子選擇器
  (`polyline`/`text`/`ul li`/`table`) 與其他元件的 computed style 相
  等**,本票新增/變更的選擇器不會觸發任何跨元素樣式耦合測試鏈,跨元
  素樣式耦合測試檢查不適用。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點，純前端渲染層改動，消費的資料形狀
（`VersionCostSeriesEntry[]`）與 SDLCCT-47/48 完全相同。

## 資料模型

無新增資料模型。`max`/`min` 是元件內部由既有 `allValues` 推導的區域
變數（既有程式碼已有，本票不新增 state/props）。

## 關鍵技術決策

### 1. 把 `toXY` 內的 y 座標公式抽成獨立函式 `yFor(value)`，標示與折線共用同一套換算

```ts
const yFor = (value: number) =>
  max === min
    ? CHART_PADDING + innerHeight / 2
    : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;

const toXY = (dateIndex: number, value: number) => {
  const x = /* 既有 x 公式，原樣不動 */;
  const y = yFor(value);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
};
```

`yFor(max)` 代入後恒等於 `CHART_PADDING`（折線頂端）、`yFor(min)` 恒
等於 `CHART_PADDING + innerHeight`（折線底端）、`max === min` 時恒等
於既有的除以零防呆收斂高度。重用而不重寫這段數學，保證標示的高度與
折線本身的高度在任何資料下都精確對齊（不會有「標示畫歪」的浮點數誤
差風險），且不違反 spec 範圍外「不改動既有折線渲染邏輯」——`toXY` 的
輸出字串與既有行為完全相同，只是內部重構出一個可重用的子函式。

### 2. 標示文字：`x=2`、`text-anchor="start"`、`font-size=10`、`fill="var(--color-text-secondary)"`、`dominantBaseline="middle"`

- `x=2`、`text-anchor="start"`：文字的錠點（SVG `<text>` 的 `x`
  屬性，Gherkin 情境 1 所指「落在 x < CHART_PADDING=24 的左側留白
  區」的檢測基準）明確小於 24，且文字往右流動的方向與折線區域
  （`x ≥ 24`）同向——選擇讓文字起點盡量貼左（`x=2` 而非貼右
  `x=22`），是因為貼右（`text-anchor="end"`）會讓長字串（如
  `US$ 12,345`）往左溢出到 viewBox 的 `x<0` 區域而被 SVG 根元素預設
  的 `overflow: hidden` 裁切成讀不出前幾個字元；貼左溢出的方向則是往
  右侵入繪圖區，雖然視覺上可能與折線的最左端點重疊，但至少整串金額
  文字本身不會被裁切到無法閱讀。這是本票在「不新增完整座標軸系統/不
  加大 CHART_PADDING」這個既定範圍限制下，兩種都不完美的方案之間的
  取捨，記錄在此而非留給 developer 自行選擇，避免兩個開發者各自選到
  不同方向。
- `dominantBaseline="middle"`：讓文字垂直置中對齊 `yFor()` 算出的高
  度（SVG `<text>` 的 `y` 屬性預設是文字基線而非置中，不加這個屬性會
  讓文字視覺上偏移到對齊高度之下）。
- `font-size=10`：`docs/design-system.md` §3 字級階層的「輔助文
  字（Meta）」12px 是本票性質最接近的既有分類（單位標註性質的小字），
  但如「現狀查核」段落所述，viewBox 單位 ≈ CSS px 且左側留白區只有 24
  單位寬，12px 會讓單一字元占比過大、更快把字串推出留白區；10px 是在
  「沿用 Meta 字級分類」與「盡量不讓文字一開始就溢出太多」之間的具體
  折算值，仍與既有 Meta 分類同一數量級（非憑空另訂一個字級）。
- `fill="var(--color-text-secondary)"`：直接取用
  `frontend/app/globals.css` 既有的 `--color-text-secondary` CSS 變
  數（與 HTML 側 `text-text-secondary` 這個 Tailwind class 背後是同一
  個 design token），SVG `<text>` 不支援 Tailwind 的 `text-*` 顏色
  class（那是設定 CSS `color`，SVG 文字顏色要靠 `fill`），所以用
  inline `fill="var(--color-current)"` 的方式直接引用同一個 CSS 變
  數，而不是另外新訂一個顏色值——避免色票分裂成兩套。

### 3. 渲染條件：`allValues.length === 0` → 不渲染任何標示；`max === min` → 一個；否則兩個

```ts
const hasValues = allValues.length > 0;
const labels = !hasValues
  ? []
  : max === min
    ? [{ key: "single", value: max, y: yFor(max) }]
    : [
        { key: "max", value: max, y: yFor(max) },
        { key: "min", value: min, y: yFor(min) },
      ];
```

不可用 `max === 0 && min === 0` 之類的數值判斷來推斷「沒有資料」——
「現狀查核」已確認既有程式碼在 `allValues.length === 0` 時把
`min`/`max` 都預設為 `0`，這個 `0` 是程式內部的防呆預設值，不是真實
金額；情境 3 明確要求「不顯示任何標示，不顯示 US$ 0 或任何臆測數
值」，所以本票新增的渲染條件必須額外用 `hasValues` 這個既有
`allValues.length > 0` 判斷守門，不能只看 `max`/`min` 的值本身（否則
真實資料剛好全部為 0 時會誤判成「沒有資料」，或「沒有資料」時誤顯示
`US$ 0`，兩個方向都違反 CONSTITUTION「缺值顯示 unknown，不可顯示
0」）。

`labels` 渲染在既有兩組 `<polyline>` 之後（DOM/繪製順序上在後，視覺
上蓋在折線之上）——不改變折線本身的渲染邏輯，只是把新增的 `<g>` 插在
既有 `<svg>` 內容的最後，確保標示文字不會被折線蓋住而讀不到，一定程
度緩解決策 2 提到的「文字可能視覺上侵入繪圖區」的可讀性風險（繪製順
序無法阻止幾何重疊，但至少保證文字在視覺上可讀）。

### 4. 情境 1「不與 polyline/圖例/表格重疊」的驗證基準：`<text>` 的 `x` 屬性值，而非渲染後的像素外框幾何相交

Gherkin 原文「皆落在 x < CHART_PADDING=24 的左側留白區」字面上描述的
是標示的**定位**（x 座標），`frontend/e2e/agent-detail.spec.ts` 既有
測試一貫的斷言風格也是屬性值/數量（`getAttribute("points")`、
`toHaveCount`），不是 `getBoundingClientRect` 像素級碰撞檢測——本票
依此既有測試風格，把「不重疊」操作化為「`<text>` 的 `x` 屬性 < 24」
這一個可確定性驗證的條件，而不是「渲染後的字形外框永不越界」（決策
2 已說明：給定留白區只有 24 單位寬，任何非一位數金額字串在現實字級
下幾乎必然會視覺上延伸超過 24——若驗證基準是像素外框，則情境 1 在資
料量稍大時會變成「規格上不可能滿足」的矛盾要求）。圖例（`<ul>`）與
表格（`<table>`）是 SVG 外的獨立 HTML 區塊，与 SVG 內的 `<text>` 本
來就不在同一個渲染層，不存在幾何重疊的可能，此處的「不重疊」對它們
而言恒成立。此為本票對驗證方法的具體化選擇，不是對規格文字的重新解
讀或產品決策變更，記錄於此供 developer 寫測試與 reviewer 審查時有
一致的依據。

## UI 原型

`docs/design/SDLCCT-73-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，沿用 `docs/design/SDLCCT-48-prototype.html` 相同的色彩/字級
token）。涵蓋 3 個區塊，逐一對應 3 條 Gherkin 情境：

- 情境 1（max ≠ min）：示範兩條折線 + 兩個金額標示（`US$ 150`／
  `US$ 20`），標示位置與座標公式皆依本文件決策 1/2，並以文字說明標
  示可能視覺上延伸超出左側留白區邊界的已知取捨。
- 情境 2（max === min）：示範一條水平線 + 一個金額標示。
- 情境 3（全部 null）：示範空的 `<svg>`（無 polyline、無 text），圖
  例文字註記「本週無資料」。

本票是對既有圖表的小幅視覺疊加（新增兩個以內的 `<text>` 元素），不
新增頁面/版面配置，故原型只聚焦圖表本身三種狀態的呈現，不重複
`docs/design/SDLCCT-48-prototype.html` 已涵蓋的整頁版面（頁首/三區塊
配置/錯誤卡片等），比例上符合 CONSTITUTION「設計文件應與故事規模成
比例：小改動用短設計」。

## 開放設計問題（定稿時必須為空）

（無）
