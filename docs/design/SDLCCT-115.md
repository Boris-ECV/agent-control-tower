# 設計文件 — SDLCCT-115 Span 排序與 type 顏色（execution detail screen）

## 對應需求規格

對應 G1 已核准的需求規格（拆分自 SDLCCT-87 原始範圍第 4、6 條）：執行
詳情頁（SDLCCT-56）的 span 列表目前依 API 回傳順序渲染、type badge 一律
灰色；本票只加兩項調整，不改變樹狀縮排/分組邏輯本身：

1. 同一層（遞迴，與既有 `groupSiblings` 逐層分組範圍一致）的 children
   依 `start_time` 排序；`start_time` 為 `null` 排在該層最後，彼此間維持
   原陣列順序（穩定排序）。重複分組（「× N」）的排序鍵用該組第一個節點
   的 `start_time`。
2. Span type badge 依 type 上色：`llm` 紫色、`tool` 青色、`general`/其他
   /`null` 維持現狀灰色不特別上色；色票另外 export 為共用常數
   `SPAN_TYPE_COLORS`，供 SDLCCT-118 瀑布圖子單重用。

依賴：SDLCCT-56（已 Done，`frontend/components/trace-detail/
group-spans.ts`／`span-tree-row.tsx`，見 `docs/design/SDLCCT-56.md`）。

## 介面/API 契約

無新增/變更 BFF 端點或 HTTP 契約（純前端畫面層排序與樣式調整，不改變
SDLCCT-55 回應形狀）。新增的前端內部函式/常數契約如下，供開發者直接依
此實作，不必自行發明簽章：

### 新增函式：`sortGroupsByStartTime`（`frontend/components/trace-detail/group-spans.ts`）

```ts
// 排序鍵：single 用自身 node.start_time；group 用 nodes[0].start_time
// （該組第一個節點——groupSiblings 本身不依時間排序組內節點，故「第一個
// 節點」是本票採用的具體定義，見下方關鍵技術決策 #1）。
export function sortGroupsByStartTime(groups: SpanGroup[]): SpanGroup[] {
  const keyOf = (g: SpanGroup): string | null =>
    g.kind === "single" ? g.node.start_time : g.nodes[0].start_time;

  return [...groups].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1; // null 排最後
    if (kb === null) return -1;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0; // 相等時維持原順序(Array.prototype.sort 自 ES2019 起保證穩定排序)
  });
}
```

呼叫位置：`span-tree-row.tsx` 的 `SpanTreeRow` 元件內，取代目前直接使用
`groupSiblings(nodes)` 的結果：

```ts
const groups = sortGroupsByStartTime(groupSiblings(nodes));
```

`groupSiblings` 本身不變（分組判定邏輯、組內節點順序皆維持 SDLCCT-56 既
有保證），排序只作用在「分組後的 `SpanGroup[]` 陣列」這一層，與分組遞迴
層級完全對齊（`SpanTreeRow` 本身就是逐層遞迴呼叫，排序自然逐層套用）。

### 新增共用常數：`frontend/lib/span-type-colors.ts`（新檔）

```ts
// Span `type` -> Tailwind 徽章樣式對照表（SDLCCT-115 Scenario 3/4）。
// 刻意放在 `lib/`、不放在 `components/trace-detail/` 底下，讓 SDLCCT-118
// 瀑布圖元件可以直接 import 同一份色票，不需要依賴 trace-detail 的樹狀
// render 元件樹——單一色彩定義來源，不得各自重複定義。
export const SPAN_TYPE_COLORS: Record<string, string> = {
  llm: "border-purple-300 bg-purple-50 text-purple-700",
  tool: "border-cyan-300 bg-cyan-50 text-cyan-700",
};

// `general`、其他未知值、`null` 皆不在表中，呼叫端應 fallback 到既有灰色
// 樣式（維持現狀，見下方關鍵技術決策 #2），不要在表中補一個 "general"
// 項目製造「每個 type 都要查表」的錯覺。
```

`span-tree-row.tsx` 的 `SpanLabel`/`GroupSpanRow` 徽章渲染改為：

```tsx
const badgeClass = node.type !== null
  ? `rounded border px-1.5 py-0.5 text-xs ${
      SPAN_TYPE_COLORS[node.type] ?? "border-transparent bg-gray-100 text-text-secondary"
    }`
  : null;
// node.type === null 時不渲染徽章(沿用現狀 `{node.type !== null && (...)}`)
```

