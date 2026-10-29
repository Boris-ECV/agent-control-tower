# 設計文件 — SDLCCT-79 版本成本圖表線條終點直接標籤

## 對應需求規格

對應 G1 已核准的需求規格「版本成本圖表 — 線條終點直接標籤」
（SDLCCT-77 拆分出的第二張子票）。2 條 Gherkin 情境（已定稿）：

1. `version_cost_series` 有 2 個 version（≤ 4）時：每條線最後一個有值
   的資料點旁顯示該版本名稱與金額的文字標籤；圖表下方不再顯示另一排
   圖例色點＋文字。
2. `version_cost_series` 有 5 個 version（> 4）時：線條終點不顯示直接
   標籤；圖表下方顯示圖例色點＋文字列出全部 5 個版本（維持現狀）。

**範圍外**（spec 已標明）：不處理 X 軸刻度或格線（SDLCCT-78，已
Done，本票不依賴其結果）；不處理 hover/tooltip（SDLCCT-80，另一張
票）；不處理 SDLCCT-76 的資料正確性（本票純前端視覺層）；不引入圖表
函式庫；不改變 Y 軸自動縮放邏輯。

**依賴**：與 SDLCCT-78（已 Done）、SDLCCT-80 同一檔案
（`frontend/components/agent-detail/version-cost-chart.tsx`）及同一文
件章節（`docs/design-system.md` 第 11 節），建議依 78 → 79 → 80 順序
合併以減少衝突，非硬性阻斷。

## 現狀查核（實作前已逐字讀取的既有程式碼，含 SDLCCT-78 已合併的變更）

- `frontend/components/agent-detail/version-cost-chart.tsx`（本票唯一
  要改動的元件檔案，目前 227 行）：
  - `CHART_WIDTH=480`、`CHART_HEIGHT=160`、`CHART_PADDING=24`，
    `innerWidth=innerHeight` 皆為 `CHART_* - CHART_PADDING * 2`
    （`innerWidth=432`、`innerHeight=112`）。
  - `xFor(dateIndex)`（SDLCCT-78 已抽出的獨立函式）：
    ```ts
    const xFor = (dateIndex: number) =>
      dates.length > 1
        ? CHART_PADDING + (dateIndex / (dates.length - 1)) * innerWidth
        : CHART_PADDING + innerWidth / 2;
    ```
  - `yFor(value)`（SDLCCT-73 已抽出的獨立函式，除以零防呆收斂到置中
    高度）。
  - `byDate(entry)`（既有函式，第 89-92 行）：把 `entry.points` 轉成
    與固定 7 天 `dates` 陣列長度相同、依日期對齊的 `(number | null)[]`
    （缺日期視為 `null`，與明確 `value: null` 等價，SDLCCT-72 既有規
    則）：
    ```ts
    const byDate = (entry: VersionCostSeriesEntry) => {
      const map = new Map(entry.points.map((p) => [p.date, p.value]));
      return dates.map((date) => map.get(date) ?? null);
    };
    ```
    折線渲染（第 121-149 行）與表格渲染（第 210-223 行）都已呼叫
    `byDate(entry)` 取得這個對齊後的 `values` 陣列——**本票的「最後
    一個有值的點」判斷必須重用同一個 `values` 陣列**，不可另外重新解
    析 `entry.points`，否則「有值」的定義（含缺日期視為 null）可能與
    折線斷點邏輯不一致。
  - 折線渲染目前的 `segments` 建構邏輯（第 123-133 行）：依序走訪
    `values`，`null` 處切斷目前的 `current` 陣列並開新段，最後把尚未
    收尾的 `current` 推進 `segments`。**本票不需要修改這段邏輯**，只
    需要在同一個 `entries.map` 迴圈裡，用同一個 `values` 陣列另外算
    出「最後一個非 null 索引」。
  - `COLORS` 陣列（第 15 行）：`["#2a78d6", "#eb6834", "#1baf7a",
    "#eda100", "#e87ba4", "#008300"]`，依 `entryIndex % COLORS.length`
    輪替，折線 `stroke` 目前就是用這個值（第 135 行 `color`）。
  - 圖例 `<ul>`（第 184-194 行）：
    ```tsx
    <ul className="mb-4 flex flex-wrap gap-3 p-0 text-xs text-text-secondary">
      {entries.map((entry, entryIndex) => (
        <li key={entry.version} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: COLORS[entryIndex % COLORS.length] }} />
          {entry.version}
        </li>
      ))}
    </ul>
    ```
    這是 `<svg>` 之後、`<table>` 之前的獨立 HTML 區塊（非 SVG 內容），
    本票依 entries 數量決定整段是否渲染（見關鍵技術決策 3）。
  - `formatCurrency`/`t` 皆為既有 import；`formatCurrency` 簽名見下。
  - `<svg>` 目前子元素渲染順序（SDLCCT-78 之後）：格線 `<g>` → 各版本
    `<polyline>`（依 `entries` 順序一個 `<g key={entry.version}>` 包一
    組 `segments`）→ `<g data-axis="y">` Y 軸金額標示 → `<g
    data-axis="x">` X 軸日期標籤。**本票新增的終點直接標籤插入在既有
    順序的最後**（所有折線與軸線標籤之後），理由見決策 2。
