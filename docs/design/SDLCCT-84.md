# 設計文件 — SDLCCT-84 異常與告警頁視覺一致性：Agent 中文名稱、模型名稱樣式、狀態用色、篩選與列可點擊

## 對應需求規格

對應 SDLCCT-84（G1 已核准）之 Gherkin 驗收條件：(1) Agent 欄中文名稱為主、
系統代號等寬字放名稱下一行；(2) 異常類型「模型切換」顯示琥珀色標籤、「治理
缺口」顯示紅色標籤，皆含底色＋外框＋色點；(3) 依異常類型篩選，顯示「顯示
n / 總數」；(4) 列可點擊導向該 Agent 詳情頁。範圍外：不處理告警與 Agent
對應關係是否正確（資料來源問題，PO 另行評估）。依賴 SDLCCT-82（已 Done）、
SDLCCT-100（`StatusBadge`，已 Done）、SDLCCT-102（`SegmentedFilter`，已
Done）。

**現況盤點**（實作前已逐一確認的程式碼事實）：

- `frontend/app/anomalies/page.tsx`：只呼叫 `useFetchOnce(fetchAnomalyFeed)`，
  把 `/api/anomalies` 回傳的 `anomalies[]` 依 `status` 拆成 `okRows`
  （`AnomalyTable`）與 `errorRows`（`AnomalyErrorBanner`，同時全部渲染，無
  篩選 UI）。
- `frontend/components/anomalies/anomaly-table.tsx`：`AnomalyRow.agent` 欄位
  目前直接當作顯示文字（`row.agent ?? t("anomalies.table.unknownAgent")`），
  值即系統代號（如 `order_status`），**沒有中文名稱欄位**。`anomaly_type` 欄
  目前是純文字（`ANOMALY_TYPE_LABELS[row.anomaly_type] ?? row.anomaly_type`）。
  `formatAnomalyDate` 回傳 `date === null ? "持續中" : formatSlashDate(date)`，
  與日期共用同一個 `<td>`、同樣是純文字。
- `frontend/components/anomalies/anomaly-error-banner.tsx`：`reason` 欄位是
  後端組好的完整句子，`anomalyType` 同樣經 `ANOMALY_TYPE_LABELS` 轉純文字。
- `bff/api/anomalies.py` `_model_switch_reason()`（第 119–128 行）：回傳字串
  `f"模型於 {switch_date.month}/{switch_date.day} 由 {before} 切換為
  {after}，成本偏離正常值約 {ratio} 倍"` —— **模型名稱是用字串插值直接嵌進
  句子的，沒有任何分隔標記**；`AnomalyRow.reason` 的 OpenAPI schema
  （`bff/api/schemas.py`）只有單一 `reason: str` 欄位，前端拿到的就是一句
  完整句子，無法從純文字反推哪段是模型名稱（regex 猜測模型名稱格式會很脆
  弱，且其他 4 種 reason builder 完全沒有模型名稱，不該為此改動整體 `reason`
  契約）。
- `frontend/lib/agents-api.ts` + `AgentRegistryEntry`（`bff-types.ts` 第
  147–168 行）：有 `key`（系統代號，等同 `AnomalyRow.agent` 的值域）與
  `display`（中文名稱）兩個欄位，`frontend/app/agents/page.tsx` 已確立
  `key -> display` 對照與 `router.push(\`/agents/${agent.key}\`)` 的路由慣
  例。**`AnomalyFeedResponse` 本身不含中文名稱**，必須在前端另外呼叫
  `fetchAgentsList()` 做 join。
- `frontend/components/common/status-badge.tsx`（SDLCCT-100）：`StatusVariant
  = "success" | "danger"` 只有兩個值，`danger`（紅底/紅框/紅點，`text-red-
  700`/`bg-red-50`/`border-red-300`/`bg-red-600`）可直接給「治理缺口」用；
  沒有第三種「琥珀色」可給「模型切換」用。
- `frontend/components/common/segmented-filter.tsx`（SDLCCT-102）：泛型
  `SegmentedFilter<Value extends string>`，`options`/`value`/`onChange`/
  `countLabel` 介面與本票需求（依 5 種異常類型＋「全部」篩選、顯示「顯示
  n / 總數」）完全吻合，**不需要改動元件本身**——本票是它第一個實際呼叫
  端。
