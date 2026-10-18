# 設計文件 — SDLCCT-40 決定並建置前端測試工具鏈（單元 + e2e）

## 對應需求規格
對應 G1 已核准的需求規格：`frontend/` 目前完全沒有單元測試或 e2e 測試工具
鏈（`project-profile.yaml` 的 `commands.test` 不含前端指令、`commands.e2e`
為空字串），`frontend/AGENTS.md` 也沒有任何人工撰寫的測試判斷準則。本票
選定、安裝並設定好一套單元測試框架與一套 e2e 測試框架，各附一個可運作的
示範測試，整合進 CI，並在 `frontend/AGENTS.md` 記錄「何時必須寫自動化
測試、何時可依 SDLCCT-32/34 先例宣告不需要 e2e」的判斷準則。範圍外：不為
SDLCCT-32/34 補測試、不設覆蓋率門檻、不要求覆蓋任何未來畫面的具體功能、
不改既有 `frontend_lint`/`frontend_build` 行為。

## 介面/API 契約
不適用。本票不新增/變更任何對外 API 端點或 request/response 格式，只新增
測試工具鏈的設定檔與 CI 步驟。

## 資料模型
不適用。本票不涉及任何資料表、欄位或索引變更。

## 關鍵技術決策

1. **單元測試框架：Vitest + React Testing Library（人類建議採用，本案
   確認、不覆寫）。**
   `frontend/package.json` 目前的 stack 是 Next.js 16（App Router）+
   React 19 + Turbopack，且 `devDependencies` 已經是 ESM-only、無
   Babel 設定。Jest 對 React 19 + App Router 的 ESM/Server Component
   邊界需要額外的 transform 設定與相容性修補；Vitest 原生支援 ESM、啟動
   速度快、且與 Next.js 官方文件推薦的測試路徑一致，不需要額外的
   babel-jest 轉譯層。`use-fetch-once.ts` 是一個標準 React hook（無
   App Router 伺服器端專屬 API），`@testing-library/react` 的
   `renderHook`/`waitFor` 可直接測試，不需要任何 Next.js 專屬的測試
   adapter。因此採用 `vitest` + `@testing-library/react` +
   `@testing-library/jest-dom`，測試環境用 `jsdom`。

2. **e2e 測試框架：Playwright（人類建議採用，本案確認、不覆寫）。**
   Playwright 官方對 Next.js App Router 有第一方範例與
   `create-next-app --example with-playwright` 的對應設定，`webServer`
   選項可直接在設定檔內啟動 `next build && next start`，不需要額外的
   腳本膠水程式碼去判斷伺服器是否已啟動（對照 `quality`/`bff` 兩個既有
   job 都是「單一指令跑完」的風格，`playwright test` 搭配 `webServer`
   同樣是「單一指令跑完」，風格一致）。

3. **示範單元測試目標：`frontend/lib/use-fetch-once.ts`，確認為合適
   目標、不改用其他檔案。**
   此 hook 符合三個條件：(a) 純邏輯、無 UI 渲染，不需要掛載完整頁面樹；
   (b) 對外只回傳 `{ status, data/error, retry }`，天然就是「可觀察的
   行為結果」而非內部實作細節；(c) 不需要任何外部服務 mock（`fetcher`
   本身就是注入的參數，測試只需傳入一個回傳 `Promise` 的假函式，不需要
   mock `fetch`/網路層）。示範測試斷言：
   - 初始呼叫 `renderHook(() => useFetchOnce(fetcher))` 後，
     `result.current.status` 為 `"loading"`；
   - fetcher 的 Promise resolve 後（`await waitFor(...)`），
     `result.current.status` 變為 `"success"` 且
     `result.current.data` 等於 fetcher 回傳的值。
   這兩個斷言只讀取 hook 回傳的公開欄位，不窺探 `useState`/`useEffect`
   內部實作，符合 CONSTITUTION.md「測試驗證行為而非實作細節」。

