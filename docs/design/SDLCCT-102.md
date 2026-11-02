# 設計文件 — SDLCCT-102 篩選器統一為分段按鈕樣式並顯示「顯示 n / 總數」

## 對應需求規格

對應 SDLCCT-102（由 SDLCCT-82 拆分之 S12，約 1 開發日，G1 已核准）之
Gherkin 驗收條件：(1) 頁面篩選器以分段按鈕（segmented control）呈現，目前
選項有明確選取樣式；(2) 篩選結果 n 筆、總數 N 筆時右側顯示「顯示 n / N」；
(3) 使用者切換選項（點擊或鍵盤操作）時列表與計數同步更新。範圍外：不新增
篩選條件、不改篩選邏輯。依賴：無。開放問題：無（ticket 原文）。

**現況盤點**（實作前逐一確認的程式碼事實，依規格背景「未找到 segmented
control 元件，實作時須先盤點既有篩選器位置」要求，全文 grep `filter`/
`篩選`/`toggle`/`tabs`/`select`/`dropdown` 於 `frontend/app/` 與
`frontend/components/` 後逐一人工確認）：

- `frontend/app/agents/page.tsx`：無篩選 UI。唯一命中 `filter` 的是
  `trend.filter(...)`（陣列方法，非使用者可操作的篩選器）。
- `frontend/app/anomalies/page.tsx`：依 `row.status === "ok" | "error"`
  把資料分成 `okRows`/`errorRows` 兩組**同時全部渲染**（錯誤橫幅 +
  正常資料表），並非使用者可切換的篩選器——沒有任何按鈕/下拉讓使用者在
  兩組之間切換，也沒有「顯示 n / 總數」文案。
- `frontend/app/cost-dashboard/page.tsx` 與
  `frontend/components/cost-overview/period-comparison-section.tsx`：
  「currentPeriod」/「previousPeriod」為固定並列欄位（同時顯示兩期），
  不是互斥可切換的篩選器。
- `frontend/app/agents/[key]/page.tsx`、
  `frontend/components/agent-detail/version-cost-chart.tsx`、
  `frontend/components/agent-detail/top-traces-table.tsx`：命中的
  `filter` 全部是陣列方法（`.filter(([key]) => ...)`、
  `.filter((v) => v !== null)` 等），非 UI 篩選器。
- `frontend/components/ui/`（shadcn 已生成目錄）目前只有
  `button.tsx input.tsx separator.tsx sheet.tsx sidebar.tsx skeleton.tsx
  tooltip.tsx`——**沒有**任何 tabs/segmented/toggle-group 元件。

**結論：目前整個前端程式碼庫沒有任何使用者可操作的篩選器**，與規格背景
「未找到 segmented control 元件」的描述一致（且範圍更廣：不只沒有
segmented control 樣式，連任何形式的互動篩選器——下拉選單、tabs、按鈕
群組——都不存在）。因此本 Story **沒有既有篩選器呼叫端需要就地改版**；
下方「套用範圍」決策說明此結論如何對應到仍然滿足 SDLCCT-82 S12 的拆分
意圖。

**依賴套件盤點**：`frontend/package.json` 的 UI 基礎套件是
`@base-ui/react`（非 Radix）。確認
`node_modules/@base-ui/react/toggle-group/` 與 `.../toggle/` 已隨此既有
依賴一併安裝，提供 `ToggleGroup`（`value`/`onValueChange`/
`loopFocus`/`multiple` props，內建方向鍵巡覽與 roving tabindex）與
`Toggle`（`pressed`/`value`/`data-pressed` 屬性）兩個無樣式 primitive，
語意與 ARIA（`role="group"` + 子項 `role="button"` 搭配
`aria-pressed`/方向鍵）皆已由套件處理，不需手刻鍵盤邏輯——可直接作為本
元件的基礎，不需手刻、也不需新增套件依賴。

**跨元素樣式耦合測試檢查**（流程第 4 步）：於 `frontend/e2e/` 搜尋
`getComputedStyle`/`toEqual.*[Ss]tyle`/「一致」，命中
`agent-detail.spec.ts`、`agents.spec.ts`、`trace-detail.spec.ts`、
`breadcrumbs.spec.ts`、`currency-rollout.acceptance.spec.ts`
（與 SDLCCT-100 設計文件盤點結果相同的五個檔案，比對對象為
padding/translate/pointerEvents/textOverflow，與本 Story 無關）。因本
Story 不改動任何既有選擇器（上方盤點已確認沒有既有篩選器可改，本 Story
純粹新增一個目前無呼叫端使用的共用元件），**不存在**任何鏈式耦合測試
風險。

