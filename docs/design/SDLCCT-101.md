# 設計文件 — SDLCCT-101 可點擊列共用元件：hover 底色、箭頭動效、鍵盤操作

## 對應需求規格

對應 SDLCCT-101（由 SDLCCT-82 全站共用規則拆分之 S11，已過 G1 定稿版）之
Gherkin 驗收條件：hover 底色＋箭頭動效、鍵盤 Enter/空白鍵開啟、可見焦點外
框、既有可點擊列套用共用元件且既有測試通過。範圍外：不處理可展開列（行
內展開）互動、不改篩選器。

**現況盤點**（實作前已逐一確認的程式碼事實，供套用範圍與相容性判斷依據）：

- `frontend/app/agents/page.tsx` 第 105–134 行 `AgentTable`：桌面版表格列
  `<tr>` 已有 `tabIndex={0}`、`role="link"`、`aria-label={agent.display}`、
  `onClick`/`onKeyDown`（Enter / 空白鍵）、`cursor-pointer` 與
  `hover:bg-gray-50`。**無**尾端箭頭。
- `frontend/components/agent-detail/top-traces-table.tsx` 第 100–124 行
  `TopTracesTable`：`<tr>` 已有 `role="button"`、`tabIndex={0}`、
  `onClick`/`onKeyDown`（Enter / 空白鍵，並 `preventDefault`）、
  `cursor-pointer` 與 `hover:bg-gray-50`。**無**尾端箭頭。
- 對 `frontend/components/` 與 `frontend/app/` 全域搜尋 `role="button"` 與
  `onKeyDown`，確認目前**僅有上述兩處**是「可點擊列」模式；
  `frontend/components/common/back-link.tsx`（`onKeyDown` 攔截空白鍵）是
  單一連結元件，非表格列，不在本 Story 套用範圍。
  `frontend/components/anomalies/anomaly-table.tsx`（含 `governance_gap`
  文案的異常列表）**目前列本身沒有 `onClick`/`role="button"`，不可點
  擊**——規格 Scenario「hover」提到的「治理缺口列」在現有程式碼中對應的
  是 `AgentTable` 內含 `GovernanceBadge` 的列（該列本身即為可點擊的
  agent 列），並非 `anomaly-table.tsx` 另一個獨立元件；`anomaly-table.tsx`
  本身不可點擊，不屬於本 Story「既有可點擊列」的套用範圍，維持現狀。
- `frontend/components/ui/` 目前只有 shadcn 的 `button.tsx`/`input.tsx`/
  `separator.tsx`/`sheet.tsx`/`sidebar.tsx`/`skeleton.tsx`/`tooltip.tsx`，
  **沒有**既有的表格列（table row）共用元件可沿用，因此本 Story 需新增
  一個共用元件，而非改用現成元件。
- `docs/design-system.md` 第 8 節既有無障礙規則：所有可互動元素
  `:focus-visible` 必須顯示
  `outline: 2px solid var(--color-accent); outline-offset: 2px`，對應
  Tailwind `focus-visible:outline focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-accent`
  （`frontend/components/common/back-link.tsx` 已採用同一組 class）。
  本 Story 的共用列元件直接沿用，不新增另一套焦點樣式。
- **跨元件樣式耦合測試搜尋**：於 `frontend/e2e/` 搜尋
  `toEqual`/`一致`/`getComputedStyle` 等跨元素樣式相等斷言，確認
  `agent-detail.spec.ts`（trace 列 padding 比較，`trace-detail.spec.ts`
  第 111–117 行）與 `agents.spec.ts`（金額欄位 `text-align`/
  `tabular-nums`，第 166–182 行）等既有跨元素比較，皆與本 Story 改動的
  「列本身的 hover/focus/箭頭樣式」無關（比較對象是儲存格文字樣式或
  樹狀列的縮排，不是可點擊列的底色/外框/箭頭）。**未發現**任何將本
  Story 要改動的選擇器與另一元件的計算樣式綁定相等的鏈式測試。
- `frontend/e2e/agents.spec.ts` 第 88–89 行只斷言 `table tbody tr` 的
  `aria-label` 屬性，未斷言 `role` 值；`frontend/e2e/agents.spec.ts` 第
  131、191 行的 `getByRole("link", { name: "Sales Copilot" })`
  明確註解為「Mobile card list（真正的 `<Link>`）」，與桌面
  `<tr>` 的 `role` 值無關。因此將 `AgentTable` 列的 `role` 由
  `"link"` 改為 `"button"`（見下方關鍵決策 2）不會破壞既有測試。
- `frontend/e2e/agent-detail.spec.ts` 第 813–814 行斷言
  trace 列 `toHaveClass(/cursor-pointer/)`，共用元件必須保留
  `cursor-pointer` class 以維持此既有測試通過。

## 介面/API 契約

無，本 Story 純前端互動元件調整（不涉及任何後端 API 或資料傳輸格式變
更）。

## 資料模型

無新增資料模型（不涉及任何資料庫欄位、資料表或索引變更）。

