# 設計文件 — SDLCCT-56 Execution detail screen (frontend)

## 對應需求規格

對應 G1 已核准的需求規格「Execution detail screen (frontend)」：從 Agent
詳情頁「最貴的執行」清單（SDLCCT-48 `TopTracesTable`）點擊某一列 trace，
導覽到一個新的動態路由頁面，消費 SDLCCT-55 既有端點
`GET /api/agents/{key}/traces/{trace_id}/spans`，以樹狀方式呈現 span，
並讓同名重複子 span 一眼可辨識重複次數。6 條 AC 對應範圍：

1. 點擊列 → 導覽到 `/agents/{key}/traces/{traceId}`，以 `key`+`traceId`
   查詢 SDLCCT-55 端點。
2. 200 且樹狀結構非空 → 以縮排樹狀呈現每個 span 的 name/type/時間，
   父子關係可視覺辨識。
3. 同一父節點下 2 筆以上同名子 span → 群組為一列，顯示「× N」徽章，
   使用者不需自行數算；可展開看個別實例。
4. 200 且 `spans: []` → 顯示「查無資料」說明狀態，不是空白。
5. 404/502 → 顯示 `ErrorCard`（沿用 SDLCCT-32 既有慣例），絕不空白或
   假裝沒有資料。
6. 任意畫面不得出現「Opik」或其他底層觀測後端品牌字樣。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：metadata 篩選的 trace
搜尋（SDLCCT-20）；trace/span 的任何寫入或標註；展開以外的互動（時間軸
縮放、效能分析圖表等）；新增/變更 BFF 端點（純消費 SDLCCT-55）；
`TopTracesTable` 以外的既有畫面元件/版面變更。

依賴：SDLCCT-55（已 Done，`bff/api/trace_spans.py`／
`bff/api/schemas.py` 已逐位元組確認，見下方 API 契約一節）；SDLCCT-48
（已 Done，`frontend/components/agent-detail/top-traces-table.tsx`
目前完全沒有 `onClick`/`<Link>`/`onKeyDown`，本票從零新增）。

## 介面/API 契約

### 前端路由：`GET /agents/[key]/traces/[traceId]`（新增動態路由頁面）

沿用 `frontend/app/agents/[key]/page.tsx`（本 repo 第一個動態路由段，
SDLCCT-48 決策 5）已確立的慣例：route param 只在 request time 才知道，
`next.config.ts` 的 `cacheComponents: true` 要求消費動態 route
param/client hook 的內容包在 `<Suspense>` 裡。新增：

- `frontend/app/agents/[key]/traces/[traceId]/page.tsx`（server
  component，僅做 `<Suspense fallback={null}>` 包裝，逐字比照
  `agents/[key]/page.tsx` 的寫法）
- `frontend/components/trace-detail/trace-detail-content.tsx`（client
  component，`"use client"`，以 `useParams<{ key: string; traceId:
  string }>()` 取得兩個路徑參數，`useFetchOnce` 呼叫下方新增的 API
  client function，渲染 loading/error/success 三態——與
  `agent-detail-content.tsx`、`anomalies/page.tsx` 的既有三態模式一致，
  不新增第四種狀態；AC4「查無資料」是 success 狀態下 `spans.length ===
  0` 的一個子分支，不是獨立的 fetch 狀態）。

路徑命名 `/agents/{key}/traces/{traceId}`：逐字比照 BFF 端點路徑本身的
資源層級（`agents/{key}/traces/{trace_id}/spans` 去掉最後的
`/spans` 子資源字尾，因為前端這一頁呈現的就是該 trace 整體），與既有
`/agents/[key]` 頁面同一層動態路由慣例一致，不新增路由風格。

### 前端 API client：新增 `frontend/lib/trace-spans-api.ts`

比照 `frontend/lib/agent-detail-api.ts` 既有「一個畫面一個 API client
檔案，型別從 `lib/generated/bff-types.ts` 的 `components["schemas"]`
取出，`fetchJson` 做底層 fetch/錯誤正規化」慣例：