4. **示範 e2e 測試目標：`/cost-dashboard` 頁面的靜態、不依賴後端成功的
   內容。**
   `frontend/app/cost-dashboard/page.tsx` 的 header（「Agent Control
   Tower」）、`<h1>`（「成本總覽」）與 footer 文字是在元件最外層直接
   渲染的靜態 JSX，不等待任何 `fetch` 完成、也不因 BFF 無法連線而消失
   （只有 `anchorDate` 這個次要欄位會因失敗顯示「無法取得」，不影響這兩
   個斷言）。選這個目標而非依賴 BFF 回應的 `SummarySection`/
   `PeriodComparisonSection` 內容，是因為 e2e CI 環境沒有啟動真正的 BFF
   服務（本票範圍不含給 e2e 建一個假後端），選擇不依賴後端成功與否的
   斷言，可以讓這個示範測試在純前端靜態伺服器下穩定通過，同時仍然是
   「驗證一個現有畫面的可觀察行為」。示範測試斷言：
   - `page.goto("/cost-dashboard")` 後，
     `page.getByText("Agent Control Tower")` 可見；
   - `page.getByRole("heading", { name: "成本總覽" })` 可見。

5. **Playwright `webServer` 設定：`next build && next start`，固定埠
   `3100`（非開發慣用的 `3000`），`reuseExistingServer: !process.env.CI`，
   `timeout: 120_000`。**
   用 build+start（production 模式）而非 `next dev`，是因為 CI 的
   `frontend` job 已經在同一個 job 中跑過 `npm run build`
   （SDLCCT-42 既有步驟），e2e 用同樣的 production build 更貼近實際
   部署行為、且啟動速度比 `next dev` 的首次編譯更快更穩定。埠選
   `3100` 而非預設 `3000`，是為了避免與開發者本機可能同時開著的
   `npm run dev`（預設 3000）衝突；`reuseExistingServer: !process.env.CI`
   沿用 Playwright 官方範例的慣例，讓 CI 環境永遠啟動一個全新伺服器
   （避免重用到上一個 job 殘留的程序），本機開發時若已手動啟動對應埠
   的伺服器則重用，加快本機疊代速度。build 階段需要的
   `NEXT_PUBLIC_BFF_URL` 佔位字串沿用 SDLCCT-42 CI job 的既有做法
   （`http://localhost:8000`，純佔位、不實際連線，見 SDLCCT-42 設計
   文件決策 6）。

6. **`project-profile.yaml` 新增 `frontend_test`、`frontend_e2e` 兩個
   command 項目，命名比照既有 `frontend_lint`/`frontend_build`。**
   ```yaml
   frontend_test: "cd frontend && npm run test"
   frontend_e2e: "cd frontend && npm run test:e2e"
   ```
   對應 `frontend/package.json` 新增的兩個 script：
   `"test": "vitest run"`、`"test:e2e": "playwright test"`。

7. **同時把既有的 top-level `commands.e2e`（目前為空字串）設為與
   `frontend_e2e` 相同的指令，不保留空字串。**
   `project-profile.yaml` 現有的 `e2e: ""` 這一行的註解明確寫著
   「SDLCCT-32 explicitly scoped...set this when the first story that
   needs e2e adds it」——本票就是那個故事，所以把這個既有、已經預留好
   的欄位填上，而不是只新增 `frontend_e2e` 讓 `e2e:` 繼續空著形成兩個
   語意重疊但一個有值一個沒值的欄位。這不是發明新的產品需求，只是落實
   既有欄位的既有註解所描述的觸發條件。
   ```yaml
   e2e: "cd frontend && npm run test:e2e"   # SDLCCT-40: Playwright demo e2e test
   ```

