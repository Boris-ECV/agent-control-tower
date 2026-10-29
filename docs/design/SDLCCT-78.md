# 設計文件 — SDLCCT-78 版本成本圖表 X 軸日期刻度與淡化格線

## 對應需求規格

對應 G1 已核准的需求規格「版本成本圖表 — X 軸日期刻度與淡化格線」
（SDLCCT-77 拆分出的第一張子票）。2 條 Gherkin 情境（已定稿）：

1. 圖表以 7 天資料渲染完成後，SVG 內可見至少 2 個日期文字標籤（對應
   D-6 與 D），且標籤文字與下方表格對應欄位的日期一致。
2. 圖表有 max/min 兩個 Y 軸金額標示時，對應 max、min 高度各有一條淡
   化水平格線橫跨圖表寬度，格線顏色不是任何版本線的色票顏色。

**範圍外**（spec 已標明）：不處理版本終點直接標籤或圖例（SDLCCT-79）；
不處理 hover/tooltip（SDLCCT-80）；不處理 SDLCCT-76 的資料正確性（本
票純前端視覺層）；不引入圖表函式庫，延續現有手刻 inline SVG；不改變
Y 軸自動縮放邏輯。

**依賴**：與 SDLCCT-79、SDLCCT-80 同一檔案
（`frontend/components/agent-detail/version-cost-chart.tsx`）及同一文
件章節（`docs/design-system.md` 第 11 節），建議依 78 → 79 → 80 順序
合併以減少衝突，非硬性阻斷（本票不因此延後任何工作）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一
  要改動的元件檔案）：
  - `CHART_WIDTH = 480`、`CHART_HEIGHT = 160`、`CHART_PADDING = 24`，
    `innerWidth`/`innerHeight` 皆為 `CHART_* - CHART_PADDING * 2`。
  - `dates = fixedSevenDates(anchorDate)`（SDLCCT-72）：固定長度 7 的
    `YYYY-MM-DD` 陣列，索引 0 是 D-6、索引 6 是 D（錨點當天）。
  - `toXY(dateIndex, value)` 的 x 分支：
    ```ts
    const x =
      dates.length > 1
        ? CHART_PADDING + (dateIndex / (dates.length - 1)) * innerWidth
        : CHART_PADDING + innerWidth / 2;
    ```
    這是既有折線資料點的 x 座標公式，`dateIndex` 與 `dates` 陣列索引
    一一對應——本票的 X 軸日期標籤必須重用同一公式（代入
    `dateIndex ∈ {0, ..., 6}`），不得另外發明一套 x 座標換算，否則標
    籤與折線資料點在視覺上會對不齊。
  - `yFor(value)`（SDLCCT-73 已抽出的獨立函式）：
    ```ts
    const yFor = (value: number) =>
      max === min
        ? CHART_PADDING + innerHeight / 2
        : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;
    ```
  - `labels` 陣列（SDLCCT-73，Y 軸 max/min 文字標示用）：
    ```ts
    const labels = !hasValues
      ? []
      : max === min
        ? [{ key: "single", value: max, y: yFor(max) }]
        : [
            { key: "max", value: max, y: yFor(max) },
            { key: "min", value: min, y: yFor(min) },
          ];
    ```
    `labels[].y` 正是本票格線要對齊的高度——本票的格線渲染必須直接消
    費同一個 `labels` 陣列算出的 `y`，不得重新呼叫 `yFor` 另外計算一
    次（避免兩處各自四捨五入/計算順序微差造成格線與文字標示肉眼對不
    齊，雖然理論上數值相同，但共用同一個已算好的陣列是更直接、不需
    要再次驗證「兩次呼叫是否真的相等」的做法）。情境 2 的「max === min
    只有一個標示」分支（`labels` 只有 1 個元素，`key: "single"`）此時
    只畫 1 條格線，這是沿用既有 `labels` 陣列本就有的分支，本票不需
    要另外處理。
  - `<svg>` 內目前的子元素順序：所有版本的 `<polyline>` → `labels` 的
    `<text>`（Y 軸金額標示，SDLCCT-73）。本票新增兩類元素：格線
    `<line>` 與 X 軸日期 `<text>`。
  - `COLORS` 陣列：`["#2a78d6", "#eb6834", "#1baf7a", "#eda100",
    "#e87ba4", "#008300"]`（`docs/design-system.md` §11 色票順位
    1-6）——本票格線顏色需明確避開這 6 個色值（驗收情境 2 的字面要
    求），見下方關鍵技術決策 2。
  - `formatCurrency`/`formatTaiwanDate`/`t` 皆為既有 import。
    `formatTaiwanDate` 已用於表格欄位（第 151-155 行附近），本票 X
    軸標籤直接重用同一函式，保證「標籤文字與下方表格對應欄位的日期
    一致」（情境 1 字面要求）天然成立，不需要另外維護一份格式。
  - Y 軸金額標示 `fill="var(--color-text-secondary)"`（SVG 文字顏色
    用 `fill`，不是 Tailwind `text-*` class，見 SDLCCT-73 決策 2）——
    本票 X 軸日期標籤的顏色延續同一慣例與同一 token。
