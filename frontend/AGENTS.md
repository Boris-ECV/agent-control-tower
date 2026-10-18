<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 自動化測試判斷準則（SDLCCT-40）

本專案的單元測試工具鏈是 Vitest + React Testing Library
（`npm run test`），e2e 測試工具鏈是 Playwright（`npm run test:e2e`）。
示範測試位置：`frontend/lib/use-fetch-once.test.ts`（單元）、
`frontend/e2e/cost-dashboard.spec.ts`（e2e）。

### 何時必須寫自動化測試
- 新增或修改任何**有互動邏輯**的元件或 hook（例如：表單驗證、
  重試/輪詢、依賴使用者輸入分支顯示不同內容、依賴非同步資料改變畫面
  狀態）——至少要有單元測試覆蓋該邏輯的可觀察行為（輸入 → 輸出/
  狀態轉換），不要求覆蓋率門檻，但每一條會改變使用者可見結果的分支
  至少要有一個斷言。
- 新增一個**新頁面路由**（`app/**/page.tsx`）——至少要有一個 e2e
  測試驗證該頁面能正常載入並顯示預期的靜態內容（標題、關鍵文字），
  不要求覆蓋該頁面所有功能分支。

### 何時可以依循 SDLCCT-32/34 先例宣告不需要 e2e
- 純版面/樣式調整（間距、顏色、字級、RWD breakpoint），沒有新增互動
  邏輯或新頁面路由——SDLCCT-32/34 當時以「視覺化 smoke 檢查
  （screenshot）＋人工審核」取代自動化 e2e，理由是當時沒有互動邏輯
  需要驗證，純粹是渲染結果的視覺正確性，人工看一次截圖即可判斷。
- 延續既有、已通過審核頁面的小幅內容調整（例如改一段靜態文案），且
  該調整不影響任何既有的互動邏輯或既有 e2e 測試斷言的元素——在設計
  文件的「關鍵技術決策」段落寫明「本次調整屬於 SDLCCT-32/34 先例的
  純視覺/文案變更，不需要新增 e2e」並附理由即可，不需要每次都重新
  討論。
- 若無法判斷屬於上述哪一類（例如：看起來是純樣式調整，但其實改動的
  CSS 會連動其他元素的 computed style、或牽涉到跨元素一致性斷言），
  該判斷本身視為一個產品/設計層級的開放問題，寫入該票的設計文件
  「開放設計問題」段落，由架構師在 G1b 階段決定，不要由開發者自行
  默默跳過 e2e。

## i18n 字串與翻譯 key 命名慣例（SDLCCT-37）

本專案的 zh-TW 字串集中在 `frontend/lib/i18n/messages.ts`，透過
`frontend/lib/i18n/t.ts` 的 `t(key)` 函式讀取。元件/頁面內**不可**再
寫死中文字面常數（JSX 文字節點、`aria-label`、`alt`、`title` 屬性等
使用者可見文字皆算）。

### Key 結構
`<頁面或元件>.<區段>.<元素>`，以 `.` 分隔，每一段用 camelCase：
- 第一段是頁面或共用元件的簡稱（例如 `costOverview`、`sidebar`、
  `errorCard`），對應 `messages.ts` 的最外層分組。
- 中間段是該頁面/元件內的區段或子元件（例如 `summarySection`、
  `header`、`footer`）。
- 最後一段是該區段內的具體元素用途（例如 `title`、`label`、`sub`、
  `retry`），不是字面文字本身的翻譯（key 要在文字內容修改後仍然有
  意義）。

### 重複文字
畫面上literally 相同的中文字串（例如同一段文字同時作為 `aria-label`
與可見標題），**必須**指向 `messages.ts` 同一個 key，不得為每個使用
位置各自定義一份重複字串。新增字串前先搜尋 `messages.ts` 是否已有
相同文字。

### 插值文字
需要帶入變數（數量、日期範圍、金額等）的訊息，在 `messages.ts` 中宣告
為回傳字串的函式（例如 `(count: number) => \`...${count}...\``），不要
用字串模板佔位符號 + 執行期字串替換——函式形式可以直接拿到 TypeScript
的參數型別檢查。

### 非中文字面
英文品牌名稱（例如「Agent Control Tower」）或英文詞彙（例如表格欄位
「Agent」）不是 zh-TW 翻譯字串，維持原樣寫在元件內，不需要（也不應該）
搬進 `messages.ts`。

### 新增畫面
新頁面/元件若有使用者可見的中文文字，在 `messages.ts` 新增對應分組，
並在元件內透過 `t("...")` 讀取；不要在等後續故事時才一次性搬移。