## 介面/API 契約

無。本 Story 純前端元件新增，不涉及任何 HTTP 端點或 request/response
格式變更（篩選邏輯本身範圍外，不改動）。

## 資料模型

無新增資料模型。不涉及任何資料表、欄位、索引。

## 關鍵技術決策

### 1. 新增共用元件 `SegmentedFilter`，路徑 `frontend/components/common/segmented-filter.tsx`

沿用 SDLCCT-100／SDLCCT-101 已建立的 `frontend/components/common/`
慣例（跨頁共用、非 `ui/` shadcn 生成目錄的互動/顯示元件放此處）。元件以
`@base-ui/react` 的 `ToggleGroup`/`Toggle` 為基礎包一層樣式與行為收斂，
簽名：

```tsx
export interface SegmentedFilterOption<Value extends string> {
  value: Value;
  label: ReactNode; // 呼叫端自行傳入已翻譯文字，元件不內嵌文案
}

export function SegmentedFilter<Value extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  countLabel, // 右側「顯示 n / N」已翻譯文字，呼叫端自行組字串
}: {
  options: SegmentedFilterOption<Value>[];
  value: Value;
  onChange: (next: Value) => void;
  "aria-label": string;
  countLabel?: ReactNode;
}): JSX.Element;
```

理由：
- **泛型 `Value extends string`**：SDLCCT-83/84/85/86 的篩選選項種類
  各不相同（例如狀態、嚴重度），讓呼叫端自己定義字面量聯合型別
  （如 `"all" | "ok" | "error"`），元件本身不假設任何特定篩選語意——
  比照 SDLCCT-100 `StatusVariant` 只開放規格需要的值的同一原則，但
  因為本元件要給「未來」依賴它的 story 用，具體值集合無法在本 Story
  預先列舉，故用泛型而非固定 union（避免本 Story 替未來 story 預先
  決定篩選選項，逾越本 Story 範圍）。
- **`countLabel` 為已組好的 `ReactNode`，非 `shown`/`total` 兩個
  number prop**：比照 `StatusBadge` 用 `children` 而非內嵌文案的既有
  慣例——「顯示 n / N」文字本身屬於呼叫端頁面的 i18n 命名空間
  （例如未來 `agents.filter.count`），元件不內嵌任何語言字串，也不
  規定呼叫端必須用「顯示 n / N」這個字面格式以外的任何假設（雖然
  驗收條件指定了這個格式，但格式組字串的職責留給呼叫端的 `t()`
  訊息，元件只負責把這段文字放在分段按鈕的右側版面位置）。
  `?:` 選填——因為情境 2「計數」是否出現取決於頁面是否有「總數」概念
  可供呈現，元件不強制要求。
- **`value`/`onChange` 為受控單選（非 `ToggleGroup` 原生的
  `string[]` 多選陣列）**：規格「目前選項有明確選取樣式」與「使用者
  切換選項」字面上都是互斥單選（segmented control 的標準語意，類似
  單選鈕群組），而 `@base-ui/react` 的 `ToggleGroup` 預設
  `multiple=false` 時仍可能讓使用者點擊「目前已選取的那個」把它變成
  未選取（陣列長度 0），這對單選式篩選器不合理（篩選器不能「沒有任何
  選項生效」）。本元件內部對 `ToggleGroup` 的 `onValueChange` 做一層
  轉換：只有當新陣列長度為 1 時才呼叫外部 `onChange`，忽略會導致
  清空選取的點擊——確保外部永遠維持「剛好一個選項被選取」的不變量，
  介面也因此簡化成單一 `value: Value`／`onChange: (next: Value) =>
  void`，呼叫端不需自己處理陣列或空值情境。

### 2. 鍵盤操作：直接沿用 `@base-ui/react` `ToggleGroup`/`Toggle` 內建的方向鍵巡覽與 roving tabindex，不手刻

理由：base-ui 的 `ToggleGroup` 已實作 WAI-ARIA toolbar/radiogroup 模式的
方向鍵巡覽（`loopFocus` 預設 `true`）與 `Tab` 進出群組的 roving
tabindex，`Toggle` 本身是語意正確的 `<button>` 並帶
`data-pressed`/`aria-pressed`，滿足驗收條件「切換...以鍵盤操作」而不需
額外手刻 `onKeyDown`（對照 `ClickableRow` 在 SDLCCT-101 手刻 Enter/空白
鍵的情境不同——`ClickableRow` 包的是原生 `<tr>`，沒有現成 primitive；
`SegmentedFilter` 有現成 primitive 可用，手刻反而是重複實作且可能跟
primitive 內部狀態不同步）。樣式層對 `data-pressed`/`:focus-visible`
套用下方決策 3 的 class。

