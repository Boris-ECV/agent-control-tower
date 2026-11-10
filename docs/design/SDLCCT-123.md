# 設計文件 — SDLCCT-123 異常清單：新增依 Agent 篩選維度

## 對應需求規格

G1 核准版本（本 session 已修正範圍：原票 4 條 AC 中 3 條已由 SDLCCT-52
交付，此票僅剩「在既有 `/anomalies` 頁面新增一個依 Agent 篩選的維度，與
既有『異常類型』篩選器並列、以 AND 條件組合」）。4 條新 Gherkin 情境：

1. 選擇特定 Agent → 只顯示該 Agent 的列，計數文字隨結果更新。
2. Agent 篩選與異常類型篩選可同時生效（AND），任一個改回「全部」時另一個
   仍維持生效。
3. 清除 Agent 篩選回到「全部」→ 重新顯示所有符合目前異常類型篩選的列。
4. `agent === null` 的列：選「全部」時仍依現有邏輯顯示（顯示「不明」），
   選特定 Agent 篩選時不出現在結果中。

（另有 3 條既有行為的非回歸情境：清單顯示、異常類型篩選、錯誤狀態——皆為
SDLCCT-52 已交付行為，本票不重新設計，只需维持通過。）

**範圍外**：重新實作已上線的清單呈現/類型篩選/錯誤狀態；任何後端變更；
預算/告警；執行明細畫面；異常處置動作；以完整 Agent registry（而非清單
中實際出現的 Agent）產生篩選選項。

**限制**：必須重用 `fetchAgentsList()`/`agentDisplayNames`；沿用
`SegmentedFilter`；新 i18n key 沿用 `anomalies.filter.*` 命名慣例。

**依賴**：`GET /api/anomalies`（SDLCCT-51，已上線）、`GET /api/agents`
（已上線）、SDLCCT-52（已完成，本票疊加其上）。

**現況盤點**（實作前已逐字讀取的既有程式碼事實）：

- `frontend/app/anomalies/page.tsx`：目前只有一個篩選維度
  `const [filter, setFilter] = useState<AnomalyTypeFilter>("all")`，
  `filteredRows = filter === "all" ? allRows : allRows.filter((row) =>
  row.anomaly_type === filter)`。`allRows` 已經是 enrich 過的
  `EnrichedAnomalyRow[]`（join 了 `agentDisplayNames`）。`agentDisplayNames`
  是 `Map<string, string>`，由 `fetchAgentsList()` 回應的
  `agent.key -> agent.display` 建立，agents 請求失敗時為空 Map（fallback，
  不阻斷整頁渲染）。`okRows`/`errorRows` 皆從 `filteredRows` 拆分而來，所以
  任何新增的篩選只要作用在 `filteredRows` 的推導上，`okRows`/`errorRows`/
  `AnomalyTable`/`AnomalyErrorBanner` 完全不需要改動。
- `frontend/components/common/segmented-filter.tsx`（SDLCCT-102）：泛型
  `SegmentedFilter<Value extends string>({ options, value, onChange,
  "aria-label", countLabel })`，`countLabel` 為選填 `ReactNode`。本票是它
  第二個獨立實例（並非擴充元件本身）——與 SDLCCT-111 新增廠別篩選時的作
  法相同模式。
- `frontend/components/anomalies/anomaly-table.tsx`／`anomaly-error-
  banner.tsx`：皆只消費已經篩選完的 rows 作為 props，內部不含任何篩選邏
  輯，本票不需改動這兩個元件。
- `frontend/lib/anomalies-api.ts`：`AnomalyRow.agent: string | null`（由
  `bff-types.ts` 生成型別推得），`agent` 即系統代號，與
  `agents-api.ts` 的 `AgentRegistryEntry.key` 同值域。
- `frontend/lib/agents-api.ts`：`AgentsListResponse.agents:
  AgentRegistryEntry[]`，每個 entry 含 `key`（系統代號）與 `display`（中文
  名稱）。
- `frontend/lib/i18n/messages.ts` 第 146–150 行 `anomalies.filter`
  命名空間：`all`（"全部"）、`count`（函式訊息 `顯示 ${shown} / ${total}`）、
  `ariaLabel`（"依異常類型篩選"，為既有類型篩選器專用）。本票新增一個鍵
  `agentAriaLabel`，沿用同一命名慣例，不動既有 `ariaLabel` 的語意（它仍
  專指類型篩選器，避免改名造成既有呼叫端語意混淆）。