- `frontend/lib/format.ts::formatCurrency(value: number | null |
  undefined): string`：`null`/`undefined` → `"—"`；非 0 整數 → 千分位
  `US$ 1,234`；絕對值 < 100 且非 0 → 兩位小數。本票傳入的一定是
  `values[lastValidIndex]`，依定義非 `null`（否則不會被選為「最後一
  個有值的點」），不會把 `null`/`undefined` 傳進 `formatCurrency`，不
  需要額外的 `—` 分支。
- `docs/design-system.md` §11「資料視覺化」目前有 11.1「圖表軸線與格
  線」（SDLCCT-78 新增），尚無「直接標籤」子項（本票要新增的 11.2）。
  §11 本體的分類色票表格（固定順位 1-8）與「使用限制」（超過 3 色須
  搭配圖例文字或資料標籤輔助辨識）維持不動，本票新增的直接標籤正是
  「資料標籤輔助辨識」的落地之一，與既有規則一致、不衝突。
- `frontend/e2e/agent-detail.spec.ts`：
  - 第 140-142 行（SDLCCT-72 情境，2 個 version）：
    ```ts
    // The legend lists exactly one entry per version, matching the series count.
    await expect(page.locator("ul li", { hasText: "v1" })).toHaveCount(1);
    await expect(page.locator("ul li", { hasText: "v2" })).toHaveCount(1);
    ```
    **本票會讓這個斷言失敗**：2 個 version（≤ 4）依本票規則要移除圖例
    `<ul>`，`ul li` 將不存在。這不是跨元素 computed-style 相等測試
    （不符合「樣式耦合」定義），是功能性存在斷言，需要開發者在同一個
    PR 內一併更新（改成斷言終點直接標籤的文字，或改用別的 fixture 把
    version 數量調整為 > 4 以維持原測試意圖）——**這是本票必然影響的
    既有測試，記錄於此供 developer 承接，不是本設計文件的開放問
    題**（spec 已明確定案「版本數 ≤ 4 時取代圖例」，測試更新是落實既
    定規格的工程工作，不是需要 PM 決策的產品問題）。
  - 其餘 `pointCounts`/`dateHeaders` 相關斷言（第 131-138、184-192、
    238-241、284-287 行）斷言的是 `<polyline>` 的 `points` 屬性與
    `<table>` 的 `<th>` 文字，與本票新增的終點標籤 `<text>`、圖例
    `<ul>` 的存在與否無關，不受影響。
- 全 repo `Grep("toEqual|一致|getComputedStyle", frontend/e2e/)`：命中
  `frontend/e2e/agent-detail.spec.ts:184,241,287`（表格日期欄位文字/
  折線點數比較，與本票選擇器無關）、`frontend/e2e/trace-detail.spec.ts
  :95,97`（`<tr>` 子列 `paddingLeft` 與另一列的既有縮排一致性測試，
  與 `VersionCostChart` 或其子選擇器 `polyline`/`text`/`ul li`/`table`
  完全無關的獨立元件）。**沒有任何測試比較 `VersionCostChart` 內的任
  何選擇器與其他元件的 computed style 相等**，本票新增/移除的
  `<text>`/`<ul>` 不會觸發任何跨元素樣式耦合測試鏈，跨元素樣式耦合測
  試檢查不適用於本票。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點，純前端渲染層改動，消費的資料形狀
