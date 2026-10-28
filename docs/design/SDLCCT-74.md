# 設計文件 — SDLCCT-74 執行清單「最貴執行清單」的中繼資料欄位直接顯示原始 JSON，應整理成可讀欄位

## 對應需求規格

對應 G1 已核准的需求規格：Agent 詳情頁「最貴執行清單」（SDLCCT-48
`TopTracesTable`，`frontend/components/agent-detail/top-traces-table.tsx`）
的 `metadata` 欄目前直接 `JSON.stringify(trace.metadata)` 顯示原始 JSON
字串，應整理成可讀欄位。4 條 Gherkin AC（已定稿）：

1. 常用欄位皆存在時（`plant`/`deployed_version`/`dept`/`trigger`）以 4 個
   標籤顯示，其餘欄位（`providers`/`cost_center`/`workflow`/未知 key）
   預設收合。
2. 展開「更多」控制項可查看收合區塊的其餘欄位 `key:value`，再次點擊可
   收回。
3. 常用欄位缺少其中一項（如 `dept`）時只顯示存在的標籤，不顯示空白/
   undefined/null 文字；不存在的欄位（如 `cost_center`）也不出現在收合
   區塊。
4. `metadata` 為 `null` 時維持既有行為（顯示 `t("agentDetail.unknown")`），
   不嘗試渲染標籤或展開控制項。

**範圍外**（spec 已標明，本文件不觸碰）：不做人話句子（不同於
SDLCCT-65）；不重新設計整張表格版面；不變更 `metadata` 來源/BFF 契約
（`TopTraceItem.metadata: dict | None` 不變）；不處理未知 key 的語意翻
譯（原樣 `key:value` 顯示於收合區）；不改變既有點擊整列導覽行為
（SDLCCT-56）。