```ts
import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type TraceSpansResponse = components["schemas"]["TraceSpansResponse"];
export type SpanTreeNode = components["schemas"]["SpanTreeNode"];

export function fetchTraceSpans(
  key: string,
  traceId: string,
): Promise<TraceSpansResponse> {
  return fetchJson<TraceSpansResponse>(
    `/api/agents/${encodeURIComponent(key)}/traces/${encodeURIComponent(traceId)}/spans`,
  );
}
```

`TraceSpansResponse`/`SpanTreeNode` 目前尚未出現在
`frontend/lib/generated/bff-types.ts`（已逐一 grep 確認不存在，SDLCCT-55
合併後未重新產生型別檔）。開發階段第一步須執行
`project-profile.yaml` 宣告的 `frontend_generate_types`
（`cd frontend && npm run generate:types`，其前置是
`bff_export_openapi`：`cd bff && uv run python scripts/export_openapi.py`）
重新產生此檔，而非手刻型別——與既有所有畫面的型別取得方式一致。

### 回應資料形狀（逐位元組引用 `docs/design/SDLCCT-55.md`，不重複定義）

```json
{
  "key": "agent-a",
  "trace_id": "trc_123",
  "spans": [
    {
      "id": "spn_1", "parent_span_id": null, "name": "root-chain",
      "type": "general", "start_time": "2026-10-01T00:00:00Z",
      "end_time": "2026-10-01T00:00:05Z",
      "children": [ { "...": "遞迴同一形狀" } ]
    }
  ]
}
```

- 200 + `spans: []` → Scenario 4（查無資料）。
- 404 `{"detail": "Agent '<key>' not found"}`、502
  `{"error": {"message", "endpoint", "status_code"}}` → Scenario 5，
  由 `fetchJson`（既有共用 client）正規化成 `ApiError` 後拋出，
  `useFetchOnce` 捕捉為 `status: "error"`——與
  `agent-detail-content.tsx`/`anomalies/page.tsx` 完全一致，不新增
  錯誤處理路徑。

## 資料模型

無新增持久化資料模型，無新增/變更 BFF 端點或 schema（純消費 SDLCCT-55
既有回應）。唯一的「資料模型」是前端畫面層的展示用衍生結構——由
`SpanTreeNode[]` 在元件內部（不送回 API、不持久化）轉換出的分組樹，用
於 Scenario 3 的「× N」徽章：

```ts
// frontend/components/trace-detail/group-spans.ts
type SpanGroup =
  | { kind: "single"; node: SpanTreeNode }
  | { kind: "group"; name: string; type: string | null; nodes: SpanTreeNode[] };

function groupSiblings(nodes: SpanTreeNode[]): SpanGroup[];
```

`groupSiblings` 只作用於「同一層的 children 陣列」（遞迴套用在每一層，
由渲染元件遞迴呼叫，不是對整棵樹攤平後分組）：依 `name` 將同層
children 分組，`name` 相同者數量 ≥ 2 時併為一個 `group`（型別固定取
第一個節點的 `type`；規格未要求處理「同名但不同 type」的情況，見下方
關鍵技術決策 #2），數量 1 的維持 `single`。輸出陣列順序＝輸入陣列中各
組「第一次出現」的順序（穩定排序，不重新排序整組），與 SDLCCT-55 決策
2「同名重複子 span 保留順序、不去重折疊」的後端保證銜接一致——分組只
發生在前端展示層，原始 `SpanTreeNode[]` 資料本身不被修改或捨棄任何
節點。

## 關鍵技術決策

### 1. ErrorCard 原樣重用、不修改，Scenario 6（AC6）由既有訊息內容保證
而非新增過濾邏輯