### 3. 選取樣式與 focus 樣式

- **選取態**：`data-pressed` 時背景改為 `bg-bg`、文字 `text-text-primary`
  並疊一層陰影／邊框（`shadow-sm` + 同色系邊框），未選取態背景透明、
  文字 `text-text-secondary`——比照 iOS/Material segmented control的
  常見視覺慣例（選取項「浮起」於群組底色之上），群組外層容器
  `bg-gray-50 rounded-lg border border-border p-1`，與既有頁面大量使用
  的 `bg-gray-50`/`border-border` token 一致（非新創色票）。
- **focus-visible**：套用 `docs/design-system.md` 章節 8 既有統一規則
  `outline: 2px solid var(--color-accent); outline-offset: 2px`（即
  Tailwind `focus-visible:outline focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-accent`，與
  `ClickableRow`、`Button` 的 `focus-visible:ring`/`outline` 處理同一
  章節規則），不另創新的 focus 樣式。

### 4. 套用範圍：本 Story 不migrate 任何既有呼叫端（因為盤點後確認不存在任何既有篩選器）

依上方「現況盤點」，目前程式碼庫沒有任何使用者可操作的篩選器可供
migrate。這與規格背景「現況：未找到 segmented control 元件」的字面
描述一致，且盤點範圍更完整地確認了「連任何形式的篩選 UI 都不存在」，
不只是「存在但樣式不是 segmented control」。對照 SDLCCT-82 分拆意圖
（本 Story 的 Jira 描述本身即標註「由 SDLCCT-82 拆分」，且 SDLCCT-84/
85 在其各自描述中明文「依賴 SDLCCT-82 的『分段按鈕篩選元件』／『篩選器
規範』」），此分拆的產出物本來就是「可重用的元件與規範」本身，不是
「migrate N 個既有頁面」——因為當 S12 被拆出來的時候，母票 SDLCCT-82
下游的實際篩選器使用情境（SDLCCT-83/84/85/86）本來就還在 Backlog、尚未
建置，S12 的驗收範圍只能是元件與規範本身。

**本 Story 的 Exit Criteria 因此是**：(1) 產出
`frontend/components/common/segmented-filter.tsx` 元件本身，含選取樣式
與計數文字版面；(2) 產出一份可獨立執行的 Vitest 單元測試
（`segmented-filter.test.tsx`，比照 `clickable-row.test.tsx` 慣例）
覆蓋三個 Gherkin 情境（樣式/計數/切換，切換情境需包含鍵盤操作，例如以
`userEvent` 模擬方向鍵與 Enter/Space）；(3) 不需要、也不會新增任何頁面
篩選條件或改動任何篩選邏輯（範圍外字面要求）。驗收條件中的「樣式」
「計數」「切換」三個情境皆可在元件自身的單元測試層級完整驗證，不依賴
任何真實頁面呼叫端存在。

**本 Story 不做、留給 SDLCCT-83/84/85/86 各自處理**：把
`SegmentedFilter` 接到各自頁面的實際篩選資料與邏輯上（因為範圍外明文
「不新增篩選條件」，且目前沒有既有篩選邏輯可改——這些頁面的篩選邏輯本身
要到那些 story 才會新增）。

## UI 原型

見 `docs/design/SDLCCT-102-prototype.html`（可直接在瀏覽器開啟），並列
呈現：(1) 三選項分段按鈕的未選取／選取樣式；(2) 右側「顯示 n / N」計數
文字；(3) 鍵盤 focus 樣式（`:focus-visible` 的 outline 效果，以
`.demo-focus-visible` class 靜態模擬，因為靜態 HTML 無法重現真實 Tab
鍵焦點，已在原型頁面加註說明）；(4) 點擊切換後計數同步變化的互動示範
（原型頁內嵌最小 vanilla JS，純粹示意用，不代表最終 React 實作）。

## 開放設計問題（定稿時必須為空）

無。盤點確認目前無既有篩選器需要相容或遷移決策；元件介面的泛型與受控
單選設計已涵蓋規格三個情境與「未來 story 需重用」的已知跨票依賴（見
關鍵技術決策 1、4），不需規格補充即可定案。