依賴：SDLCCT-47（後端，無需變更，已確認）；SDLCCT-48（前端
`top-traces-table.tsx` 原始實作，本票唯一修改對象）；SDLCCT-56（已在同
一檔案的 `<tr>` 加上整列點擊導覽到執行詳情頁，本票新增的展開控制項必
須不觸發該導覽，見下方決策 4）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/top-traces-table.tsx`（第 1-64
  行）：`metadata === null` 時顯示 `t("agentDetail.unknown")`；非 null
  時第 54-56 行 `<code className="text-xs break-all">
  {JSON.stringify(trace.metadata)}</code>`——本票唯一要改的那一段。整
  列 `<tr>` 已有 `onClick={() => goToTrace(trace.id)}` +
  `onKeyDown`（Enter/Space 觸發同一導覽，SDLCCT-56 新增），`role="button"
  tabIndex={0}`——本票新增的展開控制項必須阻止事件冒泡到這個 `<tr>`
  （見決策 4），否則點擊「更多」會意外導覽離開整頁。
- `bff/api/schemas.py::TopTraceItem.metadata: dict | None`——未型別化,
  SDLCCT-47 決策 4 已定案只保證 `id`/`metadata` 本身存在，內容結構不驗
  證，本票不變更此型別（範圍外已標明）。
- `seed/generate.py` 第 142-148 行：目前模擬資料實際產生的 key 集合是
  `plant`/`deployed_version`/`cost_center`/`workflow`/`trigger`/`dept`
  共 6 個，**不含** `providers`——requirements-analyst 已核查此點，證實
  真實（Opik）資料的 key 集合可能超出這 6 個已知 key（spec 範例中的
  `providers` 即是一例），本票的「收合區顯示任意未知 key」設計（AC1）
  正是為了涵蓋這個已確認的真實情境，不是臆測。4 個常用欄位
  `plant`/`deployed_version`/`dept`/`trigger` 皆在這個已知集合內，其餘
  2 個已知 key（`cost_center`/`workflow`）連同任何未來新增的未知 key
  一起落入收合區（AC1 字面本身也把 `cost_center`/`workflow` 列為收合
  區範例，與現狀查核結果一致）。
- `frontend/components/trace-detail/span-tree-row.tsx::GroupSpanRow`
  （第 54-94 行，SDLCCT-56）：本 repo 目前唯一的「per-row 可展開/收合」
  既有慣例——`const [expanded, setExpanded] = useState(false)` 宣告在
  每個 `GroupSpanRow` 元件實例內部（每一組同名 span 各自一個元件實例，
  狀態天然隔離，不需要額外的 per-row key 管理），控制項是
  `<button type="button" aria-expanded={expanded}
  onClick={() => setExpanded((v) => !v)}>`，文案取自
  `t("traceDetail.expand")`/`t("traceDetail.collapse")` 依
  `expanded` 切換。本票沿用同一慣例（見決策 1），不使用 `<details>`/
  `<summary>`（這個 repo 目前零 `<details>` 先例，`GroupSpanRow` 已經
  是現成、已被人類核准過一次的解法）。
- `frontend/lib/i18n/messages.ts` 第 131-162 行：既有 `agentDetail`
  命名空間，`topTraces.table.columns.{id,cost}`
  （第 153-155 行略過，已含 `id`/`cost`）與第 161 行
  `unknown: "—"`。本票在這個既有命名空間下純附加新 key（見下方介面契
  約段落），不更動既有任何 key 的值。
- 全 repo `Grep("toEqual|getComputedStyle|一致|consistent",
  path="frontend/e2e")` 只命中 `frontend/e2e/trace-detail.spec.ts`
  第 95/97 行——比對的是 span 樹縮排的 `paddingLeft`
  （`SpanLine`/`SpanTreeRow` 的 `depth * INDENT_PX`），與本票要改的
  `TopTracesTable` 的 `metadata` 欄位完全無關的 selector/元件。**不存
  在任何比較本票將變更的 selector 的跨元素樣式一致性鏈式斷言**，跨元
  素樣式耦合測試檢查不適用於本票。
- `frontend/e2e/agent-detail.spec.ts`：兩處既有斷言直接依賴
  `JSON.stringify(metadata)` 的原始輸出格式，會被本票的行為變更直接
  打破（**不是**跨元素樣式耦合測試，是本票 spec 要求的行為變更的直接
  後果，比照 SDLCCT-56 設計文件決策 1 對既有測試失效的記錄方式，先在
  此處記下避免留給開發者自行發現）：
  - 第 40/74 行：mock `metadata: { user_id: "u1" }`，第 74/199 行斷言
    `page.getByText('{"user_id":"u1"}')` 可見。`user_id` 不在本票任何
    一個常用欄位常數裡（AC1 的 4 個常用欄位是
    `plant`/`deployed_version`/`dept`/`trigger`），依新設計會落入收合
    區（展開後以 `user_id: u1` 文字呈現，不再是 JSON 字串），這兩條斷
    言在開發階段需要同步改寫（例如改為先點擊「更多」展開，再斷言
    `user_id: u1` 文字可見）。
  - 第 189-199 行（獨立測試「AC4: top_traces metadata column renders a
    populated dict as JSON and a null metadata as —」）：測試名稱與斷
    言本身整個綁定「渲染成 JSON」這個即將被本票取代的行為，需要重寫
    （null 分支第 201-202 行的 `—` 斷言可以保留，因為 AC4「null 維持
    既有行為」沒有變；非 null 分支需要改成斷言新的標籤/收合行為）。

## 介面/API 契約

無變更。本票純前端展示層重構，不新增/變更任何 bff 端點或 response
schema——`GET /api/agents/{key}/cost-breakdown` 的
`top_traces[].metadata: dict | None` 原樣消費（SDLCCT-47 已定案，本票
依賴宣告已標明「無需變更」）。

## 資料模型

無新增資料模型。`metadata` 本身的型別不變
（`bff/api/schemas.py::TopTraceItem.metadata: dict | None`，見範圍外
聲明）。供開發者參考的實際可能 key 集合（非 schema，只是展示層邏輯需
要知道的事實，來自現狀查核）：

- 已知會出現（`seed/generate.py` 目前產生的 6 個 key）：`plant`
  （廠別）、`deployed_version`（版本）、`dept`（部門）、`trigger`
  （觸發方式）、`cost_center`（成本中心）、`workflow`（工作流程）。
- 本票定義的「4 個常用欄位」= 上述 6 個已知 key 中的
  `plant`/`deployed_version`/`dept`/`trigger`（AC1 字面指定），其餘 2
  個已知 key（`cost_center`/`workflow`）落入收合區。
- 真實資料可能含本票完全不知道的其他 key（spec 範例
  `providers`——已確認不在目前模擬資料集合內，代表這是「後端可能回傳但
  前端沒有專屬渲染規則」的真實情境，不是假設性案例），一律原樣
  `key: value` 顯示於收合區（AC1「未知 key」字面要求），不嘗試翻譯語
  意（範圍外已標明）。

## 關鍵技術決策

### 1. 展開/收合控制項採用既有 `useState(false)` + `<button
aria-expanded>` 慣例（沿用 `span-tree-row.tsx::GroupSpanRow`），不用
`<details>`/`<summary>`

本 repo 目前零 `<details>` 先例；SDLCCT-56 已經為同一類「per-row 可展
開/收合、展開後顯示 N 筆細節」需求建立了一個已核准慣例
（`useState` 宣告在每個獨立元件實例內部，狀態天然 per-row 隔離，不需
要額外的 row-id/index 管理 map），本票的「每列 metadata cell 各自展
開/收合」需求形狀與其完全相同（CONSTITUTION「遵循既有慣例，除非既有
慣例明顯不適用才引入新模式」），因此沿用而非引入第二套互動模式。

### 2. 「many rows」情境下狀態隔離的做法：每個 `<tr>` 的 metadata cell
各自渲染成一個獨立的 `MetadataCell` 元件實例

`top_traces` 可能有多列（表格無上限約束），每一列的展開狀態必須互相獨
立（展開第 1 列不能影響第 2 列）。做法是把 metadata cell 的渲染邏輯抽
成一個獨立元件 `MetadataCell({ metadata })`，在 `<tbody>` 的
`.map(trace => ...)` 裡每列各渲染一個 `<MetadataCell metadata=
{trace.metadata} />`——React 對每個元件實例各自維護自己的
`useState`，不需要在父層用「展開中的 row id 集合」這種共享 state 來模
擬（與 `GroupSpanRow` 在 `SpanTreeRow` 的 `.map` 內每組各自一個實例的
隔離方式完全一致）。

### 3. 常用欄位常數定義位置：模組層級陣列 `KNOWN_METADATA_FIELDS`，定
義在 `top-traces-table.tsx` 檔案內（不另立共用檔案）

```ts
const KNOWN_METADATA_FIELDS: Array<{
  key: string;
  labelKey: keyof typeof messages.agentDetail.topTraces.metadata.fields;
}> = [
  { key: "plant", labelKey: "plant" },
  { key: "deployed_version", labelKey: "deployedVersion" },
  { key: "dept", labelKey: "dept" },
  { key: "trigger", labelKey: "trigger" },
];
```

只有這一個元件（`TopTracesTable`/`MetadataCell`）需要這個常數，目前沒
有第二個消費者；比照這個 repo 既有慣例「不預先抽成共用模組,直到第二
個消費者出現」（CONSTITUTION「規格模糊時不要過度設計」/「三行相似優
於過早抽象」），不新增一個獨立的 `lib/metadata-fields.ts`。陣列順序即
AC1 字面列出的順序（plant → deployed_version → dept → trigger），渲染
的 4 個標籤固定依此順序排列，不依 `Object.keys(metadata)` 的原始順序
（避免常用欄位在畫面上因為後端回傳順序不同而跳動)。

### 4. 展開/收合按鈕的 `onClick`/`onKeyDown` 都呼叫
`e.stopPropagation()`，防止觸發 `<tr>` 既有的整列導覽（SDLCCT-56）

`<tr>` 本身已有 `onClick`（導覽到執行詳情頁）與 `onKeyDown`
（Enter/Space 觸發同一導覽）。瀏覽器原生行為是：按鈕被 Enter/Space 啟
用時會對按鈕本身觸發一個 `click` 事件，這個 `click`/`keydown` 事件會
沿 DOM 往上冒泡經過 `<td>`/`<tr>`，若不中斷冒泡，React 掛在 `<tr>` 上
的 `onClick`/`onKeyDown` 監聽器仍會收到並執行 `goToTrace(trace.id)`
——使用者點擊/鍵盤啟用「更多」按鈕會被誤判成點擊整列,意外導覽離開頁
面。因此 `MetadataCell` 內的展開按鈕必須：

```ts
<button
  type="button"
  aria-expanded={expanded}
  onClick={(e) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  }}