比照 `agent-detail-content.tsx`/`anomalies/page.tsx`：
`state.status === "error"` 時渲染既有 `components/cost-overview/
error-card.tsx`，顯示 `errorCard.queryFailed(endpoint, status, message)`
——`message` 直接來自後端 `error.message`（502）或通用 `HTTP 404`
字串（`lib/api-client.ts` 的 `fetchJson` 只在 `body?.error?.message`
存在時才取用，404 回應形狀是 `{"detail": ...}`，沒有 `error.message`
欄位，因此 404 一律落回通用 `HTTP 404` 字樣，不會把 `detail` 原文顯示
出來）。已逐一檢查 `bff/opik_spans.py` 所有會冒泡成 502 的例外訊息
字串（`"request timed out"`、`"non-2xx response"`、
`f"request failed: {exc}"`、`f"unexpected response shape: {exc}"`）
與 `bff/api/app.py` 的 `_opik_client_error_handler`/
`_opik_config_error_handler`：訊息文字本身（`str(exc)`）皆不含字面
「Opik」字樣，只有例外「類別名稱」含 Opik（不會序列化進 HTTP 回應
body）。因此沿用既有 ErrorCard 不需任何修改即可滿足 Scenario 6——這與
SDLCCT-32/48 既有畫面已接受的同一套慣例完全一致，不在本票重新設計
錯誤訊息呈現方式。（已知殘留風險，非本票新增、也非本票範圍：若部署環境
的 `OPIK_BASE_URL` 主機名稱本身含 "opik" 字樣，連線層例外
`f"request failed: {exc}"` 可能間接帶出該網址字串；此風險在
SDLCCT-32/48 的 cost-breakdown 502 路徑已同樣存在且未被先前設計文件
視為需處理項目，本票不重新決定，維持現狀。）

畫面上其餘所有文字只來自：後端回應的 `name`/`type` 欄位（原樣顯示，
不轉譯、不加品牌字首字尾）、或本檔新增的固定 i18n 字串（見下方 UI
原型一節列出的 key，字面內容由本文件定案，不含任何觀測後端名稱）。

### 2. 分組鍵只用 `name`，不含 `type`；同名但不同 type 的子 span 視為
同一組（以第一個節點的 type 顯示）

規格 Scenario 3 的驗收文字是「同名子 span」，未提及 type 是否需要納入
分組鍵；後端回應保證 `name`/`type` 皆為獨立欄位、無「同名必同 type」
的資料約束。為避免臆測一個規格未明訂的資料完整性保證，分組鍵只取
`name`（規格字面要求的唯一依據），讓同名即分組；若同名但 type 不同
（理論上可能，目前無已知真實資料案例），畫面顯示該組第一個節點的
type，不另外標示「混合 type」——這是目前資料情境下的不可觀測邊界情況，
不影響本票 6 條 AC 的任何一條，因此不列為開放設計問題。

### 3. 群組預設摺疊、以可展開的 `<details>`/按鈕呈現個別實例，不是把
N 個同名 span 直接攤平列出再疊加徽章

規格明文允許「展開」以外的互動排除在範圍外（反面陳述即「展開」互動
本身在範圍內），且 AC3 原文「不需使用者自行逐筆數算」的最直接實作是
把重複項目收合成一列＋徽章，而非列出全部 N 列再額外貼一個數字（後者
仍需使用者自己確認徽章數字是否等於畫面上的列數，不如直接收合直覺）。
預設摺疊、點擊展開才顯示個別 span 各自的 start_time/end_time——與
AC2「每個 span 的時間」的要求相容（展開後每個實例仍各自顯示時間），
摺疊狀態下只顯示代表性的 name/type/「× N」。

### 4. 樹狀縮排以遞迴元件 + CSS `padding-left`（依深度），不引入新的
樹狀/表格套件

現有 `top-traces-table.tsx`/`model-breakdown-table.tsx` 皆是純
Tailwind + 原生 HTML 元素，本 repo 目前沒有任何樹狀元件套件依賴
（`package.json` 未列）。span 樹深度在實務資料下有限（工具呼叫鏈通常
數層），用一個遞迴 React 元件（`SpanTreeRow`，每層依 `depth` 算
`paddingLeft`）即可滿足 AC2「父子關係可視覺辨識（例如縮排）」，不需
為此新增套件依賴——沿用本專案目前「不引入新前端套件除非既有工具無法
滿足」的一貫做法（與 SDLCCT-48 的 `version-cost-chart.tsx` 手刻 SVG
折線圖、不用圖表套件，是同一類判斷）。

### 5. 時間顯示新增 `formatTaiwanDateTime`（`frontend/lib/format.ts`
新增函式），不重用既有 `formatTaiwanDate`

