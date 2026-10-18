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