- `frontend/lib/format.ts::formatTaiwanDate(isoDate)`：輸入
  `"YYYY-MM-DD"`，輸出 `Intl.DateTimeFormat("zh-TW", { timeZone:
  "Asia/Taipei", year: "numeric", month: "long", day: "numeric" })`
  格式化後的完整字串（例如「2026年10月29日」）——**字串較長**，本票
  X 軸標籤排版需考慮此格式在 480px 寬、僅標 2-3 個日期的情況下是否會
  互相重疊（見關鍵技術決策 1，密度上限定為 2-3 個標籤正是為了迴避這
  個長字串問題，而不是另外發明一套精簡日期格式）。
- `docs/design-system.md` §1 色彩系統：`--color-border: #E5E7EB`（分
  隔線/邊框用途，非文字色，不套用 WCAG 文字對比門檻）；§3 字級階層
  輔助文字（Meta）12px、`--color-text-secondary`；§11 資料視覺化已有
  色票表格與「固定順位」規則，目前只有「分類色票」一個子項，尚無本
  票要新增的「圖表軸線與格線」子項。
- `frontend/e2e/agent-detail.spec.ts`：既有測試斷言折線 `<polyline>`
  數量/`points` 屬性（含 `pointCounts`）、表格 `<th>` 日期文字
  （`dateHeaders`，第 184 行 `toEqual`，比較的是表格欄位文字陣列與預
  期日期陣列，與 SVG 內容無關）、圖例 `<li>` 數量——**沒有任何測試斷
  言 SVG 內是否存在 `<text>`（Y 軸標示）或 X 軸座標相關元素**，本票
  新增的 `<text>`/`<line>` 不會與既有斷言衝突，但開發者需要新增對應
  測試覆蓋本票 2 條 Gherkin 情境（AC 對應測試是開發者工作，非本設計
  文件範圍，僅在此記錄現狀供開發者承接）。
- 全 repo `Grep("toEqual|一致|getComputedStyle", frontend/e2e/)`：命中
  `frontend/e2e/agent-detail.spec.ts:184`（表格日期欄位文字陣列比
  較，與本票選擇器無關）、`frontend/e2e/agent-detail.spec.ts:241,287`
  （`pointCounts` 排序比較，折線點數，與本票無關）、
  `frontend/e2e/trace-detail.spec.ts:95,97`（`<tr>` 子列 `paddingLeft`
  與另一列的既有縮排一致性測試，與 `VersionCostChart` 或其子選擇器
  `polyline`/`text`/`line`/`ul li`/`table` 完全無關的獨立元件）。**沒
  有任何測試比較 `VersionCostChart` 內的任何選擇器與其他元件的
  computed style 相等**，本票新增的 `<line>`/`<text>` 不會觸發任何跨
  元素樣式耦合測試鏈，SDLCCT-78 不適用跨元素樣式耦合測試檢查。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點，純前端渲染層改動，消費的資料形狀
（`VersionCostSeriesEntry[]`、`anchorDate`）與既有完全相同。

## 資料模型

無新增資料模型。X 軸標籤要顯示的日期直接取自既有 `dates` 陣列（第
`dateIndex` 索引對應第幾天），格線高度直接取自既有 `labels` 陣列的
`y` 欄位，皆為既有資料的重用，不新增 props/state。

## 關鍵技術決策

### 1. X 軸日期標籤密度：恰好標示 `dates[0]`（D-6）與 `dates[6]`（D）兩個端點；中間最多再加 1 個（`dates[3]`，置中）

```ts
// dates.length === 7 固定（fixedSevenDates，SDLCCT-72）
const xAxisLabelIndices = dates.length >= 3 ? [0, 3, dates.length - 1] : [0, dates.length - 1];
```

- 驗收情境 1 字面要求只需「至少 2 個」且對應 D-6 與 D，本票選擇固定
  輸出 3 個（頭、中、尾）而不是只輸出 2 個：7 天只標頭尾在 480px 寬
  下中段跨度較大（約 320px 的視覺空白沒有任何刻度參照），加入置中的
  第 4 個資料點（索引 3）在不violate「不需每天都標」這個 spec 給定上
  限的前提下提供更好的可讀性，且 3 個標籤 ×「YYYY年MM月DD日」格式的
  `formatTaiwanDate` 長字串在 480px 寬仍有足夠間距不致重疊（見下方
  決策 1b 的字級/寬度核算）。**不標示全部 7 天**：spec 明文「不需每
  天都標」，且 7 個完整長格式日期字串在 480px 內必然互相重疊，標示
  全部 7 天會直接違反可讀性，不在考慮範圍內。
