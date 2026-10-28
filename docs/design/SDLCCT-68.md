# 設計文件 — SDLCCT-68 右側工作區頂部重複顯示產品標題「Agent Control Tower」

## 對應需求規格
G1 通過版本（2026-10-28 finalize）。核心要求：移除 5 個畫面/元件的 sticky
`<header>` 中重複出現的「Agent Control Tower」文字節點；各畫面自己的
`<h1>` 標題與（cost-dashboard/anomalies/agents/agent-detail 共用形狀的
header 中）日期 meta 文字維持不變；側邊欄（`app-sidebar.tsx`）中的
「Agent Control Tower」維持不動。範圍外：側邊欄顯示、header 日期資訊的
邏輯/樣式、`<h1>` 文字內容/i18n 字串、`document.title`、整體排版/間距重新
設計。依賴 SDLCCT-34（側邊欄殼層），需同步更新既有 e2e 斷言。

## 現狀調查（code grep 結果，再次核實既有分析）
- `frontend/components/layout/app-sidebar.tsx` L62-68：側邊欄 `<SidebarHeader>`
  內的「Agent Control Tower」是唯一保留的正確顯示位置，本次不動。
- 重複文字節點存在於 5 個檔案，皆位於頁面頂部 sticky `<header>`
  （`sticky top-0 z-10 flex items-center justify-between ...`），與該頁的
  `<h1>` 分離、各自獨立：
  1. `frontend/app/cost-dashboard/page.tsx`（header 內有日期 meta span）
  2. `frontend/app/anomalies/page.tsx`（header 內有日期 meta span）
  3. `frontend/app/agents/page.tsx`（header 內有日期 meta span）
  4. `frontend/components/agent-detail/agent-detail-content.tsx`（header 內有日期 meta span）
  5. `frontend/components/trace-detail/trace-detail-content.tsx`（header 內**沒有**
     其他子元素——目前整個 `<header>` 唯一的內容就是這段重複文字）
- 5 個 header 的結構目前都是 `flex items-center justify-between`，前 4 個
  有兩個子元素（標題 span + 日期 meta span），第 5 個（trace-detail）只有
  一個子元素（標題 span）。
- e2e 現狀：`frontend/e2e/{cost-dashboard,anomalies,agents,agent-detail,
  i18n-cost-dashboard-strings}.spec.ts` 共 5 個檔案、各 1 處斷言，型式一律
  是 `page.locator("header").getByText("Agent Control Tower")).toBeVisible()`，
  並附註解「因為側邊欄也有這段文字，為避免 Playwright strict mode 判定
  ambiguous，才刻意 scope 到 `<header>`」。`trace-detail.spec.ts` 目前完全
  沒有針對這段文字或 header 的斷言（與票面描述的「5 個 spec」吻合——
  trace-detail 的 header 文字從未被單獨測過）。
- **cross-element 樣式耦合測試檢查**（本職責步驟 4）：搜尋 `frontend/e2e/`
  中 `toEqual`/`toHaveCSS`/「一致」等比對兩元素 computed style 相等的斷言，
  僅在 `trace-detail.spec.ts` 命中一次 grep（`getComputedStyle` 字樣，經人工
  核對後確認是誤判——該檔案不含任何此類比對，也不含任何 header 相關斷言）。
  本次變更範圍內的 5 個檔案、5 個 header 元素，在全 repo e2e 測試中都找不到
  任何「斷言兩個元素 computed style 相等」的耦合測試。結論：不適用，無需
  列出任何鏈式耦合項目。

## 介面/API 契約
無。本 Story 不涉及任何 API/BFF 端點變更，純前端展示層 DOM 結構調整。

## 資料模型
無新增資料模型。不改動任何資料來源、API 回應格式或日期/成本計算邏輯。

## 關鍵技術決策
1. **只刪除標題文字節點本身，不刪除整個 `<header>` 容器**——即使
   trace-detail 的 header 刪除後會變成空的 sticky bar（無文字內容，只剩
   padding/border）。依規格「範圍外：不做整體排版/間距重新設計，僅移除
   重複文字節點」，移除整個 `<header>` 元素屬於排版重新設計（會改變頁面
   是否還有 sticky bar 這一層結構），超出本票授權範圍，所以保留容器、只
   移除裡面的文字 span。
2. **前 4 個檔案（cost-dashboard/anomalies/agents/agent-detail-content）的
   header 容器 class 由 `justify-between` 改為 `justify-end`**——這 4 個
   header 目前有兩個子元素（標題 span + 日期 meta span）靠 `justify-between`
   分佔兩端；刪除標題 span 後若不調整，flex 容器只剩一個子元素時
   `justify-between` 的效果等同 `flex-start`，日期 meta 會從右側跳到左側，
   這是移除文字節點的**副作用**而非 spec 要求的版面改動。改成
   `justify-end` 是達成「日期 meta 樣式/位置完全不變」最小必要的配套調整，
   不等於重新設計排版（容器本身的 padding/border/sticky 行為、日期 span
   自己的 class 完全不動）。trace-detail 的 header 沒有第二個子元素，不需要
   此調整，保留 `justify-between`（即使空容器下該屬性不再有視覺效果，也
   不是本票要清理的範圍）。
3. **e2e 斷言更新方式統一為「兩段式」**，取代現有單一的
   `page.locator("header").getByText("Agent Control Tower")).toBeVisible()`：
   - 斷言 header 內已不存在該文字：
     `await expect(page.locator("header").getByText("Agent Control Tower")).toHaveCount(0);`
   - 斷言側邊欄仍顯示該文字——移除 header 內的重複文字後，原本「因為
     側邊欄也有這段文字而需要 scope 到 header 以避免 ambiguous」的理由
     不再存在，所以改用不 scope 的 locator，此時唯一符合的元素就是側邊欄：
     `await expect(page.getByText("Agent Control Tower")).toBeVisible();`
   套用於 `cost-dashboard.spec.ts`、`anomalies.spec.ts`、`agents.spec.ts`、
   `agent-detail.spec.ts`、`i18n-cost-dashboard-strings.spec.ts` 共 5 個檔案、
   各 1 處既有斷言。既有「註解說明為何 scope 到 header」的那幾行註解需同步
   刪除或改寫（註解描述的 ambiguous 原因在改動後不再成立，留著會誤導未來
   讀者）。`<h1>`/日期 meta 相關斷言維持原樣，不變更其期望值。
   `trace-detail.spec.ts` 本身沒有既有斷言需要改，也不需要新增斷言
   （本票不要求新增測試覆蓋，只要求同步既有斷言；trace-detail 的 header
   原本就未被單獨測試過）。

## UI 原型
`docs/design/SDLCCT-68-prototype.html`（可直接在瀏覽器開啟）。這確實是一次
版面變更（從 5 個 sticky header 中移除一個文字節點，其中 4 個還牽動
`justify-between`→`justify-end` 的配套調整），依本職責「UI 原型」小節判斷
標準（版面配置調整的預設建議值），判定**需要**原型，但依
CONSTITUTION.md「設計文件應與 Story 規模成比例」及職責步驟 5 的 scope
discipline，只做最小聚焦範圍：只放 sticky header 區塊本身的 before/after
（兩種既有 header 形狀各一組：含日期 meta 的、不含日期 meta 的
trace-detail），不複製整頁版面、不含側邊欄（側邊欄本身不是本票變更對象）。

## 開放設計問題(定稿時必須為空)
無。