## 關鍵技術決策

1. **新增共用元件 `ClickableRow`，路徑
   `frontend/components/common/clickable-row.tsx`。**
   理由：`frontend/components/common/` 已是本 repo 既有的「跨頁面共用
   互動元件」慣例目錄（`back-link.tsx` 即在此），沿用同一目錄命名慣
   例，不另開新目錄；元件本身渲染為 `<tr>`（而非 `<div>` 包一層），因
   為呼叫端（`AgentTable`、`TopTracesTable`）本來就是 `<table>/<tbody>`
   結構，`<tr>` 必須是 `<tbody>` 的直接子元素，包一層會破壞表格語意與
   既有 CSS（`border-b`、`last:border-b-0` 等皆依賴列與列相鄰）。

2. **可互動語意統一採 `role="button"`（而非目前 `AgentTable` 使用的
   `role="link"`），`AgentTable` 需配合修改。**
   理由：規格 Scenario「鍵盤開啟」明確要求 Enter **或**空白鍵都要能觸
   發；依 WAI-ARIA，`role="link"` 的鍵盤慣例只定義 Enter 鍵觸發，空白
   鍵並非連結語意的標準觸發鍵，`role="button"` 才是同時支援 Enter 與
   空白鍵、且已被 `TopTracesTable` 採用的正確語意。已確認
   `frontend/e2e/agents.spec.ts` 第 88–89 行只檢查 `aria-label` 屬性、
   不檢查 `role` 值，第 131/191 行的 `getByRole("link", ...)` 明確是
   Mobile `<Link>` 卡片而非此 `<tr>`，故此變更不會破壞既有測試。

3. **焦點樣式沿用 `docs/design-system.md` 第 8 節既有規則
   （`focus-visible:outline focus-visible:outline-2
   focus-visible:outline-offset-2 focus-visible:outline-accent`），不
   另訂新樣式。**
   理由：避免站內出現第二套「可見焦點外框」規則，且
   `back-link.tsx` 已驗證此組合可用，降低不一致風險。

4. **箭頭 hover/focus 動效以 Tailwind `group`/`group-hover`/
   `group-focus-visible` 變體實作（在 `<tr>` 上加 `group` class，箭頭
   `<svg>` 用 `group-hover:text-accent group-focus-visible:text-accent
   group-hover:translate-x-1 group-focus-visible:translate-x-1
   transition-[color,transform]`），不用 JS state 控制 hover。**
   理由：純 CSS 變體可讓「滑鼠 hover」與「鍵盤 focus」共用同一組視覺
   規則（規格 Scenario「hover」與「焦點樣式」要求的底色/外框是兩個獨
   立視覺效果，但箭頭動效合理地在兩種觸發方式下一致呈現），不需額外
   state 與重渲染；Tailwind 的 `group` 機制不限定容器必須是特定標籤，
   可直接用在 `<tr>` 上。

5. **箭頭顏色預設用 `text-text-secondary`、hover/focus 時用
   `text-accent`，不新增色彩 token。**
   理由：直接沿用 `docs/design-system.md` 第 1 節已定義、已驗證對比度
   的既有兩個文字色 token，符合該文件「新增圖表/元件前先查既有 token，
   不自創色值」的既定方向（雖然該規則寫在資料視覺化章節，但其「不自
   創色值」精神同樣適用於互動元件）。

6. **兩個呼叫端各自新增一個尾端 `<td>` 放置箭頭圖示（欄位數 +1），不
   把箭頭塞進既有最後一欄內。**
   理由：規格明確要求「尾端箭頭」且目前兩個表格都還沒有這個視覺元
   素，是本 Story 要新增的內容而非既有欄位的樣式調整；獨立一欄可讓箭
   頭的 hover 位移不受既有欄位內容（如金額靠右、徽章置中）的排版影
   響，兩個表格的新增欄位一致不加 `<th>` 文字標籤（視覺裝飾，
   `aria-hidden="true"`），避免誤增語意欄位標題。

7. **`ClickableRow` 以 `children` 接收 `<td>`，用
   `onActivate: () => void` 取代目前兩處各自手寫的
   `onClick`/`onKeyDown`，呼叫端把原本的 `router.push(...)` 邏輯傳入
   `onActivate`。**
   理由：行為（Enter/空白鍵/點擊都呼叫同一個函式）完全一致，只是把
   重複的鍵盤事件判斷邏輯收斂到一處，降低未來第三個呼叫端複製貼上出
   現不一致的風險。

## UI 原型

見 `docs/design/SDLCCT-101-prototype.html`（可直接在瀏覽器開啟），示範
套用 `ClickableRow` 後的 Agent 清單列與執行列表列：預設狀態、滑鼠
hover 狀態（底色＋箭頭變色右移）、鍵盤 Tab 聚焦狀態（可見焦點外框，箭
頭亦變色右移，與 hover 視覺效果一致）三種畫面並列呈現。

## 開放設計問題(定稿時必須為空)

無
