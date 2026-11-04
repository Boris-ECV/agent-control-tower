# 設計文件 — SDLCCT-117 執行詳情頁：標籤列與摘要列（Agent/廠別/版本/部門/觸發方式 + 開始時間/總耗時/Span 數/預估成本）

## 對應需求規格

G1 核准版本（拆分自 SDLCCT-87 原始範圍第 2、3 條），4 條 Gherkin AC：

1. 標題下方新增標籤列，依序顯示 Agent／廠別／版本／部門／觸發方式。
2. 任一標籤值為 `null` 時該標籤整個不渲染（不顯示「部門：—」或空白標籤）。
3. 標籤列下方新增摘要列，依序顯示開始時間（含日期）、總耗時
   （`X.Xs`）、Span 數（整數）、預估成本（貨幣格式）。
4. `spans` 為空陣列時標籤列仍正常顯示；摘要列的開始時間/總耗時退回
   「—」，Span 數顯示 `0`，預估成本不受影響（仍依自身值顯示）。

**依賴**：SDLCCT-116（已合併，`GET /api/agents/{key}/traces/{trace_id}/
spans` 回應新增 `plant`/`deployed_version`/`dept`/`trigger`/
`total_estimated_cost` 五個欄位，皆為 `string | null`／`float | null`，
見 `docs/design/SDLCCT-116.md` 介面契約段落）；SDLCCT-82（已 Done，共用
樣式規則，本票套用其既有格式函式慣例，見決策 4）。