>
```

（`onKeyDown` 的 `stopPropagation` 是為了擋掉 keydown 事件本身往上冒
泡去觸發 `<tr>` 的 `onKeyDown`——即使按鈕的 click 事件冒泡已被擋下，
keydown 事件是獨立冒泡的另一個事件,兩者都要擋。）

### 5. AC3「常用欄位缺少時只顯示存在的標籤」與「metadata 為 `{}`（已知
+未知欄位都不存在）」的一致處理：不渲染任何標籤，也不顯示「更多」控制
項

這是 AC3 字面規則（「只顯示存在的標籤,不顯示空白/undefined/null 文
字」）在「全部 4 個常用欄位都缺」這個邊界情況下的直接延伸,不是本文件
新發明的產品決策：`KNOWN_METADATA_FIELDS.filter(f => metadata[f.key] !=
null)` 為空陣列時不渲染任何 chip;收合區的其餘 key 集合
（`Object.entries(metadata)` 排除 4 個常用 key 後)若也為空,則不渲染
「更多」按鈕本身（AC2「展開可查看收合區塊的其餘欄位」隱含收合區塊有
內容才需要展開控制項,沒有內容時連控制項本身都不該出現,否則點開後是
一片空白,違反「不顯示空白」的同一精神)。

### 6. `t("agentDetail.unknown")` 只保留給 `metadata === null`
（AC4),AC3 的「全部常用欄位缺」情境不重用這個字串

`unknown`（目前值 `"—"`)在這個 repo 既有慣例裡的語意是「這個值本身無
法得知/查無資料」（`formatCurrency`/`formatTaiwanDate` 的 `null→"—"`
慣例、AC4 本身的字面要求)。AC3 描述的「常用欄位缺少其中一項」情境是
「`metadata` 本身存在、只是這幾個特定 key 不存在」,語意是「這個欄位
組合本來就沒有常用資料」,不是「資料無法得知」,兩者語意不同,重用同
一個字串會讓「—」在同一個 cell 裡同時代表兩種不同情況,對未來讀者造
成混淆。因此 AC3 情境下不渲染任何替代文字（渲染空字串/空 fragment），
不是 bug,而是刻意的空白——與 AC3 字面「不顯示空白/undefined/null 文
字」的要求一致（「不顯示文字」本身就是這條 AC 要的行為,不需要用
「—」填補)。

## i18n 新增 key

`frontend/lib/i18n/messages.ts`：在既有 `agentDetail.topTraces` 命名
空間下新增 `metadata` 子物件（只附加,不更動 `agentDetail` 命名空間下
任何既有內容,包含不動第 161 行既有的 `unknown: "—"`）：

```ts
agentDetail: {
  // ...既有內容不變...
  topTraces: {
    title: "最貴執行清單",
    table: { columns: { id: "Trace ID", cost: "預估成本", metadata: "中繼資料" } },
    metadata: {
      fields: {
        plant: "廠別",
        deployedVersion: "版本",
        dept: "部門",
        trigger: "觸發方式",
      },
      more: "更多",
      collapse: "收合",
    },
  },
  unknown: "—",
},
```

（`traceDetail.expand`/`traceDetail.collapse` 已有先例用「展開查看個
別」/「收合」兩個字串,本票的「更多」/「收合」文案刻意用更短的
「更多」而非沿用「展開查看個別」,因為這裡展開的是欄位列表而非個別
span 實例,語境不同,沿用會誤導使用者以為會展開出更多筆資料列而非更
多欄位。）

## UI 原型

`docs/design/SDLCCT-74-prototype.html`（可直接在瀏覽器開啟的靜態
HTML,套用與 `SDLCCT-48-prototype.html`/`SDLCCT-52-prototype.html`
相同的色彩/字級/間距 token）。涵蓋 4 條 AC 對應的情境各一列：

1. 4 個常用欄位皆存在：顯示 4 個標籤（廠別/版本/部門/觸發方式),右側
   一個「更多」連結。
2. 點擊「更多」展開後的視覺（原型以靜態方式呈現「已展開」狀態,附註文
   字說明「再次點擊收合」),收合區顯示 `cost_center`/`workflow` 兩個
   `key: value` 列。
3. 缺少 `dept` 標籤的列：只顯示 3 個標籤（廠別/版本/觸發方式),不顯示
   任何空白佔位。
4. `metadata` 為 `null` 的列：顯示「—」,旁邊註記文字說明「不渲染任何
   標籤或展開控制項」。

## 開放設計問題（定稿時必須為空）

（無）