## 資料模型

無新增資料模型（純前端展示層排序與樣式，不改變 `SpanTreeNode`/
`SpanGroup` 的欄位形狀，`SpanGroup` 型別本身不變）。

## 關鍵技術決策

1. **分組排序鍵用「組內第一個節點」的 `start_time`，不是另外在組內先
   找最小值。** Scenario 2 標題文字是「該組最早時間」，但規格正文明確
   寫「排序鍵用該組『第一個節點』的 start_time」——兩者在實務資料下通常
   一致（同名重複 span 多半本來就依發生順序出現在 API 回傳陣列中，
   `groupSiblings` 本身保留原陣列順序，不重排組內節點），採用規格正文
   給的明確定義（第一個節點），不額外新增「組內找最小值」的邏輯，避免
   在規格沒要求的地方過度實作；若未來發現同組內節點確實非時間遞增排列
   造成視覺不符預期，屬於既有 `groupSiblings` 分組/順序保證的範圍，不在
   本票重新決定。
2. **`SPAN_TYPE_COLORS` 只收錄 `llm`/`tool` 兩個鍵，不收錄
   `general`。** 規格明文「general/其他/null 維持現狀不上色」——維持現狀
   即沿用 `span-tree-row.tsx` 既有的 `bg-gray-100 text-text-secondary`
   類別字串，不需要在共用常數表中重複定義一份「灰色」條目；呼叫端用
   `??` fallback 到現狀字串即可，查表 miss 本身就是「維持現狀」的正確
   語意，不是需要特別處理的例外分支。
3. **徽章新增 `border` class（`llm`/`tool` 皆含 `border-xxx-300`），現狀
   灰色也補上 `border-transparent` 而非維持無 border。** 規格只規定三種
   type 各自的完整 class 字串，未提及現狀是否要加 transparent border；
   但若不加，`llm`/`tool` 徽章會因為多了 1px border 而比 `general` 徽章
   大 2px（寬高各多 2px），造成同一層徽章高度不一致的視覺瑕疵。這是規格
   沒明講但設計必須解決的排版一致性問題（不是新產品決策，只是現有
   「維持現狀」本身在加了 border 的鄰居之後，需要補一個不可見的等寬
   border 才能真正達到「視覺不變」的效果），故不列為開放設計問題。
4. **排序函式命名與放置位置沿用 `group-spans.ts` 既有「一個檔案、純
   函式、不含 React」慣例**（與 SDLCCT-56 決策一致），不新開一個
   `sort-spans.ts` 檔案——排序與分組都是「同一層 children 陣列的展示前
   轉換」，屬於同一個關注點，分兩個檔案反而增加 `span-tree-row.tsx` 需要
   import 的來源數量。

## UI 原型

`docs/design/SDLCCT-115-prototype.html`（可直接在瀏覽器開啟）。呈現：
同一層 `root-chain` 下，`llm`（summarize）、`tool`（search-tool × 45 群
組）、`general` 三種 type 混合，依 `start_time` 遞增顯示而非依 type 固
定順序；另外示範一筆 `start_time` 為 `null` 的 span 被排在同層最後。
`llm` 徽章紫底紫字、`tool` 徽章青底青字，`general` 維持灰色徽章，三者
高度一致（見上方決策 3 的 border-transparent 處理）。

## 跨元素樣式耦合測試檢查

`Grep("toEqual|一致|consistent|getComputedStyle", path="frontend/e2e")`
僅命中 `frontend/e2e/trace-detail.spec.ts`（與本票同一畫面），逐一檢視
該檔案後**沒有**任何跨元素樣式一致性的鏈式斷言（`toEqual`/`consistent`/
`getComputedStyle` 比對兩個 selector 的計算樣式）；`frontend/e2e/
anomalies.spec.ts` 等其他檔案對本票變更的 selector（span type 徽章、
span 列表排序）亦無任何引用。本票變更的 selector（type 徽章的
class、`SpanTreeRow`/`GroupSpanRow` 的 children 渲染順序）在既有 e2e
套件中沒有被任何「兩元素樣式必須相等」的鏈式測試耦合，可安全變更。

`frontend/components/trace-detail/span-tree-row.test.tsx` 中既有針對
時間顯示的單元測試（SDLCCT-95）固定使用單一 `node` helper 建立單一
span，不涉及排序或多 span 比較，本票變更不影響其斷言。

## 開放設計問題

（無）