8. **CI 整合：在既有 `frontend` job 內的 `Build` 步驟之後新增兩個
   步驟（`Unit tests`、`Install Playwright browsers` + `E2E tests`），
   不另開新 job。**
   `frontend` job（SDLCCT-42 新增）已經是「同一個 working-directory、
   同一組 Node 環境」的單一 job；單元測試與 e2e 測試都在同一個已安裝好
   依賴、已設定好 Node 版本的環境下執行，拆成獨立 job 只會重複一次
   `actions/setup-node@v4` + `npm ci` 的安裝成本，沒有額外好處。新增的
   步驟如下（插入既有 `Build` 步驟之後）：
   ```yaml
       - name: Unit tests
         run: npm run test

       - name: Install Playwright browsers
         run: npx playwright install --with-deps chromium

       - name: E2E tests
         run: npm run test:e2e
         env:
           NEXT_PUBLIC_BFF_URL: 'http://localhost:8000'
   ```
   `Install Playwright browsers` 只安裝 `chromium`（不裝 firefox/webkit）
   ，因為目前只有一個示範 e2e 測試、不需要跨瀏覽器矩陣，裝一個瀏覽器
   即可把 CI 安裝時間降到最低；未來若真的需要跨瀏覽器驗證，是之後的
   故事再擴充，不在本票範圍內先行設計。

9. **e2e CI 策略：每個 PR 都跑，不設條件式跳過；明確記錄這是暫時性
   決定，待 e2e 測試數量增加後需要重新評估。**
   目前只有一個示範 e2e 測試，`next build && next start` 加上單一頁面
   導覽與兩個文字斷言，實測執行時間在數十秒等級，相對於整個 CI pipeline
   （包含 `quality`/`bff` 兩個 Python job）而言不是瓶頸。因此選擇「每個
   PR 都跑」而非「只在 merge 到 main 時跑」或「加 label 才跑」這類條件式
   策略——條件式策略會讓「e2e 測試壞掉」這件事可能在多個 PR 疊加之後才被
   發現，增加除錯範圍，對目前規模而言不值得。**但這是依賴測試數量很少的
   暫時性判斷**：當未來畫面 Story 依照 `frontend/AGENTS.md`（見下方決策
   10）新增的判斷準則持續新增 e2e 測試、累積到讓單次 PR 的 CI 時間
   明顯變長時，需要有故事重新評估是否改為「只在特定條件下跑」（例如
   label 觸發、或排除純文件/設定變更的 PR）——本票不先行設計那個條件，
   避免在測試數量還是個位數的現在就過度設計未來才需要的機制。

10. **`frontend/AGENTS.md` 新增的判斷準則文字（本票的實際交付文字，
    開發者直接採用、非待補內容）：**
    ```markdown
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
    ```
    此段文字直接新增在既有自動產生區塊（`<!-- BEGIN:nextjs-agent-rules
    -->` ... `<!-- END:nextjs-agent-rules -->`）**之後**，不插入在該
    區塊內部——該區塊是 `next dev` 每次重新產生、覆寫的內容（見檔案內
    註解），人工內容若寫在區塊內部會在下一次 `next dev` 執行時被覆寫
    遺失。

## UI 原型
不適用，不需要新增原型檔案。本票是純測試工具鏈與 CI 設定變更（新增
`vitest.config.ts`、`playwright.config.ts`、兩個示範測試檔、
`frontend/AGENTS.md` 的文字段落、CI YAML 步驟、`project-profile.yaml`
的 command 項目），不產生、也不修改任何使用者可見的畫面或元件——示範
e2e 測試讀取的是既有 `/cost-dashboard` 頁面的既有渲染內容，本票不變更
該頁面本身，因此沒有「這個故事帶來的新畫面」需要在 G1b 給人類看。

## 開放設計問題（定稿時必須為空）
無——驗收條件已完整定義本票需要的工具鏈、CI 整合方式與文件內容；本設計
文件「關鍵技術決策」段落已將所有 HOW 層級的實作選擇（框架選型、示範測試
斷言內容、CI 步驟插入位置、e2e 執行策略、`project-profile.yaml` 命名、
`frontend/AGENTS.md` 文字）定案，無殘留的產品層級未決項。