- `frontend/components/common/clickable-row.tsx`（SDLCCT-101）：渲染為
  `<tr role="button">`，只能包 `<table>/<tbody>` 的直接子元素。`AnomalyTable`
  的桌面 `<table>`/行動 `<ul>` 兩種呈現方式與 `AgentTable`/`AgentCardList`
  （`frontend/app/agents/page.tsx`）結構相同，可直接套用同一套用模式
  （桌面 `ClickableRow` + `onActivate`，行動版 `<Link>` 包整張卡片）。
  `AnomalyErrorBanner` 是獨立 `<div>` 橫幅、非表格列，`ClickableRow` 的
  `<tr>` 限制使它不適用於橫幅——見下方關鍵決策 7。
- `frontend/lib/i18n/messages.ts` 第 107–135 行 `anomalies` 命名空間：已有
  `table.columns.agent`/`anomalyTypes.*`/`table.ongoing`/`table.unknownAgent`
  等既有字串，無篩選相關字串（`filter.*`）。
- **既有測試會因本票改動而需同步更新**（供 developer 知悉，非本設計文件改
  動範圍）：`frontend/e2e/anomalies.spec.ts` 以 `page.getByText("sales-
  copilot")`／`"ops-bot"` 等直接比對系統代號文字——本票保留系統代號文字
  （只是移到名稱下一行、改等寬字樣式），這些斷言的文字內容不變，**預期仍
  能通過**，但新增的中文名稱文字、篩選按鈕、badge 結構會需要新增/調整斷言
  （例如「顯示 n / 總數」文案、治理缺口/模型切換 badge class）。

**跨元素樣式耦合測試檢查**（流程第 4 步）：於 `frontend/e2e/` 搜尋
`getComputedStyle`/`toEqual.*[Ss]tyle`/「一致」，命中與 SDLCCT-100/102 設計
文件盤點結果相同的檔案（`trace-detail.spec.ts`、`breadcrumbs.spec.ts`、
`agents.spec.ts`、`agent-detail.spec.ts`、`currency-rollout.acceptance.spec.ts`），
比對對象皆為 padding/translate/pointerEvents/textOverflow，且皆非本票改動
的 `/anomalies` 頁面選擇器。`anomalies.spec.ts:158,211` 的 `.border-red-300`
計數斷言鎖定 `anomaly-error-banner.tsx` 的橫幅外框（本票不改動該元件的外層
`<div>` class，只改其內部 `anomalyType` 文字呈現），不受影響。**未發現**任
何將本票要改動的選擇器與另一元件計算樣式綁定相等的鏈式耦合測試。

## 介面/API 契約

### 1. `GET /api/anomalies`：`AnomalyRow` 新增選填欄位 `reason_segments`

端點路徑、HTTP 方法、既有欄位（`agent`/`anomaly_type`/`date`/`status`/
`reason`）**皆不變**。新增一個選填欄位，向下相容：

```jsonc
// AnomalyRow（擴充後）
{
  "agent": "order_status",          // 不變
  "anomaly_type": "model_switch",   // 不變
  "date": "2026-10-18",             // 不變
  "status": "ok",                   // 不變
  "reason": "模型於 10/18 由 gpt-4 切換為 gpt-4o-mini，成本偏離正常值約 3 倍", // 不變，永遠存在
  "reason_segments": [              // 新增，選填，只有 anomaly_type === "model_switch" 時非 null
    { "text": "模型於 10/18 由 ", "code": false },
    { "text": "gpt-4", "code": true },
    { "text": " 切換為 ", "code": false },
    { "text": "gpt-4o-mini", "code": true },
    { "text": "，成本偏離正常值約 3 倍", "code": false }
  ]
}
```

- `anomaly_type !== "model_switch"` 的列：`reason_segments` 為 `null`（其餘
  4 種 reason builder 完全不含模型名稱，不需要分段）。
- 狀態碼、錯誤格式皆不變，沿用既有 `/api/anomalies` 契約（見
  `docs/design/SDLCCT-51.md`）。

### 2. 前端：`GET /api/agents`（既有端點，無契約變更）

本票新增一個呼叫端（`frontend/app/anomalies/page.tsx` 另外呼叫既有
`fetchAgentsList()`），用於 join 出 Agent 中文名稱，**不新增、不修改任何
agents API 的回應格式**。

## 資料模型

無新增資料表。`bff/api/schemas.py` 的 `AnomalyRow` pydantic model 新增一個
選填欄位：

