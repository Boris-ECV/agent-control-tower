# 設計文件 — SDLCCT-108 Agent 清單：搜尋框與部門／狀態篩選

## 對應需求規格
G1 核准版本（見 ticket SDLCCT-108 描述與 6 條 Gherkin AC，拆分自
SDLCCT-85 第 4 條）：
1. 搜尋框依「部門」子字串、不分大小寫比對（Scenario「搜尋 Agent（依部門）」）。
2. 搜尋框依「系統代號」（`AgentRegistryEntry.key`）子字串比對
   （Scenario「搜尋 Agent（依系統代號）」）。
   以上兩個 Gherkin 情境是驗收測試範例，不是搜尋比對欄位的全部清單——
   ticket「範圍與修正方向」原文明確列出 4 個欄位：`display`（名稱）、
   `dept`（部門）、`owner`（負責人）、`key`（系統代號），皆不分大小寫、
   子字串比對（任一欄位符合即算符合）。本設計依此 4 欄位實作，見決策 2。
3. 部門下拉選單可篩選特定部門（Scenario「部門下拉篩選」）。
4. 狀態篩選（沿用既有 `has_governance_gap` 三態：全部／治理缺口／正常）
   （Scenario「狀態篩選」）。
5. 搜尋字詞、部門篩選、狀態篩選三者以 AND 疊加（Scenario「篩選條件疊加」）。
6. 篩選結果為空時顯示空狀態提示，不顯示表格列（Scenario「篩選結果為空」）。

依賴 SDLCCT-82（已 Done，`SegmentedFilter` 共用元件與三態
`has_governance_gap`／`governanceBadge` 文案慣例，已在 SDLCCT-84 的
`anomalies/page.tsx` 驗證過用法）。讀取現狀確認：本頁已在 SDLCCT-105/107
加入 null-placeholder 與 progress-bar 功能（`frontend/app/agents/page.tsx`
目前的 `AgentTable`/`AgentCardList`/`BudgetConsumedPct` 結構），本票只在
「要渲染哪些列」這一層加篩選，不改動既有欄位渲染邏輯。

範圍外：不新增後端查詢參數（純前端 client-side 篩選，資料仍一次性載入
全部 ~9 個 Agent）；不處理 sparkline 合計、預算進度條、既有欄位格式與
佔位樣式（其他已 Done 的拆分子單）；不處理排序功能。

## 介面/API 契約
無新增/變更端點。沿用既有 `GET /api/agents`
（`frontend/lib/agents-api.ts` `fetchAgentsList`），回應型別
`AgentsListResponse`/`AgentRegistryEntry`（`frontend/lib/generated/bff-types.ts`）
已包含本票所需欄位（`key`、`dept`、`has_governance_gap`），不需 bff 變更。
篩選完全是前端記憶體內操作，資料仍一次載入全部 Agent 後在 client 端過濾。

## 資料模型
無新增資料模型。沿用既有 `AgentsListResponse`/`AgentRegistryEntry` schema
（SDLCCT-82/105/107 已定義）。

## 關鍵技術決策

1. **搜尋框為單一受控 `<input>`（`useState<string>`），不加 debounce。**
   理由：資料集固定約 9 筆、已一次性載入記憶體，過濾是同步的陣列
   `.filter()`，沒有 debounce 要解決的效能問題；加 debounce 只會讓少量
   資料下的互動感覺變慢，且違反 CONSTITUTION「Scope discipline」—— 不
   為沒出現的效能問題預先設計。

2. **過濾邏輯集中在 `AgentsPage` 內一個 `useMemo`（`filteredAgents`），
   同時套用 search／dept／status 三個條件（AND 組合），結果同時傳給
   `AgentTable` 與 `AgentCardList`。**
   理由：避免兩個元件各自重算一次或產生不一致的過濾結果；`useMemo` 的
   依賴是 `[state, searchTerm, deptFilter, statusFilter]`，只在這些值
   改變時重新計算，資料量小但仍遵循既有 `useMemo` 慣例（本頁
   `Sparkline`/既有其他頁面皆用 `useMemo` 做派生資料，如
   `anomalies/page.tsx` 的 `agentDisplayNames`）。搜尋同時比對
   `display`／`dept`／`owner`／`key` 四個欄位（任一符合即算符合搜尋詞，
   OR——依 ticket「範圍與修正方向」原文列出的 4 個欄位，不只 Gherkin
   情境示範到的 dept/key 兩個），再與 dept 下拉、狀態篩選以 AND 疊加。
   `owner` 可能為 `null`（SDLCCT-105 的 unknown-owner 佔位情形），比對前
   null-guard：`null` 視為該欄位不符合，不丟例外：
   ```ts
   const term = searchTerm.trim().toLowerCase();
   const filteredAgents = useMemo(() => {
     if (state.status !== "success") return [];
     return state.data.agents.filter((agent) => {
       if (deptFilter !== "all" && agent.dept !== deptFilter) return false;
       if (statusFilter === "gap" && !agent.has_governance_gap) return false;
       if (statusFilter === "ok" && agent.has_governance_gap) return false;
       if (
         term &&
         !agent.display.toLowerCase().includes(term) &&
         !agent.dept.toLowerCase().includes(term) &&
         !(agent.owner !== null && agent.owner.toLowerCase().includes(term)) &&
         !agent.key.toLowerCase().includes(term)
       ) {
         return false;
       }
       return true;
     });
   }, [state, searchTerm, deptFilter, statusFilter]);
   ```