**範圍外**（已於 G1 核准）：瀑布圖（SDLCCT-118）；span 列表排序/上色
（SDLCCT-115）；任何新增 BFF 欄位（純前端消費既有 SDLCCT-116 欄位）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/trace-detail/trace-detail-content.tsx`：目前只有
  `<header>`（`TraceBreadcrumbs`/`TraceBackLink`）與 `<main>` 內
  `<h1>`/`TraceIdCopy` + 三種 fetch 狀態分支（`loading`/`error`/
  `success`，`success` 再依 `spans.length` 分兩種畫面）。本票在
  `TraceIdCopy` 之後、既有三個狀態分支之前新增兩個區塊，只在
  `state.status === "success"` 時渲染（loading/error 畫面不變,
  規格全部場景皆以「渲染完成」/「進入該執行詳情頁」描述，指的是成功取
  得資料後的畫面，不要求 loading/error 骨架跟著改動）。
- `frontend/lib/trace-spans-api.ts`：`TraceSpansResponse`/`SpanTreeNode`
  型別直接從 `frontend/lib/generated/bff-types.ts`（openapi-typescript
  產出）引入，**目前該檔案尚未包含 SDLCCT-116 新增的五個欄位**——
  `bff/openapi.json` 的 schema 已在 SDLCCT-116 合併，但前端尚未重新執行
  `npm run generate:types`（`frontend/package.json` 第 12 行：
  `openapi-typescript ../bff/openapi.json -o lib/generated/bff-types.ts`）。
  本票開發第一步須重新執行此指令同步型別，屬機械性步驟，不是設計決策。
- `frontend/components/trace-detail/span-tree-row.tsx`：`SpanTreeNode`
  含 `id`/`name`/`type`/`start_time`/`end_time`/`children`
  （`children: SpanTreeNode[]`，遞迴樹狀），`start_time`/`end_time` 皆
  `string | null`（第 46 行 `formatSlashDateTime(node.start_time)` 已
  以 nullable 處理）。既有「type」標籤視覺樣式（27-37 行）：
  `rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary`。
- `frontend/components/trace-detail/group-spans.ts`：既有慣例——純函式
  只做「同層兄弟節點的顯示分組」，不改變樹狀結構本身，也不影響節點總數
  的計算；本票新增的 span 計數/時間範圍計算同樣是「對樹狀結構的一次性
  資料整形」，與分組/展開狀態（UI 互動狀態）完全獨立。
- `frontend/lib/agent-display.ts::useAgentDisplayName(key)`：已有快取,
  若取不到 display name 會 fallback 回傳 `key` 本身（49 行
  `return key;`），**永遠回傳非空字串，不會是 `null`**——本票 Agent 標
  籤因此永遠渲染，不需要額外的「null 時隱藏」判斷。
- `frontend/lib/format.ts`：`formatTaiwanDateTime`（112 行）與
  `formatCurrency`（58 行）皆已標記 `@deprecated`（建議改用
  `formatSlashDateTime`/`formatCardCurrency`），但規格背景段落逐字指名
  使用這兩個既有函式——見決策 4，直接依規格文字採用，不另行「修正」為
  非 deprecated 版本。目前沒有任何既有函式計算「秒數轉 `X.Xs` 字串」,
  需新增（見決策 3）。
- `frontend/components/common/status-badge.tsx`：`StatusBadge` 專門表達
  `success`/`danger`/`warning` 三種語意狀態（色點＋底色對比,
  SDLCCT-100/84 決策),本票的五個標籤只是中性 metadata,不是狀態,不應
  借用 `StatusBadge`——見決策 2。
- 跨元素樣式耦合檢查（流程第 4 步)：全 repo 搜尋
  `toEqual|getComputedStyle|一致`,在 `frontend/e2e/` 與
  `frontend/components/**/*.test.tsx` 中唯一命中且與
  `trace-detail`/`span-tree-row` 相關的是 `frontend/e2e/
  trace-detail.spec.ts` 第 114-116 行,比較的是 `SpanTreeRow` 父子節點
  的 `paddingLeft`（縮排關係),與本票新增的標籤列/摘要列（渲染在
  `SpanTreeRow` 之外、`<main>` 更上方)完全無關,也沒有任何測試要求標籤
  列的 badge 樣式與其他元件的 badge（如 `StatusBadge`）保持一致。不適
  用,無開放問題。

## 介面/API 契約

無新增/變更 BFF 端點。純前端消費 SDLCCT-116 已合併的既有回應欄位（型
別定義見 `docs/design/SDLCCT-116.md`）：

```ts
// frontend/lib/trace-spans-api.ts（型別來自重新產生後的 bff-types.ts）
type TraceSpansResponse = {
  key: string;
  trace_id: string;
  spans: SpanTreeNode[];
  plant: string | null;
  deployed_version: string | null;
  dept: string | null;
  trigger: string | null;
  total_estimated_cost: number | null;
};
```

新增兩個純展示元件與一個純函式，供 `trace-detail-content.tsx` 的
`success` 分支使用：

```ts
// frontend/components/trace-detail/trace-meta-tags.tsx
export function TraceMetaTags(props: {
  agentName: string;            // 永不為 null（見現狀查核）
  plant: string | null;
  deployedVersion: string | null;
  dept: string | null;
  trigger: string | null;
}): JSX.Element;

// frontend/components/trace-detail/trace-summary-row.tsx
export function TraceSummaryRow(props: {
  startIso: string | null;
  durationSeconds: number | null;
  spanCount: number;
  totalEstimatedCost: number | null;
}): JSX.Element;

// frontend/components/trace-detail/span-summary.ts
export function computeSpanSummary(nodes: SpanTreeNode[]): {
  startIso: string | null;
  durationSeconds: number | null;
  count: number;
};
```

`trace-detail-content.tsx` 呼叫端（示意,接在既有 `<TraceIdCopy
traceId={traceId} />` 之後、既有三個狀態分支之前)：

```tsx
const agentName = useAgentDisplayName(key);