（`VersionCostSeriesEntry[]`、`anchorDate`）與既有完全相同。

## 資料模型

無新增資料模型。終點直接標籤要顯示的版本名稱與金額，直接取自既有
`entries[].version` 與既有 `byDate(entry)` 算出的 `values` 陣列（重
用現狀，不新增 props/state）。

## 關鍵技術決策

### 1. 「最後一個有值的點」：對每個 entry 重用 `byDate(entry)` 的 `values` 陣列，從陣列尾端往前找第一個 `!== null` 的索引

```ts
const lastValidIndex = (values: (number | null)[]): number => {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return i;
  }
  return -1; // 該 entry 全部日期皆無值（全 null），不渲染終點標籤
};
```

在既有 `entries.map((entry, entryIndex) => { const values = byDate(entry); ... })`
迴圈內（第 121-149 行既有迴圈，與折線渲染同一個迴圈，避免重複呼叫
`byDate`）直接呼叫：

```ts
const values = byDate(entry);
// ...既有 segments 建構邏輯，原樣不動...
const tailIndex = lastValidIndex(values);
const tailPoint =
  tailIndex === -1 ? null : { x: xFor(tailIndex), y: yFor(values[tailIndex] as number) };
```

- 重用 `byDate(entry)` 而不是重新解析 `entry.points`：「現狀查核」已
  說明 `byDate` 已把「缺日期」與「明確 `value: null`」統一為陣列中的
  `null`（SDLCCT-72 既定規則），折線斷點判斷正是依賴這個統一後的陣
  列；本票的「有值」判斷若另外重新解析 `entry.points`，會在「版本只
  在部分日期回報資料」的情境下與折線斷點邏輯用到不同的「有值」定義，
  產生標籤位置與折線終點視覺上不一致的風險。
- `tailIndex === -1`（entry 全部 7 天皆為 null）時不渲染該 entry 的終
  點標籤：此時該 entry 本來就不會畫出任何 `<polyline>`（既有
  `segments` 邏輯使 `segments` 維持空陣列），沒有「終點」可標，是現
  狀既有的「無資料不臆測」防呆分支（CONSTITUTION「缺值顯示未知，不
  顯示 0」）的自然延伸，不需要另外發明新邏輯。
- `xFor(tailIndex)`/`yFor(value)` 直接重用 SDLCCT-78/73 已抽出的既有
  函式，與折線資料點、X/Y 軸標籤共用同一套座標換算，保證標籤位置與
  該版本折線的視覺終點精確對齊（不會有「標籤畫歪」的風險，與
  SDLCCT-73/78 的既有決策同一原則）。

### 2. 標籤文字：`${entry.version} ${formatCurrency(values[tailIndex])}`，`fill` 採該版本的折線顏色，`font-size=10`

```tsx
<text
  x={tailPoint.x + dx}
  y={tailPoint.y}
  textAnchor={anchor}
  fontSize={10}
  fill={color} // 與同一 entry 的 <polyline> stroke 同一色值
  dominantBaseline="middle"
>
  {`${entry.version} ${formatCurrency(values[tailIndex] as number)}`}
</text>
```

- 文字內容「版本名稱＋金額」是 spec 字面要求；兩者以一個空白字元連
  接成單一 `<text>` 節點（而非拆成兩個 `<text>` 或 `<tspan>`），因為
  規格只要求「旁邊直接標示」兩個資訊，未要求可分別獨立定位/換行，單
  一字串是最簡單、不過度工程化的落地方式。
- `formatCurrency(values[tailIndex] as number)`：直接重用既有格式化
  函式（表格欄位、Y 軸標示皆用同一函式），保證本票新增的終點標籤與
  下方表格/既有 Y 軸標示的金額格式一致，不另外維護一份格式邏輯。