**跨元素樣式耦合測試檢查**（流程第 4 步）：全 repo 搜尋
`toEqual|getComputedStyle|一致`，命中的 9 個檔案
（`trace-detail.spec.ts`、`back-link.acceptance.spec.ts`、
`breadcrumbs.acceptance.spec.ts`、`breadcrumbs.spec.ts`、
`currency-rollout.acceptance.spec.ts`、`date-rollout.acceptance.spec.ts`、
`page-header-timestamp.spec.ts`、`agent-detail.spec.ts`、`agents.spec.ts`）
皆不涉及 `/anomalies` 頁面選擇器，比對對象也都是與本票無關的其他頁面/
元件（麵包屑、返回連結、幣別/日期顯示、header timestamp、agent 明細
頁）。本票改動的 `SegmentedFilter` 第二實例與 `/anomalies` 頁面既有選擇器
均未出現在任何這些檔案的比對鏈中。**未發現**任何將本票要改動的選擇器與
另一元件計算樣式綁定相等的鏈式耦合測試。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點或回應格式，純前端消費既有
`GET /api/anomalies`（`AnomalyRow[]`，含 `agent: string | null`）與既有
`GET /api/agents`（`AgentRegistryEntry[]`，含 `key`/`display`）兩個端點
既有回應。

**前端狀態與篩選組合方式**（具體到不需 developer 自行發明）：

```tsx
// 既有，不變
const [filter, setFilter] = useState<AnomalyTypeFilter>("all");

// 新增：第二個獨立 useState，與既有 filter 完全不互相依賴
type AgentFilterValue = "all" | string; // "all" 或某個 AnomalyRow.agent 系統代號
const [agentFilter, setAgentFilter] = useState<AgentFilterValue>("all");

// 篩選選項：從「未篩選的原始 allRows」算出候選值，不隨另一個篩選條件縮小
// （沿用 SDLCCT-108/111 既有慣例——避免選了某個 Agent 後，類型篩選器把其
// 他 Agent 選項也跟著拿掉），以 agentDisplayNames 顯示文字排序（見下方
// 決策 1 說明排序規則），排除 agent === null 的列。
const agentFilterOptions = useMemo(() => {
  const seen = new Map<string, string>(); // code -> 顯示用 label
  for (const row of allRows) {
    if (row.agent !== null && !seen.has(row.agent)) {
      seen.set(row.agent, agentDisplayNames.get(row.agent) ?? row.agent);
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"))
    .map(([code, label]) => ({ value: code, label }));
}, [allRows, agentDisplayNames]);

// AND 組合：先套用既有類型篩選，再套用新 Agent 篩選（鏈式 .filter()，
// 兩者互相獨立，任一個改回 "all" 不影響另一個已套用的條件）
const typeFilteredRows =
  filter === "all" ? allRows : allRows.filter((row) => row.anomaly_type === filter);
const filteredRows =
  agentFilter === "all"
    ? typeFilteredRows
    : typeFilteredRows.filter((row) => row.agent === agentFilter);
```

- `okRows`/`errorRows` 的推導方式（`filteredRows.filter((row) => row.status
  === "ok" | "error")`）完全不變，只是輸入來源換成上面新的 `filteredRows`。
- 版面：兩個 `SegmentedFilter` 實例並列於同一個工具列區塊，新增的 Agent
  篩選器放在既有類型篩選器**上方**（獨立一行），既有類型篩選器＋
  `countLabel` 那一行的 JSX 結構與位置完全不變（降低既有行為/既有 e2e
  斷言的 diff 面積，見下方關鍵決策 2）：

```tsx
<div className="mb-4 flex flex-col gap-3">
  <SegmentedFilter<AgentFilterValue>
    aria-label={t("anomalies.filter.agentAriaLabel")}
    options={[{ value: "all", label: t("anomalies.filter.all") }, ...agentFilterOptions]}
    value={agentFilter}
    onChange={setAgentFilter}
  />
  <SegmentedFilter<AnomalyTypeFilter>
    aria-label={t("anomalies.filter.ariaLabel")}
    options={FILTER_OPTIONS}
    value={filter}
    onChange={setFilter}
    countLabel={t("anomalies.filter.count")(filteredRows.length, allRows.length)}
  />
</div>
```

- 新 i18n key：`anomalies.filter.agentAriaLabel: "依 Agent 篩選"`（放在既有
  `anomalies.filter` 命名空間下，與 `ariaLabel`/`all`/`count` 同層級）。
  既有 `anomalies.filter.all`/`count`/`ariaLabel` 三個鍵直接重用，不新增
  重複文案。

## 資料模型

無新增資料模型。純粹是前端針對既有 SDLCCT-51 `GET /api/anomalies` 回應
資料（`AnomalyRow[]`）新增的一個衍生篩選維度（第二個 `useState` + 一次
`.filter()`），不涉及任何資料表、欄位、索引或 API 回應格式變更——已於上
方「介面/API 契約」段落逐一核對既有程式碼確認為真，不是未經檢查的假設。

## 關鍵技術決策

### 1. Agent 篩選選項排序：依顯示名稱（`agentDisplayNames` 查表結果，無對照
時 fallback 系統代號本身）用 `localeCompare("zh-Hant")` 排序，而非依系統
代號字母順序或清單中首次出現順序

