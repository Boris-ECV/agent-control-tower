# 設計文件 — SDLCCT-118 Trace span 瀑布圖時間軸（frontend）

## 對應需求規格

對應 G1 已核准的需求規格「Trace span 瀑布圖時間軸」：拆分自 SDLCCT-87
第 5、7 條，在既有 Execution detail 頁（SDLCCT-56）的 span 樹狀列表
之外，新增一個瀑布圖視覺化，取代目前以純文字呈現起訖時間的方式。4 條
AC 對應範圍：

1. 每個 span 有明確起訖時間時，時間軸每 2 秒經過時間一條刻度線，且
   每個 span 右側顯示其耗時文字。
2. llm/tool/general 三種類型色條分別為紫/青/灰，與既有 type badge 顏色
   一致（沿用 SDLCCT-115 色票常數）。
3. `start_time`/`end_time` 為 `null` 的 span 不納入瀑布圖色條，但仍留在
   既有樹狀 span 列表中（不受本票影響）。
4. `spans` 為空陣列時，時間軸區塊顯示「沒有可顯示的資料」，不渲染空
   SVG 或假格線。

依賴：SDLCCT-56（Done，`trace-detail-content.tsx`/`span-tree-row.tsx`
既有結構，本文件沿用不動其樹狀縮排/分組/展開互動）；SDLCCT-115（設計
文件已核准並合併至 `main`，`docs/design/SDLCCT-115.md`——其 export 的
色票常數為 `SPAN_TYPE_COLORS`，定義於新檔 `frontend/lib/
span-type-colors.ts`，只含 `llm`/`tool` 兩個鍵，見下方「關鍵技術決策
#1」；但截至本次修訂，該程式碼本身尚未合併至 `main`——`frontend/lib/
span-type-colors.ts` 仍不存在於本分支/`main`，開發者應在實作本票前先
確認 SDLCCT-115 程式碼是否已合併，若尚未合併需等待或協調合併順序）；
SDLCCT-117（軟依賴，未觸碰）。

範圍外（spec 已明定，本文件不觸碰）：縮放/互動式平移；span 分組
（「× N」）判定或展開互動的任何變更；巢狀深度過深時的版面擁擠處理。

## 介面/API 契約

無新增/變更 BFF 端點或前端 API client。純消費 SDLCCT-56 已取得的
`TraceSpansResponse.spans`（`SpanTreeNode[]`，見
`frontend/lib/trace-spans-api.ts`），在既有 `trace-detail-content.tsx`
成功狀態分支內新增一個子區塊，資料來源與既有樹狀列表完全相同的一次
fetch 結果，不另外呼叫 API。

## 資料模型

無新增持久化資料模型。唯一新增的是前端展示層純函式衍生結構（不送回
API、不持久化）：

```ts
// frontend/components/trace-detail/span-waterfall.tsx
export type FlatSpan = { node: SpanTreeNode; depth: number };