- `fill` 採該 entry 折線的顏色（`COLORS[entryIndex % COLORS.length]`，
  與既有 `<polyline stroke={color}>` 同一變數）而非統一用
  `--color-text-secondary`：spec 明文「取代」圖例色點＋文字——圖例原
  本就是「色點＋版本名稱文字」的配對，讓終點標籤本身帶有同一色彩，
  才能延續「顏色 ↔ 版本」的視覺對應關係，不需要使用者再去別處查色
  票，這是「直接標籤取代圖例」在視覺上成立的必要條件，不是額外加
  碼。
- `font-size=10`：與既有 X/Y 軸標籤（SDLCCT-73/78）同一字級，維持本
  元件內 SVG 文字字級一致，不另訂新字級。

### 3. 標籤定位與防裁切：依終點 x 落在繪圖區左半或右半決定 `textAnchor`／位移方向；垂直置中於該點 y

```ts
const plotMidX = CHART_PADDING + innerWidth / 2; // 240
const anchor: "start" | "end" = tailPoint.x >= plotMidX ? "end" : "start";
const dx = anchor === "end" ? -6 : 6;
```

- **判斷依據是「終點 x 落在繪圖區左半或右半」，不是「是否恰好是陣列
  最後一個索引（第 6 天）」**：某版本的最後一個有值的點未必落在
  `dateIndex = 6`（第 6 天之後可能是缺資料的 null），終點 x 可能落在
  繪圖區中段，此時用「是否為陣列尾端」判斷會誤判。改用與繪圖區中點
  `plotMidX = CHART_PADDING + innerWidth / 2 = 240` 的相對位置判斷，
  對任意 `tailIndex`（0-6）皆成立。
- `tailPoint.x >= plotMidX`（右半，`x ∈ [240, 456]`）→
  `textAnchor="end"`、`dx=-6`：文字以終點為右端往左延伸，向左有
  `240` 以上的 viewBox 空間可用，不會被右邊緣（`x=480`）裁切——與
  SDLCCT-73 決策 2（Y 軸標示選 `start` 避免右側裁切）、SDLCCT-78 決策
  1b（尾端標籤選 `end` 避免右側裁切）是同一套「讓文字往有空間的方向
  延伸」原則，本票在「終點可能落在繪圖區任意 x」這個更一般的情境下
  把該原則參數化成「依中點判斷」而不是「依陣列固定頭/尾索引判
  斷」，因為本票（不同於 SDLCCT-78 的固定 3 個索引）的終點索引是依
  各版本資料動態決定的。
- `tailPoint.x < plotMidX`（左半，`x ∈ [24, 240)`）→
  `textAnchor="start"`、`dx=6`：文字以終點為左端往右延伸，向右同樣有
  `216` 以上空間可用。
- `dx = ±6`：與該資料點的折線終點保持 6px 視覺間距（spec「旁邊」字面
  要求），避免文字第一個/最後一個字元直接疊在折線端點上難以辨讀；
  `6` 是本票在既定字級（10px）下的具體落地值（約略一個字元寬度的一
  半），不是另訂新的間距 token（間距 scale 第 4 節是給 HTML
  padding/margin 用，SVG 座標位移沿用 SDLCCT-73/78 既有「SVG 文字直
  接用像素數值位移」的慣例，不套用該 scale）。
- `dominantBaseline="middle"`：讓文字垂直置中對齊 `tailPoint.y`，與既
  有 Y 軸標示（SDLCCT-73 決策 2）同一慣例，不需要額外的垂直位移。
- **本票不處理「文字長度過長仍可能超出 viewBox」的像素級精算**：與
  SDLCCT-73 決策 4 同一取捨——規格與既有測試風格都是以座標/存在性為
  驗證基準，不是渲染後的像素外框碰撞檢測；版本名稱長度不是本票範圍
  內可控的輸入（上游資料），比照 SDLCCT-73 的既有判斷不再另外處理。
- 渲染插入順序：此 `<g data-labels="tail">` 插入在既有 `<svg>` 內容
  最後（所有 `<polyline>` 與既有 `<g data-axis="y"/"x">` 之後），保
  證標籤文字在視覺堆疊順序上位於最上層、不被任何折線或軸線蓋住，與
  SDLCCT-73 決策 3 的既有理由（文字需要可讀，排在資料線之後）一致。

### 4. 版本數門檻：`entries.length > 4` 時不渲染終點標籤、恢復圖例；`entries.length <= 4` 時渲染終點標籤、移除圖例 `<ul>`