理由：選項顯示給使用者看的文字是中文顯示名稱（`agentDisplayNames` join
結果），依系統代號排序（如 `order_status` vs `顯示名稱`）會讓排序順序與
畫面上看到的文字順序不一致、不利掃視；依「清單中首次出現順序」則會隨著
後端回傳順序或資料刷新而不穩定，對使用者而言是隨機排序。依顯示文字排序
是對使用者最直覺、最穩定的呈現方式，且與既有 `FILTER_OPTIONS`（異常類
型，固定順序）風格一致——這裡沒有固定順序可用（Agent 集合是動態的），
依顯示文字排序是最貼近「固定順序」精神的替代方案。選項候選值來源明確要
求「目前清單資料中實際出現的 Agent」（spec 範圍段落原文），故排除
`agent === null` 的列，且候選值從**未篩選的原始 `allRows`** 算出（不受
另一個篩選條件縮小），沿用 SDLCCT-108/111 已定案的既有慣例（見現況盤點）。

### 2. 新 Agent 篩選器放在既有類型篩選器**上方**獨立一行，而非同一行並排
或取代既有 `countLabel` 所在行

理由：(1) spec 原文只要求「並列顯示」，未規定左右或上下順序，版面順序
本身不是規格逼出的產品決策；(2) 既有類型篩選器那一行的 JSX（含
`countLabel` 掛載位置）完全不變，新增的 Agent 篩選器是獨立插入的一整行，
對既有行為/既有 e2e 斷言（若有鎖定該行 DOM 結構的斷言）影響最小，符合
CONSTITUTION「小改動配小設計」——不因新增一個篩選維度而重排既有元件的
既有結構。兩個篩選器所在的外層 `<div>` 由 `className="mb-4"` 改為
`className="mb-4 flex flex-col gap-3"`，是唯一需要變動的既有容器屬性。

### 3. `agent === null` 的列：排除於 Agent 篩選選項之外，且當 Agent 篩選為
特定值時一律不出現在結果中（不新增「不明」作為可選篩選值）

理由：Gherkin AC4 逐字要求「該列不出現在篩選結果中」（當選擇特定
Agent），且範圍段落明文「篩選選項來自目前清單資料中實際出現的 Agent」——
`agent === null` 不是一個 Agent 值，不應該出現在選項清單中（也沒有系統代
號可供比對）。選「全部」時該列依現有 SDLCCT-52 邏輯顯示「不明」，本票不
改動這個既有行為（`agentDisplay`/`unknownAgent` 的呈現邏輯完全不變，只是
它是否「進入」`filteredRows` 現在多了一個會被 Agent 篩選排除的條件分支）。

### 4. 計數文字（`countLabel`）維持只掛在既有類型篩選器那一行，不替 Agent
篩選器新增第二個計數文字

理由：Gherkin AC 原文「計數文字隨篩選結果更新」只提到一份計數文字，且既
有 `countLabel` 的運算式 `filteredRows.length / allRows.length` 本身已經
反映兩個篩選維度 AND 組合後的結果（因為 `filteredRows` 的定義已經是兩次
`.filter()` 疊加後的結果），不需要為 Agent 篩選器另外計算一份語意重複的
計數文字。

## UI 原型

見 `docs/design/SDLCCT-123-prototype.html`（可直接在瀏覽器開啟）。本票屬
於「新增一個篩選維度」類型的小改動，依此 repo 既有precedent（SDLCCT-108
新增部門下拉、SDLCCT-111 新增廠別篩選，皆屬同等規模的新增篩選維度，皆附
靜態原型），而非 SDLCCT-35 那類「純文字置換、不新增任何版面結構」的情
況（該票因此省略原型）——本票確實新增了一行版面結構（第二個
`SegmentedFilter` 獨立一行），人類在 G1b 審核時應能直接看到這個新增的
視覺排列，故附上原型。原型展示 4 種畫面狀態：

1. 兩個篩選器皆為「全部」：Agent 篩選列（新增，上方）＋既有類型篩選列
   （下方，含「顯示 n / N」計數），`agent === null` 的列顯示「不明」。
2. 只選特定 Agent（類型篩選仍為「全部」）：清單縮小為只剩該 Agent 的
   列，`agent === null` 的列消失，計數文字更新。
3. 同時選特定 Agent ＋特定異常類型（AND 組合）：清單只剩同時符合兩條件
   的列。
4. 把類型篩選改回「全部」、Agent 篩選維持特定值：驗證 Agent 篩選條件
   不受另一個篩選器重置影響，仍維持生效。

## 開放設計問題（定稿時必須為空）

無。Agent 篩選選項排序規則（決策 1）、版面插入位置（決策 2）、
`agent === null` 排除於選項之外（決策 3）、計數文字歸屬（決策 4）皆可由
spec 原文字面要求、既有程式碼既定慣例（SDLCCT-108/111 的篩選選項衍生規
則）與 CONSTITUTION 的 scope/程式風格條款直接推導定案，不構成需要另開
HUMAN-INPUT 的產品決策。