3. **部門下拉選單的選項清單（dedup + 排序）來自「未篩選」的原始
   `state.data.agents`，不是來自已被其他篩選條件縮小後的子集。**
   理由：若選項清單會隨使用者輸入搜尋詞或選擇狀態篩選而動態增減，使用者
   在清空搜尋詞後可能發現某個部門選項「消失了又出現」，體驗混亂；AC
   的「篩選條件疊加」情境也隱含三個篩選器彼此獨立、互不影響彼此的可選
   範圍。選項另加一個 `"all"` sentinel 值對應「全部部門」，實際部門值
   用 `Array.from(new Set(agents.map(a => a.dept))).sort()`（字串排序，
   確保結果與資料載入順序無關，可重現）。

4. **狀態篩選直接沿用既有 `SegmentedFilter` 元件（不修改其 props）**，
   仿照 `anomalies/page.tsx` 既有用法：三個選項 `"all" | "gap" | "ok"`，
   標籤分別為「全部」／沿用既有 `agents.governanceBadge.hasGap`
   （「治理缺口」）／`agents.governanceBadge.ok`（「正常」），不新增這兩
   個既有文案的重複 key。`SegmentedFilter` 的 `countLabel` prop 為
   optional，本票刻意不傳——AC 六個情境都沒有要求「顯示 X / Y 筆」的
   計數文字，不比照 `anomalies/page.tsx` 多加這項（CONSTITUTION
   「Scope discipline」：實作規格要求的,不是「看到別處有就順手加」）。

5. **空狀態不新增共用元件，直接比照既有 `anomalies/page.tsx` 的模式**：
   `filteredAgents.length === 0` 時，不渲染 `AgentTable`/`AgentCardList`
   （兩者皆不渲染，不只是表格——AC 文字「不顯示表格列」在桌面版對應
   `<table>` 不出現任何 `<tr>`，行動版同理不出現任何卡片），改渲染一段
   `<p>` 提示文字。新增 i18n key `agents.filter.empty`（不重用
   `anomalies.empty`「目前沒有異常」——比照 SDLCCT-105 的決策先例，不
   跨模組共用語意不同的字串，「沒有符合篩選條件的 Agent」與「沒有異常」
   語意不同）。

6. **搜尋框與部門下拉皆使用可見的 `<label>`（`htmlFor`/`id` 對應），不
   只靠 `placeholder`。**
   理由：`docs/design-system.md` 第 8 節「表單 label 規則」明確規定
   「不可僅用 `placeholder` 取代 label」，這是本頁第一次加入
   `<input>`/`<select>`，直接依規範實作、不另外判斷。兩個 label 文字
   皆為新增 i18n key（`agents.filter.searchLabel` 搜尋欄位、
   `agents.filter.deptLabel` 部門欄位），視覺上以 `text-sm
   text-text-secondary` 顯示在對應欄位上方（與既有頁面次要文字樣式
   一致），並非僅視覺隱藏——保留可見標籤同時滿足可及性與一般使用者可讀
   性，不額外引入 `sr-only` 這個本專案目前沒有的樣式慣例。狀態篩選沿用
   `SegmentedFilter` 既有的 `aria-label` prop（新增
   `agents.filter.statusAriaLabel`「依治理狀態篩選」），比照
   `anomalies/page.tsx` 既有用法（該元件本身不內嵌 `<label>`，用
   `aria-label` 是其既定介面，非本票新發明）。

7. **新增的篩選列（搜尋框＋部門下拉＋狀態 SegmentedFilter）固定顯示在
   `state.status === "success"` 分支內、`AgentTable`/`AgentCardList`
   之上，loading/error 狀態不顯示篩選列。**
   理由：篩選作用的對象是已載入的資料，資料還沒載入或載入失敗時顯示篩選
   UI 沒有意義（使用者篩選了也沒有結果可看，且 `filteredAgents` 在非
   success 狀態回傳空陣列，若篩選列仍顯示會跟一個「找不到資料」的空清單
   混淆，無法分辨是『真的篩選不到』還是『資料根本沒載入成功』）。

## UI 原型
見 `docs/design/SDLCCT-108-prototype.html`（可直接在瀏覽器開啟）。展示：
- 篩選列：搜尋框（含可見 label「搜尋」）＋部門下拉（含可見 label
  「部門」，選項「全部部門」／「Sales」／「Support」／「Ops」）＋狀態
  `SegmentedFilter`（「全部」／「治理缺口」／「正常」，比照既有視覺）。
- 一組套用搜尋詞「sales」後只顯示 1 筆（`display`／`dept`／`owner`／
  `key` 任一欄位含 "sales"）的清單示意。
- 一組篩選結果為空的狀態：不顯示表格，只顯示「沒有符合篩選條件的
  Agent」提示文字。

## 開放設計問題(定稿時必須為空)
無。
