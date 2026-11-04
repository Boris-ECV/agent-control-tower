# 設計文件 — SDLCCT-111 最貴執行清單：共同中繼資料不重複顯示＋廠別獨立欄與篩選

## 對應需求規格

G1 核准版本（拆分自 SDLCCT-86，依 `ui review/design-changes-v2-.md` 第二
章第 4 節「最貴執行清單」小節之二），4 條 Gherkin AC：

1. 版本／部門／觸發方式三項皆相同時，僅在卡片標題列顯示一次，表格不逐
   列重複；廠別因列而異，獨立顯示在表格欄位中。
2. 三項中任一項（情境示範「版本」）不一致時，該項維持逐列顯示，不受其
   他兩項是否一致影響（已依 HUMAN-INPUT SDLCCT-113 選項 A 定稿：**逐欄
   位獨立判斷**）。
3. 廠別篩選：沿用 SDLCCT-82/102 共用元件 `SegmentedFilter`，選項只列出
   目前清單中實際出現過的廠別，純前端篩選。
4. 回歸確認：`ClickableRow`（SDLCCT-101）列可點擊導覽，本次欄位重排後
   必須維持正常運作。

**範圍外**：執行時間欄／Trace ID 截斷複製（SDLCCT-110，已完成且已反映
在下方現況盤點的程式碼中）；成本標籤分組（SDLCCT-109，已完成）；金額
精度（PO 另評）。**依賴**：SDLCCT-82／SDLCCT-102（`SegmentedFilter`，
Done）、SDLCCT-101（`ClickableRow`，Done，本票回歸對象）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/top-traces-table.tsx`（SDLCCT-110 已
  合併進 `main`，見本票 commit 歷史 `4233e0d`/`2783ba2` 之前的
  `133d983`）：目前欄序為 Trace ID → 執行時間 → 預估成本 → 中繼資料
  （`MetadataCell`）→ 箭頭裝飾欄。`MetadataCell` 內 `KNOWN_METADATA_
  FIELDS` 固定陣列 `[plant, deployed_version, dept, trigger]`，逐列把
  這 4 個欄位都渲染成行內 chip（`標籤: 值`），其餘未知 key 收合在「更
  多」裡；`metadata === null` 時整格顯示 `t("agentDetail.unknown")`
  （`"—"`），不渲染任何 chip/展開控制（既有行為，AC4 null-metadata
  regression 測試鎖定此行為，見下）。整列已是 `ClickableRow`，
  `onActivate` 導覽至 trace 詳情頁。
- `frontend/lib/generated/bff-types.ts::TopTraceItem`：`{ id: string;
  metadata: { [key: string]: unknown } | null; total_estimated_cost:
  number | null }`。`metadata` 本身未型別化，`plant`/`deployed_version`/
  `dept`/`trigger` 四個 key 是否存在、型別皆不保證（沿用 SDLCCT-74 既
  有事實）。本票不新增/變更 bff schema。
- `frontend/lib/i18n/messages.ts` 第 173–192 行
  `agentDetail.topTraces`：`table.columns.{id,startTime,cost,metadata}`、
  `metadata.fields.{plant,deployedVersion,dept,trigger}`（文字分別為
  「廠別」「版本」「部門」「觸發方式」）、`metadata.{more,collapse}`、
  `traceId.{copyAriaLabel,copied}`。本票新增 `table.columns.plant` 與
  `filter.plantAriaLabel` 兩個鍵，沿用既有命名慣例（不改既有鍵的文字，
  `metadata.fields.plant` 的「廠別」文字可直接重用於新欄位標題，見決策
  1）；篩選器「全部」選項重用既有 `anomalies.filter.all`（「全部」），
  比照 `frontend/app/agents/page.tsx` 第 27/335 行的既有重用慣例。
- `frontend/app/agents/page.tsx`：`SegmentedFilter<GovernanceStatusFilter>`
  的既有呼叫端範例——`value`/`onChange` 受控單選、`options` 為
  `{value, label}[]`、`aria-label` 必填字串；部門下拉選項（SDLCCT-108
  決策 3）**從未篩選的原始清單**算出候選值（dedupe + sort），不隨其他
  篩選條件縮小，本票的廠別篩選選項沿用同一慣例（見決策 4）。
- `frontend/components/common/segmented-filter.tsx`（SDLCCT-102）：
  `SegmentedFilter<Value extends string>` 簽名確認，`countLabel?:
  ReactNode` 選填，本票不使用（規格未要求「顯示 n / N」文案，範圍外，
  不擴大解讀）。
- `frontend/components/common/clickable-row.tsx`：`onClick`/`onKeyDown`
  掛在 `<tr>` 本身；只要新增的 `<td>` 不含互動元素（本票新增的廠別欄只
  是純文字），不需要 `stopPropagation()`（與 Trace ID/執行時間/預估成
  本現有純文字欄位做法一致）。
- `frontend/e2e/agent-detail.spec.ts`：第 535–634 行「SDLCCT-74
  AC1/AC2」與第 666–690 行（plant/deployed_version/trigger 皆逐列顯示
  為 chip）、第 692–723 行「AC4 null metadata 保留 —」三組既有測試，皆
  對應「4 個已知欄位固定逐列顯示」的現況行為——本票的核心目的正是改變
  這個行為（版本/部門/觸發方式三項在同值時搬到標題列、廠別獨立成欄），
  **預期**這些既有測試的斷言內容需要開發階段更新為符合新行為的斷言,
  不是本票要維持不回歸的測試（與 SDLCCT-110/109 現況盤點中「不得回歸」
  的測試類別不同，那些測試鎖定的是本票未觸及的欄位——Trace ID 截斷/
  執行時間/金額格式——仍必須維持通過）。
- 全 repo 搜尋 `toEqual|getComputedStyle|一致`（流程第 4 步跨元素樣式
  耦合檢查）：命中的比較對象（`agents.spec.ts`/`agent-detail.spec.ts`/
  `trace-detail.spec.ts`/`breadcrumbs.spec.ts`/
  `currency-rollout.acceptance.spec.ts`）皆為「同一元素在不同狀態下的
  樣式」或「與固定期望值比較」（padding、`textOverflow`、
  `pointerEvents`、`translate`、金額欄位 `text-align`/`tabular-nums`），
  **沒有**任何「本票要改動的選擇器（中繼資料儲存格、新廠別欄）與另一
  元件的 computed style 相等」的鏈式測試。本票不觸發跨元素樣式耦合測
  試鏈。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點或回應格式，純前端消費既有
`GET /api/agents/{key}` 回應中 `top_traces[].metadata`（型別不變）。

## 資料模型

無新增資料模型。`TopTraceItem.metadata` 維持 `Record<string, unknown> |
null` 不變；「廠別」「版本」「部門」「觸發方式」四個欄位是否存在仍完全
取決於後端目前實際填入的 key，本票只調整前端對同一份資料的分組/顯示方
式。

## 關鍵技術決策

### 1. 新增欄位標題鍵 `table.columns.plant`，文字沿用既有 `metadata.fields.plant`（「廠別」）

廠別從「中繼資料」chip 群組中抽出，獨立成一欄，欄位標題文字與既有
chip 標籤文字相同（「廠別」），語意一致、不新創文案；放在 i18n
`table.columns` 命名空間（與其他欄位標題同層級），`metadata.fields.
plant` 鍵保留但本票之後不再用它渲染廠別本身（詳見決策 2），只是避免
刪除既有鍵造成不必要的連動變更。

### 2. `MetadataCell`／`KNOWN_METADATA_FIELDS` 拆成兩個獨立機制：「廠別欄」與「三個可摺疊共同欄位」，互不透過同一組陣列驅動

- 廠別：新增獨立欄位渲染函式（直接讀 `trace.metadata?.plant`），永遠逐
  列顯示，`metadata === null` 或缺少 `plant` key 時顯示 `t("agentDetail
  .unknown")`（沿用既有 em dash 慣例，不是本票新創）。**不**參與任何
  「是否所有列相同」的判斷——spec「範圍與修正方向」明文只對版本/部門/
  觸發方式三項做逐欄位獨立判斷，廠別欄位本身就是這次新增的篩選維度，
  天生就是「因列而異」的呈現目的，不適用，也不應該被誤套用「摺疊」邏
  輯（若恰好篩選後畫面只剩一個廠別，欄位依然顯示，不摺疊——維持欄位結
  構穩定，不隨篩選結果忽隱忽現）。
- 版本/部門/觸發方式：`KNOWN_METADATA_FIELDS` 陣列保留（移除 `plant`
  項），每個欄位各自計算「目前顯示列表（套用廠別篩選後）中，此欄位是
  否存在且所有列的值完全相同」（詳見決策 3 的比對規則），逐欄位獨立判
  斷、互不影響（HUMAN-INPUT SDLCCT-113 選項 A 已定稿的字面要求）。
  - 若某欄位判定為「全部相同」：不在任何列的 `MetadataCell` 中渲染此
    欄位的 chip，改由 `TopTracesTable` 在表格上方的摘要列渲染一次（見
    決策 5）。
  - 若判定為「不一致」（含任一列缺少該 key 或 `metadata === null` 的
    情況，見決策 3）：所有列的 `MetadataCell` 維持渲染此欄位的 chip（
    與 SDLCCT-74 既有行為相同），不搬到摘要列。
  - 「其他」（`otherEntries`，收在「更多」展開）排除的 `knownKeys` 集
    合維持包含全部 4 個欄位（含 `plant`），避免廠別已經有獨立欄位顯
    示後，又在「更多」展開裡重複出現同一份資料。

### 3. 「全部相同」比對規則：以目前（已套用廠別篩選後）顯示列表為準；任一列缺少該欄位（含 `metadata === null`）即視為「不一致」

- **以篩選後的顯示列表為準，非原始全部清單**：AC 的 Given 描述「最貴
  執行清單中所有列」指的是畫面當下渲染的清單；使用者故事本身就是「篩
  選後清單更精簡」，篩選改變了「目前清單」的範圍，三個共同欄位是否摺
  疊到標題列理當隨之重新計算（例如篩選到只剩一個廠別後，原本因為跨廠
  別而不一致的「部門」欄位可能變成一致，進而摺疊）——這是「目前清單」
  一詞最直接的讀法，不是規格沒講而需要另外請示的產品決策。
- **任一列缺少該欄位視為「不一致」，不視為「可忽略的例外」**：資料模
  型層面 `metadata` 可能是 `null` 或缺少特定 key（SDLCCT-74 既有事
  實），規格本身所有 Gherkin 情境的 Given 都假設「所有列皆有該欄位且
  值相同/不同」，未覆蓋「部分列缺欄位」的狀況。依 CONSTITUTION「規格
  模糊時不要過度設計」與 spec 範圍段落明文的「不搬移，不隱藏任何資
  訊」這一設計原則：若把「缺欄位的列」直接忽略不計入比對（可能導致把
  一個其實不是所有列都有的欄位摺到標題列，暗示「所有列都是這個值」，
  但缺欄位的列其實什麼值都沒有），會製造「隱藏資訊」的風讀——使用者
  看到標題列一個值，卻不知道其中有列根本沒有這個欄位。因此採最保守讀
  法：只有「目前顯示的每一列都存在該 key 且值完全相同（嚴格字串比較,
  `String(value)`）」才摺疊；任何一列缺少該 key（或整個 `metadata` 為
  `null`）都視為「不一致」，維持逐列顯示（該列在其 `MetadataCell`
  自然不會有這個 chip，因為它本來就沒有這個 key——與 SDLCCT-74 既有
  「缺少的欄位不顯示空白」規則一致，只是觸發摺疊判斷時一併計入「不一
  致」）。這個決策直接由 spec 本身的「不隱藏任何資訊」原則推出,不是本
  票新發明的產品判斷,故不列入開放問題。
- 比對一律用 `String(value)` 字串化後比較（與既有 chip 顯示
  `String(metadata[key])` 用同一個轉換函式,確保「顯示出來一樣」與
  「判定為相同」永遠一致,不會出現例如 `number 1` 與 `string "1"`
  顯示相同卻被判定不同的不一致情況）。
- 空清單（篩選後 0 筆，或 `traces` 本身是空陣列）：不計算、不渲染任何
  摘要 chip（沒有列可供「全部相同」，摘要列直接不顯示），表格維持既
  有「無列可渲染」的 `<tbody>` 空狀態。

### 4. 廠別篩選選項：從**未篩選的原始 `traces` 全部清單**算出，不隨篩選結果縮小；用 `SegmentedFilter<string>`，固定加一個 `"all"` sentinel 選項

沿用 `frontend/app/agents/page.tsx`（SDLCCT-108 決策 3）部門下拉選項
「從未篩選原始清單算候選值,不隨其他篩選條件縮小」的既有慣例——避免使
用者選了某個廠別後,篩選器自己把其他廠別選項也拿掉,導致看不到能切回
去的選項。做法：

```tsx
const plantOptions = useMemo(() => {
  const plants = new Set<string>();
  for (const trace of traces) {
    if (trace.metadata !== null && typeof trace.metadata.plant !== "undefined") {
      plants.add(String(trace.metadata.plant));
    }
  }
  return Array.from(plants).sort();
}, [traces]);

const [plantFilter, setPlantFilter] = useState<string>("all");
const filteredTraces = useMemo(
  () =>
    plantFilter === "all"
      ? traces
      : traces.filter(
          (trace) => trace.metadata !== null && String(trace.metadata.plant) === plantFilter,
        ),
  [traces, plantFilter],
);
```

- `SegmentedFilter` 的 `options` = `[{ value: "all", label: t("anomalies
  .filter.all") }, ...plantOptions.map((p) => ({ value: p, label: p }))]`
  （比照 SDLCCT-108 的 `DEPT_FILTER_ALL` sentinel 寫法）；`aria-label`
  使用新鍵 `t("agentDetail.topTraces.filter.plantAriaLabel")`（「依廠
  別篩選」）。
- 若原始清單中沒有任何列帶 `plant`（`plantOptions` 為空陣列），篩選器
  仍渲染，但只有「全部」一個選項可選——AC3 的 Given 前提是「執行分屬
  不同廠別」，這個邊界案例 AC 未要求特殊處理，維持元件本身天然行為即
  可（不額外加「隱藏整個篩選器」的特殊邏輯，避免過度設計一個規格沒要
  求的分支）。
- 篩選為純前端記憶體篩選（`useState`/`useMemo`，不觸發任何網路請求），
  符合 spec「純前端篩選」字面要求。

### 5. 摘要列（三個共同欄位）渲染位置：`TopTracesTable` 內部、`<table>` 上方的一個 flex 列，與廠別篩選器同一個工具列區塊

規格要求摘要文字顯示在「卡片標題列」，但目前 `<h2>最貴執行清單</h2>`
標題是由父元件 `agent-detail-content.tsx` 的 `<section>` 渲染（見現況
盤點），`TopTracesTable` 本身過去只回傳一個 `<table>`。依 CONSTITUTION
「做規格要求的，不自己加碼」與「小改動配小設計」，本票不把 `<h2>` 搬
進 `TopTracesTable`（那會連動改變父元件的既有結構與 `aria-label`
掛法），改為：`TopTracesTable` 回傳值從裸 `<table>` 改成一個外層
`<div className="flex flex-col gap-3">`，內含（1）工具列行：左側廠別
`SegmentedFilter`、右側摘要 chip（若有摘要）；（2）`<table>`。視覺上這
個工具列緊貼在父層 `<h2>最貴執行清單</h2>` 正下方,等同「卡片標題區
域」的延伸,滿足 AC「僅在卡片標題列顯示一次,不逐列重複」的行為意圖
（重點是「不是表格逐列重複」,不是像素級規定必須在 `<h2>` 文字同一
行）,不需要變更 `agent-detail-content.tsx`。摘要 chip 沿用既有
`MetadataCell` chip 樣式（`rounded bg-gray-100 px-1.5 py-0.5 text-xs
text-text-secondary`），文字格式與既有 chip 相同：
`{t(fields.labelKey)}: {value}`。

### 6. 廠別欄在表格中的插入位置：中繼資料欄之前（欄序：Trace ID → 執行時間 → 預估成本 → 廠別 → 中繼資料 → 箭頭裝飾欄）

spec 未規定順序。選在「中繼資料」欄之前（而非最前或最後），理由：廠
別原本就是 `KNOWN_METADATA_FIELDS` 陣列裡排序第一的欄位（現況盤點第
22 行），獨立成欄後緊鄰原本的中繼資料欄，使用者既有的視覺掃視順序（
先看識別資訊→金額→這類「情境標籤」資訊）改動最小；不插在 Trace ID/
執行時間/預估成本之前，因為那三欄是 SDLCCT-110 剛定案的「識別/金額」
分組（見 `docs/design/SDLCCT-110.md` 決策 8），不打散既有分組語意。

## UI 原型

見 `docs/design/SDLCCT-111-prototype.html`（可直接在瀏覽器開啟）。展
示三種畫面狀態：
1. 版本/部門/觸發方式三項皆相同：工具列顯示廠別篩選器（「全部」/
   「P1」/「P2」分段按鈕）＋右側三個摘要 chip（版本/部門/觸發方式各
   一），表格欄位為 Trace ID／執行時間／預估成本／廠別／中繼資料（無
   版本/部門/觸發方式 chip,因已摺疊）／箭頭。
2. 僅「版本」不一致（部門/觸發方式仍相同）：摘要列只剩部門/觸發方式
   兩個 chip,「版本」改為逐列顯示在中繼資料欄中的 chip（每列各自的版
   本值），示範「逐欄位獨立判斷」。
3. 套用廠別篩選後（選擇「P1」）：清單只剩 P1 的列,廠別欄仍照常顯示
   「P1」文字（不因篩選單一值而摺疊,見決策 2）。

## 開放設計問題（定稿時必須為空）

無。「任一列缺少共同欄位視為不一致」（決策 3）與「摘要列渲染位置」
（決策 5）雖是規格未逐字言明的細節，但皆可直接由 spec 本文「不隱藏任
何資訊」的明文設計原則與 CONSTITUTION 既有的 scope/code-style 條款推
導定案，不構成需要另開 HUMAN-INPUT 的產品決策。