{state.status === "success" && (() => {
  const { startIso, durationSeconds, count } = computeSpanSummary(state.data.spans);
  return (
    <>
      <TraceMetaTags
        agentName={agentName}
        plant={state.data.plant}
        deployedVersion={state.data.deployed_version}
        dept={state.data.dept}
        trigger={state.data.trigger}
      />
      <TraceSummaryRow
        startIso={startIso}
        durationSeconds={durationSeconds}
        spanCount={count}
        totalEstimatedCost={state.data.total_estimated_cost}
      />
    </>
  );
})()}
{/* 既有 state.data.spans.length === 0 / > 0 兩個分支不變，接續在下方 */}
```

## 資料模型

無新增資料模型。前端開發第一步須重新執行
`npm run generate:types`（`frontend/package.json`)以同步
`frontend/lib/generated/bff-types.ts` 到 SDLCCT-116 已合併的
`bff/openapi.json` schema——機械性同步步驟,不是本票的設計決策,但必須
在實作前完成,否則 `TraceSpansResponse` 型別仍缺五個新欄位會導致
TypeScript 編譯錯誤。

## 關鍵技術決策

1. **Agent 標籤永遠渲染,不套用「null 時不顯示」規則。**
   理由：`useAgentDisplayName()` 的既有 contract 保證永遠回傳非空字串
   （查不到 display name 時 fallback 回 `key` 本身),不存在
   `null`/空字串的情況,因此規格 Scenario 2「標籤值為 null 時不顯示」
   只適用於另外四個（plant/deployed_version/dept/trigger)欄位,Agent
   不需要額外的條件判斷,也不會造成「Agent 標籤消失」的意外行為。

2. **五個標籤沿用 `span-tree-row.tsx` 既有的「type」中性標籤視覺樣式
   （`rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary`),
   不借用 `StatusBadge`,也不新增第三種標籤元件。**
   理由：`StatusBadge`（SDLCCT-100/84)的 `success`/`danger`/`warning`
   三個 variant 專門表達二元或三態的狀態語意（底色對比度皆已針對這三
   態驗證),本票的五個標籤（Agent/廠別/版本/部門/觸發方式)只是中性
   metadata,沒有任何「正常/異常」的語意,借用 `StatusBadge` 會讓它的
   variant 系統被迫塞進一個不存在的語意分類。沿用既有的中性 badge
   class（已在同一元件家族的 `span-tree-row.tsx` 使用過),符合
   CONSTITUTION「Code style — 遵循既有慣例優先於個人偏好」,不新發明
   樣式也不誤用語意元件。

3. **新增純函式 `computeSpanSummary()`（`span-summary.ts`),遞迴走訪
   `spans` 樹的所有層級,獨立計算「最早 start_time／最晚 end_time／節
   點總數」,與 `group-spans.ts` 的顯示分組/展開收合狀態完全無關。**
   ```ts
   export function computeSpanSummary(nodes: SpanTreeNode[]) {
     let earliestStart: number | null = null;
     let latestEnd: number | null = null;
     let count = 0;
     const visit = (list: SpanTreeNode[]) => {
       for (const node of list) {
         count += 1;
         if (node.start_time) {
           const t = new Date(node.start_time).getTime();
           if (!Number.isNaN(t) && (earliestStart === null || t < earliestStart)) earliestStart = t;
         }
         if (node.end_time) {
           const t = new Date(node.end_time).getTime();
           if (!Number.isNaN(t) && (latestEnd === null || t > latestEnd)) latestEnd = t;
         }
         if (node.children.length > 0) visit(node.children);
       }
     };
     visit(nodes);
     return {
       startIso: earliestStart !== null ? new Date(earliestStart).toISOString() : null,
       durationSeconds: earliestStart !== null && latestEnd !== null ? (latestEnd - earliestStart) / 1000 : null,
       count,
     };
   }
   ```
   理由：規格「Span 數」明文定義為「樹狀結構展開後的總節點數,含所有層
   級」——`group-spans.ts` 的同名兄弟分組只影響「畫面上顯示幾個可展開
   的列」,不改變樹狀結構本身或節點總數,兩者是不同的資料維度,沿用
   `group-spans.ts` 已確立的「顯示層分組與資料結構計算分離」慣例
   （該檔案註解已明文「display-layer-only」),不在 `computeSpanSummary`
   裡耦合任何 UI 展開/收合狀態。`node.start_time`/`end_time` 本身可為
   `null`（既有 `SpanTreeNode` 型別),遞迴時逐節點各自判斷、跳過
   `null`,不特別處理「spans 非空但所有時間皆 null」這種規格未覆蓋的邊
   界情況——它自然落在既有「找不到任何非 null 時間則回傳 `null`」的通
   用路徑,不需要為它新增分支,行為與既有 `SpanTreeNode` 逐欄位
   nullable 的既有慣例一致。

4. **開始時間用既有 `formatTaiwanDateTime()`、預估成本用既有
   `formatCurrency()`,即使兩者都已標記 `@deprecated`。**
   理由：規格背景/範圍段落逐字指名「用既有 `formatTaiwanDateTime`」與
   「用既有 `formatCurrency`」,這是規格文字本身給的具體格式化函式名
   稱,不是本設計要臆測的空白——依規格逐字採用,不擅自「修正」為專案
   較新的 `formatSlashDateTime`/`formatCardCurrency`（那是本票規格沒
   有要求的額外改動,屬於範圍外)。两者雖被標記 deprecated,但函式本
   身仍存在、仍可正常呼叫,不影響行為正確性;若未來有獨立 story 要統一
   全站格式化函式,那是另一個 story 的範圍,不在本票展開。

5. **新增 `formatDurationSeconds()` 於 `frontend/lib/format.ts`,四捨
   五入到小數點後一位、輸出 `X.Xs`。**
   ```ts
   export function formatDurationSeconds(seconds: number | null | undefined): string {
     if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
     return `${seconds.toFixed(1)}s`;
   }
   ```
   理由：專案目前沒有任何「秒數轉顯示字串」的既有函式,規格明文要求
   `X.Xs` 格式與四捨五入到 0.1 秒,`toFixed(1)` 是最直接的對應實作,放
   在 `format.ts` 與既有 `formatCurrency`/`formatTaiwanDateTime` 同檔,
   延續「展示層格式化集中在這個檔案」的既有慣例（檔案開頭註解:「台灣
   時間換算在前端/展示層」),不另開新檔案。

6. **標籤列與摘要列只在 `state.status === "success"` 時渲染（涵蓋
   `spans` 為空陣列與非空陣列兩種既有子分支),loading/error 畫面維持
   現狀不變。**
   理由：四條 AC 的 Given 子句（「執行詳情頁渲染完成」「使用者進入該
   執行詳情頁」)描述的都是資料已成功取得後的畫面,規格沒有要求
   loading 骨架或 error 卡片也要顯示標籤列/摘要列——依 CONSTITUTION
   「Scope discipline — 實作只做規格要求的事」,不額外設計規格未提及
   的 loading/error 版面變化。

## UI 原型

見 `docs/design/SDLCCT-117-prototype.html`（可直接在瀏覽器開啟)。展示：
- 狀態 A：五個標籤皆有值 + spans 非空（摘要列四個值皆為實際資料)。
- 狀態 B：部門為 `null`（標籤列只顯示 4 個標籤,不出現「部門：—」)。
- 狀態 C：`spans` 為空陣列(標籤列正常顯示;摘要列開始時間/總耗時顯示
  「—」、Span 數顯示 `0`、預估成本仍依自身值顯示)。

## 跨元素樣式耦合測試檢查

已完成(見上方「現狀查核」最後一項)。本票新增的標籤列/摘要列不變更
任何既有 selector 的 computed style,`frontend/e2e/trace-detail.spec.ts`
唯一的 `getComputedStyle` 斷言比較的是 `SpanTreeRow` 父子節點縮排,與
本票改動範圍無關。無鏈式斷言,無開放問題。

## 開放設計問題(定稿時必須為空)

無。