既有 `formatTaiwanDate` 只接受 `YYYY-MM-DD` 純日期字串（其註解明寫
「UTC-midnight 慣例」），而 span 的 `start_time`/`end_time` 是含時分秒
的 ISO datetime 字串（見 SDLCCT-55 回應範例
`"2026-10-01T00:00:01Z"`），直接餵給 `formatTaiwanDate` 會產生
`new Date("...T00:00:00Z" 疊加在已有時間的字串後)` 的格式錯誤。新增
一個姐妹函式：

```ts
export function formatTaiwanDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
```

`null`/缺失一律顯示 `"—"`（沿用 `formatCurrency`/`formatPercent` 既有
「缺值顯示 em dash，不顯示 0 或空字串」慣例），對應 SDLCCT-55 資料模型
決策「`start_time`/`end_time` 可能為 `None`」。

## UI 原型

```
┌────────────────────────────────────────────────────────┐
│ Agent Control Tower                      2026年10月20日 │
├────────────────────────────────────────────────────────┤
│ 執行詳情 — trc_123                                       │
│                                                          │
│ ▸ root-chain  [general]  2026/10/01 00:00:00–00:00:05   │
│    ▸ search-tool  [tool]  × 45            ︙展開查看個別  │
│    ▸ summarize  [llm]  2026/10/01 00:00:06–00:00:08      │
├────────────────────────────────────────────────────────┤
│ 資料來源：Agent registry ＋ 觀測性後端 trace/span 查詢。   │
└────────────────────────────────────────────────────────┘
```

- loading：沿用既有骨架樣式（3 個 `animate-pulse` 區塊，比照
  `agent-detail-content.tsx`/`anomalies/page.tsx`）。
- error（404/502）：`<ErrorCard title={t("traceDetail.header.title")}
  error={state.error} onRetry={state.retry} />`。
- success + `spans.length === 0`：顯示
  `<p>{t("traceDetail.empty")}</p>`（比照 `anomalies.empty` 既有
  「查無資料」文字慣例的寫法，不是空白 `<div>`）。
- success + 非空：遞迴渲染 `SpanTreeRow`，群組列右側顯示
  `× {count}` 徽章 + 可點擊展開（`aria-expanded`，鍵盤可操作的
  `<button>`，不是純滑鼠 `onClick` 的 `<div>`）。

新增 i18n key（`frontend/lib/i18n/messages.ts` 新增 `traceDetail`
區塊，append-only，不改動既有任何區塊）：

```ts
traceDetail: {
  header: { title: "執行詳情" },
  empty: "查無資料",
  expand: "展開查看個別",
  collapse: "收合",
  repeatBadge: (count: number) => `× ${count}`,
  footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端 trace/span 查詢。" },
},
```

## 跨元素樣式耦合測試檢查

`Grep("toEqual|一致|consistent", path="frontend/e2e")` 無結果（與
SDLCCT-55 設計文件記錄的檢查結果一致，本 repo 目前 e2e 測試套件中不
存在任何跨元素樣式一致性的鏈式斷言）。本票新增/變更的 selector：

- `TopTracesTable` 的 `<tr>`：新增 `onClick`/`onKeyDown`/
  `role="button"`/`tabIndex`，**不變更任何既有 CSS class**
  （`cursor-pointer border-b ... hover:bg-gray-50` 原樣保留）——純增加
  互動行為屬性，不觸碰 computed style，因此即使存在樣式耦合測試也不
  受影響。已確認 `frontend/e2e/agent-detail.spec.ts` 既有「AC4:
  top_traces rows are visually clickable but clicking triggers no
  navigation or new network request」一測會因本票新增 `onClick` 導覽
  行為而**預期失效**（該測試斷言點擊後 `page.url()` 不變、
  `requestCount === 0`）——這不是樣式耦合測試，是 SDLCCT-48 當時明文
  「AC4 以外的互動排除在範圍外」所寫下的行為斷言，本票的 G1 規格明確
  要求新增該互動，因此該既有測試需要在開發階段同步更新（移除或改寫此
  斷言），已在此處記錄，不留給開發者自行發現。
- 其餘新增 selector（`trace-detail` 目錄下所有元件）全部是本票新增的
  全新元件，不存在既有耦合測試可能涉及它們。

## 開放設計問題

（無）