```python
class ReasonSegment(BaseModel):
    text: str
    code: bool

class AnomalyRow(BaseModel):
    agent: str | None
    anomaly_type: str
    date: date | None
    status: str
    reason: str
    reason_segments: list[ReasonSegment] | None = None
```

## 關鍵技術決策

### 1. `StatusVariant` 新增第三個值 `"warning"`（琥珀色），`success`/`danger` 行為不變

```tsx
export type StatusVariant = "success" | "danger" | "warning";
```

渲染分支新增：

```tsx
variant === "warning"
  ? "border-amber-300 bg-amber-50 text-amber-700"
  : /* 既有 success/danger 三元 */
```

色點：`variant === "warning" ? "bg-amber-600" : /* 既有 */`。

**對比度驗證**（同一 WCAG 相對亮度公式，見 `docs/design-system.md` 第 1
節）：`text-amber-700` (#B45309) vs `bg-amber-50` (#FFFBEB)——
R=180,G=83,B=9：R 線性化 ≈0.4565、G≈0.0864、B（≤0.03928 門檻，走線性支）
≈0.00273；L_text≈0.1591。背景 R=255,G=251,B=235：線性化後 L_bg≈0.9622。
對比度 = (0.9622+0.05)/(0.1591+0.05) ≈ **4.84:1**（≥4.5:1，通過 AA，但餘裕
比既有 danger 的 5.91:1 窄——沿用這組 Tailwind amber-700/50 配對，不可再
調淺文字或調深背景，否則會跌破門檻）。

**為什麼擴充既有元件而非另立獨立樣式**：(1) SDLCCT-100 的「底色＋外框＋色
點」規則就是本票規格背景段落明確要求「符合 SDLCCT-82/100 的狀態標籤規
則」；另開一組獨立 class 等於重複實作同一視覺結構，違反共用元件初衷；
(2) `StatusVariant` 是字面量聯合型別，新增一個值是**加法**（additive），
不改變既有 `"success"`/`"danger"` 分支的任何 class 或對比度計算，兩個既有
呼叫端（`agents/page.tsx` 的 `GovernanceBadge`、`cost-overview/summary-
section.tsx`）完全不受影響，`StatusBadge` 既有單元測試（若有）不需改動。

### 2. 治理缺口沿用既有 `danger` variant，模型切換用新 `warning` variant

`anomaly_type === "governance_gap"` → `<StatusBadge variant="danger">`；
`anomaly_type === "model_switch"` → `<StatusBadge variant="warning">`；其餘
3 種異常類型（`tool_retry_loop`/`context_bloat`/`night_batch_burst`）**維持
現狀純文字**，不套用 badge。理由：規格原文與 Gherkin AC 逐字只定義了這兩種
類型的顏色（「模型切換用琥珀色，治理缺口用紅色」），未對其餘 3 種類型給出
顏色方案；依 CONSTITUTION.md「範圍紀律」原則與架構師「不自行發明產品決
策」的限制，不替未提及的 3 種類型自創顏色——維持純文字即是「不改動」，不
是遺漏。

### 3. badge 套用範圍：`AnomalyTable`（ok 列，桌面＋行動）與 `AnomalyErrorBanner`（error 列）的 `anomalyType` 皆套用

Gherkin AC2「異常類型分色標籤」原文是「告警列的異常類型」，字面未區分
`status: "ok"` 或 `"error"`，兩個元件都呈現 `anomaly_type`，故兩處都改用
`StatusBadge`（取代原本 `ANOMALY_TYPE_LABELS[...] ?? ...` 的純文字渲染，
`ANOMALY_TYPE_LABELS` 的查表邏輯不變，只是外層多包一層 badge 判斷）。

### 4. Agent 中文名稱：前端另外呼叫 `fetchAgentsList()`，以 `agent.key` join `AnomalyRow.agent`

`/api/anomalies` 回應本身不含中文名稱（見現況盤點），後端加這個欄位需要改
動 `get_anomaly_feed()` 額外查詢 agent registry 再逐列塞入——但這個 join 的
職責本來就已經有一個現成端點 `/api/agents` 在做（`AgentRegistryEntry.key`/
`display`），在前端 join 比在後端重複一份相同邏輯更省，也不需要改動
`/api/anomalies` 的既有契約（降低風險）。`frontend/app/anomalies/page.tsx`
新增 `useFetchOnce(fetchAgentsList)`，建立
`Map<string, string>`（`agent.key -> agent.display`），往下傳給
`AnomalyTable`/`AnomalyErrorBanner`作為 `agentDisplayNames` prop（或在頁面層
直接 enrich 成 `{ ...row, agentDisplay: agentDisplayNames.get(row.agent ?? "") }`
再傳入，由 developer 依程式碼簡潔度選擇，不影響外部行為）。

**找不到對照時的 fallback**：`row.agent` 為 `null`，或 `row.agent` 不在
`agentDisplayNames` 裡（anomaly feed 與 agent registry 資料不同步）——兩種
情況都顯示系統代號本身（或 `row.agent === null` 時顯示既有
`anomalies.table.unknownAgent`「不明」）作為主要文字，不顯示第二行代號
（因為代號本身已經是主要文字，沒有「名稱」可再疊一行）。這與
`ANOMALY_TYPE_LABELS` 既有「未知值 fallback 顯示原始字串本身」是同一防禦
性慣例，不是新發明的行為；且屬於「告警與 Agent 對應關係是否正確」此類資
料正確性問題的呈現層對應，該資料問題本身已在規格「範圍外」由 PO 另行評
估，本票只負責不讓 UI 顯示空白或拋錯。

**兩個 fetch 的載入態合併**：頁面需要兩個獨立請求都成功才能渲染表格（名
稱必須先 join 完才顯示列），不是既有「per-card 獨立失敗」模式（那是給彼此
獨立的多張卡片用，`docs/design/SDLCCT-32.md`）——本頁只有一張表格，資料
互相依賴。任一個 `status === "loading"` 就顯示現有 skeleton；任一個
`status === "error"` 就顯示 `ErrorCard`（優先顯示 anomalies 本身的錯誤，
因為它是主要資料來源；agents 列表失敗則列的代號 fallback 會啟動，不阻斷主
表格渲染——即兩個請求都「error」時顯示 anomalies 的錯誤卡，agents 單獨
失敗但 anomalies 成功時改走上面的 fallback 顯示代號而非整頁錯誤，因為中文
名稱是加值顯示，不是頁面核心功能）。

### 5. 模型名稱 `<code>` 樣式：後端新增 `reason_segments`，前端依此渲染，`reason` 本身不變

純文字 `reason` 無法反推哪段文字是模型名稱（見介面契約段落），改動
`_model_switch_reason()`，讓它在組裝句子的同時也輸出分段陣列（已知
`before`/`after` 兩個模型名稱子字串在字串中的切點，組裝時自然就知道），其
餘 4 個 reason builder 不受影響、`reason_segments` 維持 `None`。前端：
`row.reason_segments` 非 `null` 時，依序渲染 `code: true` 的片段為
`<code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">`，
`code: false` 片段為一般 `<span>`；`reason_segments` 為 `null` 時維持現狀
直接渲染 `row.reason` 純文字（`AnomalyErrorBanner` 若未來也有 model_switch
error 列，同一渲染邏輯可重用）。**為什麼不讓前端自己 regex 猜模型名稱**：
模型名稱格式（`gpt-4`、`gpt-4o-mini`、未來可能的任意 provider 命名）沒有
穩定、可窮舉的字面規則，regex 必然脆弱；後端產生分段時已經確切知道
`before`/`after` 字串本身，由產生句子的那一端同時標記分段是唯一不會猜錯
的做法。

### 6. 篩選選項：「全部」＋既有 5 種異常類型，套用於 ok／error 列合併計算的總數

`SegmentedFilter<"all" | AnomalyTypeKey>`，`options` 依序為 全部／工具重試
迴圈／情境膨脹／非營業時段流量暴增／模型切換／治理缺口（沿用既有
`ANOMALY_TYPE_LABELS` 的 5 個 key 與翻譯，不新增第 6 種類型文案）。
`countLabel` 格式「顯示 n / 總數」用新 i18n 函式訊息
`anomalies.filter.count: (shown: number, total: number) => \`顯示 ${shown} / ${total}\``
（比照 `costOverview.period.currentPeriod(range)` 既有「函式訊息」慣例，
`t()` 本身支援）。篩選套用在 `status === "ok"` 與 `"error"` 兩組**合併計
算**的 `anomalies[]` 全集（先篩選 `anomaly_type`，再依 `status` 拆成
`okRows`/`errorRows` 分別渲染），而非只篩 ok 列——Gherkin AC 原文「依類型
篩選告警」沒有限定只篩正常列，且 n/總數字面上應反映使用者看到的「所有」
符合條件的告警列數（banner＋表格列加總），不是只算表格列。

### 7. 可點擊範圍：僅 `AnomalyTable` 套用 `ClickableRow`，`AnomalyErrorBanner` 不變

規格原文「每列可點擊...套用 SDLCCT-101 的 `clickable-row.tsx`」指名的元件
本身就是 `<tr>` wrapper（見現況盤點），只能包表格列；`AnomalyErrorBanner`
是獨立 `<div>` 橫幅，不是表格列，套用 `ClickableRow` 需要改動該元件既有結
構（把 `<div>` 橫幅重寫成可點擊容器），超出規格指名元件的既有能力範圍，也
沒有 Gherkin AC 明確要求橫幅本身要可點擊。桌面 `<table>` 沿用
`frontend/app/agents/page.tsx` `AgentTable` 既有模式：`<ClickableRow
aria-label={displayName} onActivate={() => router.push(\`/agents/${row.agent}\`)}>`；
行動卡片列表沿用 `AgentCardList` 模式，整張卡片包一層 `<Link href={\`/agents/${row.agent}\`}>`。
`row.agent === null` 的列**不包 `ClickableRow`/`Link`**（維持現有 `<tr>`/
`<li>` 原樣不可點擊）——沒有有效的 Agent key 可供導航，比照 AC 範圍外
「不處理告警與 Agent 對應關係是否正確」，無法導航的列不應該假裝可點擊。

### 8. 「持續中」改用既有 `StatusBadge` `success` variant（中性灰），不新增變體

`formatAnomalyDate` 回傳的字串拆成兩個分支：`date !== null` 時維持現有純
文字 `formatSlashDate(date)`；`date === null` 時改用
`<StatusBadge variant="success">{t("anomalies.table.ongoing")}</StatusBadge>`
取代現有純文字，欄位本身不變（仍在同一個「日期」欄），只是視覺上用標籤
（底色＋外框＋色點）取代純文字，與日期文字產生明顯區隔，對應規格原文「改
用標籤樣式與日期視覺區分」而非「移到獨立欄」。選用既有 `success`
variant（視覺上是中性灰，不是綠色）而非新增第 4 個 variant：「持續中」語
意上是中性的「狀態持續存在」通知，不是「正常／異常」二元判斷的任一端，但
`success` variant 本身呈現的顏色（灰底/灰框/灰點）恰好就是中性色，直接重
用不會造成語意或視覺上的錯誤聯想，也不需要為單一案例新增變體（對照本設計
決策 1 新增 `warning` 的理由——`warning` 有兩個以上明確需求脈絡（模型切換
徽章、未來可能的其他警示態），「持續中」目前只有這一個呼叫情境，且既有灰
色 variant 已完全符合視覺需求）。

## UI 原型

見 `docs/design/SDLCCT-84-prototype.html`（可直接在瀏覽器開啟），並列呈
現：(1) Agent 欄中文名稱為主文字＋系統代號等寬字第二行；(2) 原因文字中模
型名稱以 `<code>` 樣式標示（模型切換列）；(3) 「持續中」改用中性灰
`StatusBadge` 與一般日期文字並列對照；(4) 異常類型分色標籤：模型切換琥珀
色、治理缺口紅色、其餘 3 種維持純文字；(5) 頂部「全部／5 種類型」分段篩選
按鈕＋右側「顯示 n / 總數」；(6) 一般列的 hover 可點擊樣式，以及 `agent ===
null` 列維持不可點擊的對照範例；(7) 錯誤橫幅（`AnomalyErrorBanner`）套用
分色標籤但不可點擊的對照範例。

## 開放設計問題（定稿時必須為空）

無。「告警與 Agent 對應關係是否正確」（join 後找不到對照、anomaly feed 與
agent registry 資料不同步時的呈現）屬規格已明文列為範圍外的資料來源問題，
本票僅在 UI 層採用既有「fallback 顯示原始代號」防禦性慣例呈現（關鍵決策
4），不構成本票需要 PO 再決策的開放問題；其餘「模型切換/治理缺口以外類型
不上色」「持續中沿用既有中性 variant」「篩選套用於 ok+error 合併總數」
「橫幅不可點擊」皆可由規格原文字面範圍與既有元件既定契約推導定案，不需規
格補充。