- 三個索引的選取原則記錄於 `docs/design-system.md` 新增子項（見下方
  「設計系統文件」段落），供 SDLCCT-79/80 或未來改動資料點數量
  （目前固定 7，若未來某票改變）時依循同一套「頭尾必標、中間视寬度
  至多加 1 個置中點」規則，不需要每次重新決定。

### 1b. 標籤文字排版：`text-anchor` 依位置分三種，`font-size=10`，垂直位置在 `CHART_HEIGHT` 下方新增的留白區

既有 `CHART_HEIGHT = 160`、`CHART_PADDING = 24` 的 `innerHeight` 已把
垂直空間用滿（`innerHeight = 160 - 24*2 = 112`，`yFor(min)` 底部恰好
落在 `CHART_PADDING + innerHeight = 136`，距離 `CHART_HEIGHT=160` 僅
剩 24px）。X 軸日期標籤若要清楚地畫在折線下方、不與折線或 Y 軸標示重
疊，需要這段既有底部留白（24px）放 `font-size=10` 的單行文字——核算
10px 字高 + 上下 padding 綽綽有餘，**不需要調大 `CHART_HEIGHT`**（調
大會改變既有 `viewBox`/縮放比例，波及本票範圍外的既有折線/Y 軸標示
幾何，不在本票範圍內）：

```ts
const X_AXIS_LABEL_Y = CHART_HEIGHT - 6; // 底部留白區內，貼近下緣

{xAxisLabelIndices.map((i) => (
  <text
    key={`x-${dates[i]}`}
    x={toXFor(i)}            // 重用既有 toXY 的 x 分支公式
    y={X_AXIS_LABEL_Y}
    textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
    fontSize={10}
    fill="var(--color-text-secondary)"
  >
    {formatTaiwanDate(dates[i])}
  </text>
))}
```

- `textAnchor` 依位置分三種（頭 `start`、尾 `end`、中 `middle`）：頭
  尾若都用 `middle`，標籤文字會以該資料點為中心向兩側延伸，頭部標籤
  左半會延伸到 `x<0`（viewBox 外，依 SDLCCT-73 決策 2 同理會被裁
  切），尾部標籤右半會延伸到 `x>480`——與 Y 軸標示（SDLCCT-73 決策
  2）處理「文字不可被裁切到無法閱讀」是同一類取捨，此處用 `start`/
  `end` 讓頭尾標籤整串文字都落在 viewBox 內，是比「全部 `middle`」更
  不易裁切的選擇。中間標籤用 `middle` 是因為它兩側都還有空間，沒有
  裁切風險。
- 需要把 `toXY` 內的 x 座標公式同樣抽成獨立函式 `xFor(dateIndex)`
  （與 SDLCCT-73 把 y 座標抽成 `yFor(value)` 同一手法），讓 X 軸標籤
  與折線資料點共用同一套 x 換算，保證兩者在任何 `dates.length` 下都
  精確對齊：
  ```ts
  const xFor = (dateIndex: number) =>
    dates.length > 1
      ? CHART_PADDING + (dateIndex / (dates.length - 1)) * innerWidth
      : CHART_PADDING + innerWidth / 2;

  const toXY = (dateIndex: number, value: number) =>
    `${xFor(dateIndex).toFixed(1)},${yFor(value).toFixed(1)}`;
  ```
  這是對既有程式碼的重構（抽函式），`toXY` 輸出字串與既有行為完全相
  同，不改變既有折線渲染邏輯，符合 spec 範圍外限制。

### 2. 格線顏色：`var(--color-border)`（`#E5E7EB`），而非另訂一個更淡的新顏色

spec 字面給了兩個選項（「`border` token 或更淡的中性色」），本票選
擇直接沿用既有 `--color-border` token，不新增顏色值：

- `#E5E7EB` 與 `COLORS` 陣列 6 色（`#2a78d6`/`#eb6834`/`#1baf7a`/
  `#eda100`/`#e87ba4`/`#008300`）在色相與明度上皆明顯區隔（`#E5E7EB`
  是接近白的中性灰，6 色皆為中高飽和度色相），肉眼與機器判斷（例如
  e2e 斷言 `stroke`/`style.stroke` 屬性字串不等於這 6 個色值）都不會
  混淆，滿足情境 2「格線顏色不是任何版本線的色票顏色」的字面要求。