// 對整棵 span 樹做深度優先、保留原始 children 順序的前序走訪，攤平成
// 一維陣列並標記 depth——與 SpanTreeRow 遞迴渲染走訪的順序/深度定義
// 完全一致（見下方關鍵技術決策 #2），但不套用 group-spans.ts 的
// groupSiblings 分組（瀑布圖每個 span 各自一列，不折疊同名兄弟）。
export function flattenSpans(nodes: SpanTreeNode[], depth?: number): FlatSpan[];
```

`SpanWaterfall` 元件內部再從 `flattenSpans` 的結果過濾出
`start_time`/`end_time` 均非 `null` 的項目才產生色條（AC3）；被過濾掉
的項目既不佔瀑布圖列、也不影響其他列的垂直順序（見關鍵技術決策 #3）。

## 關鍵技術決策

### 1. 色票常數 import 路徑：`SPAN_TYPE_COLORS` 從新檔
`frontend/lib/span-type-colors.ts` export（已確認，非假設）

本文件先前曾假設 `SPAN_TYPE_COLORS` 會與 `group-spans.ts`（既有唯一
處理「span 類型」邏輯的純邏輯檔案）同檔或同目錄 export，理由是色票常數
（純資料、無 JSX）性質上更適合與該檔共享，而非混雜 UI render 的
`span-tree-row.tsx`。此假設已由 SDLCCT-115 已核准並合併的設計文件
（`docs/design/SDLCCT-115.md`）證實**不成立**：該文件明訂 `SPAN_TYPE_
COLORS` 放在獨立新檔 `frontend/lib/span-type-colors.ts`（刻意不放在
`components/trace-detail/` 底下，理由同上——讓本票可以直接 import 同一
份色票而不依賴 trace-detail 的樹狀 render 元件樹），且只含 `llm`/
`tool` 兩個鍵（不含 `general`），`type` 不在表中時呼叫端須 fallback 到
既有灰色樣式（見決策 #4）。本票 import 路徑改為：

```ts
import { SPAN_TYPE_COLORS } from "@/lib/span-type-colors";
```

（路徑別名沿用 `tsconfig.json` 既有 `@/*` → `frontend/*` 設定，與
SDLCCT-115 設計文件中 `frontend/lib/span-type-colors.ts` 的實際檔案
位置對應一致。）

**注意**：截至本次修訂，`frontend/lib/span-type-colors.ts` 檔案本身
仍不存在於本分支/`main`（已實際搜尋確認）——即 SDLCCT-115 的設計文件
已核准合併，但其程式碼尚未合併。本決策的 import 路徑是依據 SDLCCT-115
**設計文件文字**推得，不是依據現存程式碼核對得出；開發本票前應先確認
SDLCCT-115 程式碼合併狀態，避免 import 一個尚不存在的模組。

### 2. 瀑布圖的列順序/深度＝對整棵樹做前序走訪的順序/深度，不經過
`groupSiblings`

Spec 原文「列順序沿用排序後的樹狀展示順序（含縮排 depth 一致）」—— 這
裡的「縮排 depth 一致」解讀為走訪順序（深度優先、父節點先於子節點、
兄弟節點保持原陣列順序）與 depth 標記方式必須與
`SpanTreeRow`/`SingleSpanRow` 遞迴渲染時使用的順序/深度定義一致，
**不是**要求瀑布圖本身在視覺上也用像素縮排來表現 depth（spec 並未要求
瀑布圖呈現層級結構，只要求「每個 span 各佔一列」＋「色條依耗時換算」
＋「色條右側顯示耗時文字」，沒有第三個視覺維度的要求）。因此
`flattenSpans` 直接做標準前序走訪，不套用 `group-spans.ts` 的
`groupSiblings`——瀑布圖永遠顯示「每一個」span 各自一列（spec 原文
「每個 span 各佔一列」），與樹狀列表當前是否展開某個同名群組無關，
兩個區塊各自獨立渲染、互不影響彼此的互動狀態。

### 3. `start_time`/`end_time` 為 `null` 的 span：從瀑布圖列表中整列省略
（不保留空列）

Spec 只要求「瀑布圖不顯示該 span 的色條」，未要求保留一個空位列以维持
與樹狀列表逐列對齊——樹狀列表本身也不是瀑布圖的渲染輸入（兩者各自獨立
走訪產生，見決策 #2），沒有逐列對齊的既有約束可循。省略空列是最簡單、
最不會產生「一列沒有任何視覺內容」的空白列（反而更接近 spec 真正要求
的「瀑布圖不顯示」字面意思）。

### 4. 色彩 fallback：`type` 不是 `"llm"`/`"tool"`/`"general"` 時沿用
`SPAN_TYPE_COLORS.general`（灰）

已查證 `seed/generate.py`（本專案目前唯一的資料來源）只產生這三種
`type` 字面值（`"general"` 給 root span、`"tool"` 給工具呼叫、`"llm"`
給 LLM 步驟），`SpanTreeNode.type` 的 schema 雖是 `string | null`，但
實際資料不會出現第四種值；`type === null` 的 span 本身若恰好也有合法
起訖時間（兩者是獨立欄位），同樣落入此 fallback。這是沿用既有唯一色票
來源的保守預設，不是新發明一套色彩語意，風險低（CONSTITUTION「只在
真正出現過的判斷點才新增規則」精神一致）。

### 5. 全部 span 皆缺起訖時間（`spans` 非空但沒有一筆可畫色條）：沿用
AC4 的「沒有可顯示的資料」而非渲染空 SVG

Spec 明文的 AC4 只描述 `spans` 為空陣列這一種情況，但其陳述的理由
（「不渲染空 SVG 或假格線」）在"spans 非空、但全部缺起訖時間"時同樣
成立——沒有任何時間資料可畫格線/色條，渲染一個空殼 SVG 不會比顯示文字
更有資訊量。套用同一條已定案原則的自然延伸，不是新增一個 spec 未講的
產品決策。

## UI 原型

見 `docs/design/SDLCCT-118-prototype.html`（可直接在瀏覽器開啟）。版面
配置：在既有樹狀 span 列表（`SpanTreeRow`，原樣不動）**下方**新增
「Span 耗時時間軸」區塊，單一 SVG 瀑布圖：

- 格線：每 2 秒經過時間一條淡灰直線，無文字標籤，位於色條之後方（z
  序在色條之前渲染，與 `version-cost-chart.tsx` 格線先於資料序列的
  既有慣例一致）。
- 每個有效 span 一列，列高固定；色條左緣＝該 span 相對 trace 最早
  `start_time` 的經過秒數換算像素，寬度＝耗時換算像素；色條顏色取自
  `SPAN_TYPE_COLORS[node.type]`（fallback 灰，見決策 #4）；色條右側
  緊接耗時文字，格式 `X.Xs`（一位小數）。
- `spans` 為空陣列、或非空但全部缺起訖時間 → 整個時間軸區塊只顯示
  `t("traceDetail.waterfall.empty")`＝「沒有可顯示的資料」文字，不渲染
  `<svg>`。

**`spans` 為空陣列時與 SDLCCT-56 既有「查無資料」文案如何共存，已由
人類於 SDLCCT-120 決定採選項 1**（見下方「開放設計問題」一節）：
`trace-detail-content.tsx` 第 95-97 行 SDLCCT-56 既有的
`state.data.spans.length === 0 && <p>{t("traceDetail.empty")}</p>`
邏輯**完全不動**；本票的時間軸區塊是在同一個 `state.status ===
"success"` 分支內，與第 95-97 行（`spans.length === 0` 顯示「查無
資料」）、第 99-103 行（`spans.length > 0` 顯示樹狀列表）**平行並列
（sibling）**渲染的第三個子區塊，其渲染條件不依賴 `spans.length`
是否為 0——時間軸區塊永遠渲染（success 狀態下），內部再依「是否有任何
一筆有效起訖時間的 span」決定顯示 SVG 或自己的「沒有可顯示的資料」空
狀態文字（見上方 UI 原型空狀態條件）。也就是說新增的 JSX 應插入在第
97 行與第 99 行之間（或第 103 行之後，順序不影響邏輯），作為獨立的
第三個 `{state.status === "success" && ...}` 區塊，不嵌套在既有任一
分支內部，兩段文字（「查無資料」與「沒有可顯示的資料」）可以同時出現
在畫面上，彼此獨立、互不取代。

新增 i18n key（append-only，接在既有 `traceDetail` 區塊下新增
`waterfall` 子區塊，不改動既有任何既有 key）：

```ts
traceDetail: {
  // ...既有 key 不動...
  waterfall: {
    title: "Span 耗時時間軸",
    empty: "沒有可顯示的資料",
  },
},
```

`title` 作為 `<svg role="img" aria-label={...}>` 的 aria-label，螢幕
閱讀器可辨識此圖表用途（沿用 `version-cost-chart.tsx` 既有
`role="img"` + `aria-label` 慣例）。

## 跨元素樣式耦合測試檢查

`Grep("toEqual|一致|consistent", path="frontend/e2e")` 命中 6 個檔案
（`breadcrumbs.spec.ts`、`back-link.acceptance.spec.ts`、
`agent-detail.spec.ts`、`date-rollout.acceptance.spec.ts`、
`page-header-timestamp.spec.ts`、`breadcrumbs.acceptance.spec.ts`），
逐一檢查後確認**沒有任何一處**是跨元素比較本票會變更的 selector
（span type badge／`span-tree-row.tsx` 色塊）的 computed style 相等性
斷言——`agent-detail.spec.ts` 命中的 `toEqual` 是折線圖資料點數量陣列與
表格標題文字陣列的純資料比較，與本票色彩/樣式無關。`trace-detail.spec.ts`
另有一處 `getComputedStyle(...).paddingLeft` 比較（Scenario 2：父列
縮排 < 子列縮排），但那是 `toBeGreaterThan`（不等式，非相等鏈式耦合）
且本票未改動 `SpanLine`/`SingleSpanRow` 的縮排邏輯，不受影響。本票新增
的 `SPAN_TYPE_COLORS` 色條與既有 type badge（`bg-gray-100` 灰底文字
badge，顏色邏輯來自 SDLCCT-115、非本票新增）是否存在耦合斷言，待
SDLCCT-115 合併其設計文件/測試後一併確認；本票未發現任何現存測試會因
本票變更而破壞。

## 開放設計問題

（無）

> 原開放設計問題「SDLCCT-56 既有『`spans` 為空陣列 → 整頁顯示『查無
> 資料』』與本票 AC4『時間軸區塊顯示『沒有可顯示的資料』』如何共存」
> 已由人類於 SDLCCT-120 決定：**採選項 1**——SDLCCT-56 既有整頁
> 「查無資料」空狀態邏輯（`trace-detail-content.tsx` 第 95-97 行，
> `spans.length === 0` 時顯示 `t("traceDetail.empty")`）維持不變，不
> 修改；時間軸區塊在同一個 success 狀態分支內，作為獨立、平行的子
> 區塊額外渲染自己的空狀態文字「沒有可顯示的資料」（AC4 字面要求），
> 兩段文字彼此獨立、同時可能出現在同一頁面，互不取代。具體渲染位置
> 見上方「UI 原型」一節的說明。