```ts
const showTailLabels = entries.length <= 4;
```

- `<g data-labels="tail">` 只在 `showTailLabels` 為真時渲染（內容即
  決策 1-3 算出的每個 entry 的終點標籤）；為假時完全不渲染（連空
  `<g>` 也不輸出，避免 DOM 中留下無意義的空節點）。
- 既有圖例 `<ul>`（第 184-194 行）整段改成 `{!showTailLabels && (
  <ul>...</ul> )}`——`entries.length <= 4` 時整段不渲染（spec「取代」
  字面要求：直接標籤出現時圖例必須消失，不是兩者並存）；
  `entries.length > 4` 時圖例內容/樣式完全不變（既有 `<li>`/色點/
  `className` 原樣保留），對應情境 2「圖表下方顯示圖例色點＋文字列
  出全部 5 個版本」。
- 門檻值 `4` 直接取自 spec 字面定案的數字（spec 原文「版本數 > 4
  時...門檻＝4」），不是本設計自行推導或另訂——spec 已經把這個產品
  決策做完，本票只需要落地成程式碼中的具體比較式，不是開放設計問
  題。
- `<table>` 與其列的欄位內容（版本名稱＋每日金額）完全不受本票影
  響，兩種分支下皆保持原樣渲染，繼續作為「完整數值」的落地（直接標
  籤/圖例都只標示「終點」或「版本名稱」，表格才是唯一同時提供全部
  7 天數值的區塊）。

## UI 原型

`docs/design/SDLCCT-79-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，沿用 `docs/design/SDLCCT-78-prototype.html` 相同的色彩/字級
token 與版面骨架）。涵蓋 2 個區塊，逐一對應 2 條 Gherkin 情境：

- 情境 1（2 個 version，≤ 4）：兩條折線，終點旁各有一個與該折線同色
  的文字標籤（`v1 US$ 140` / `v2 US$ 400`），`textAnchor` 依終點落在
  繪圖區左/右半分別示範 `start`/`end` 兩種情況；下方**不**出現圖例
  `<ul>`。
- 情境 2（5 個 version，> 4）：五條折線，線條終點**不**出現任何直接
  標籤；下方出現圖例色點＋文字，列出全部 5 個版本（沿用現狀樣式）。

本票是對既有圖表的小幅視覺變更（新增至多 4 個終點 `<text>`、依條件
移除既有圖例 `<ul>`），不新增頁面/版面配置，故原型只聚焦圖表本身兩
種狀態的呈現，不重複 `docs/design/SDLCCT-48-prototype.html` 已涵蓋
的整頁版面，比例上符合 CONSTITUTION「設計文件應與故事規模成比例：
小改動用短設計」。

## 設計系統文件異動（本票同時交付）

`docs/design-system.md` §11「資料視覺化」新增子項 11.2「直接標
籤」（接續 SDLCCT-78 已新增的 11.1「圖表軸線與格線」），內容對應上
方關鍵技術決策 1-4 定案的規則：

- 直接標籤 vs 圖例的選用門檻：資料序列數 ≤ 4 時優先使用線條終點直
  接標籤（版本/序列名稱＋對應數值），並移除另一排圖例色點＋文字；
  序列數 > 4 時直接標籤互相重疊風險高，退回純圖例顯示，不嘗試同時
  顯示兩者。
- 直接標籤文字顏色採該序列本身的色票顏色（而非中性說明文字色），延
  續「顏色 ↔ 序列」的視覺對應，取代圖例原本靠色點建立的同一對應關
  係。
- 直接標籤定位：依標籤所在位置與繪圖區中點的左右關係決定文字錨點方
  向（左半 `start`、右半 `end`），讓文字往有空間的一側延伸，避免被
  繪圖區邊界裁切；此為選擇性直接標籤原則的具體延伸——不要求每個資
  料點都標，只標終點（或視覺上最具代表性的點）。

此為本票範圍內的文件交付（spec 第 3 點明文要求），由開發者在同一個
PR 內一併完成 `docs/design-system.md` 的編輯（append 既有章節，不可
重寫/刪減既有內容）。

## 開放設計問題（定稿時必須為空）

（無）