- 不另訂新顏色值的理由：`docs/design-system.md` 色彩系統（§1）目前
  只有 5 個 token，新增一個「圖表格線專用淡色」會讓 token 數量膨脹
  且需要重新跑一次 WCAG/對比驗證（§1 的「如何驗證」段落：新增 token
  必須重新計算對比）——`--color-border` 本來就不是文字色、不受
  WCAG 文字對比門檻限制（§1 已說明），語意上（分隔線/邊框）也與
  「淡化格線不可搶過資料線」的視覺需求一致，直接沿用是最小變更。
- 格線不透明度：直接用 `--color-border` 的原始 `#E5E7EB`（不額外疊
  加 `opacity`），因為該色本身已經是淡灰、相對 `COLORS` 的高飽和度色
  相已足夠「淡化」，不需要再疊一層 opacity 增加渲染複雜度。

### 3. 格線渲染：`<line>` 元素，`x1=CHART_PADDING, x2=CHART_WIDTH - CHART_PADDING`，直接消費 `labels[].y`，插入在 `<polyline>` 之前

```ts
<g>
  {labels.map((label) => (
    <line
      key={`grid-${label.key}`}
      x1={CHART_PADDING}
      x2={CHART_WIDTH - CHART_PADDING}
      y1={label.y}
      y2={label.y}
      stroke="var(--color-border)"
      strokeWidth={1}
    />
  ))}
</g>
```

- 橫跨圖表寬度：`x1=CHART_PADDING`、`x2=CHART_WIDTH - CHART_PADDING`
  （即 `innerWidth` 的左右邊界，與折線資料點可能出現的 x 範圍一
  致）——比「橫跨整個 480 viewBox 寬度（含左右 padding）」更貼合
  「格線對齊資料繪圖區」的語意，且與 Y 軸標示文字（`x=2`，落在
  padding 區內）不重疊。
- 插入順序：**格線必須在所有 `<polyline>` 之前渲染**（DOM 順序決定
  SVG 繪製順序，先畫的在視覺上在底層）——格線是背景參照線，資料線
  （折線）必須蓋在格線之上才不會被格線「蓋住資料本身」（spec 原文
  「不可搶過資料線本身」），這與 SDLCCT-73 的 Y 軸文字標示故意排在
  `<polyline>` 之後（蓋在折線上方，因為是數值標註需要可讀）正好是相
  反的分層考量，兩者目的不同不可混用同一順序規則。
- 直接消費 `labels` 陣列而非重新呼叫 `yFor`：見「現狀查核」段落已說
  明理由（避免兩處計算結果理論相等但來源不同造成的維護風險）。
- `allValues.length === 0`（無資料）時 `labels` 為空陣列，格線自然
  不渲染——沿用 SDLCCT-73 既有的「無資料不臆測」防呆分支，本票不需
  要另外新增判斷。

## UI 原型

`docs/design/SDLCCT-78-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，沿用 `docs/design/SDLCCT-75-prototype.html` 相同的色彩/字級
token 與版面骨架）。涵蓋 2 個區塊，對應 2 條 Gherkin 情境：

- 情境 1：7 天資料的折線圖，X 軸標示 3 個日期標籤（D-6／D-3／D，
  `textAnchor` 分別為 start/middle/end），並列出下方表格對照，標籤文
  字與表格欄位文字逐一比對一致。
- 情境 2：同一張圖疊加兩條水平淡化格線，對齊既有 max/min 金額標示高
  度，並以文字註記格線顏色（`#E5E7EB`）與色票 6 色（`#2a78d6` 等）的
  對照色塊，供肉眼確認格線顏色不是任何版本線顏色。

本票是對既有圖表的小幅視覺疊加（新增至多 3 個 `<text>` 與至多 2 個
`<line>`），不新增頁面/版面配置，故原型只聚焦圖表本身，不重複
`docs/design/SDLCCT-48-prototype.html` 已涵蓋的整頁版面，比例上符合
CONSTITUTION「設計文件應與故事規模成比例：小改動用短設計」。

## 設計系統文件異動（本票同時交付）

`docs/design-system.md` §11「資料視覺化」新增子項「圖表軸線與格
線」，內容對應上方關鍵技術決策 1-3 定案的規則：

- X 軸日期標籤密度上限：7 個資料點時固定標示頭、尾兩點，視寬度至多
  再加 1 個置中點（共 3 個），不逐日標示。
- 格線顏色：固定使用 `--color-border`（`#E5E7EB`），不另訂淡色
  token；格線需與分類色票（§11 既有表格）的 8 個色值明顯區隔，不可
  選到與任一順位相近的淡色。
- 格線繪製順序：格線在資料線（`<polyline>`/長條等）之前渲染，不可蓋
  過資料本身。

此為本票範圍內的文件交付（spec 第 3 點明文要求），由開發者在同一個
PR 內一併完成 `docs/design-system.md` 的編輯（append 既有章節，不可
重寫/刪減既有內容）。

## 開放設計問題（定稿時必須為空）

（無）
