# 設計文件 — SDLCCT-36 側欄在 md 斷點以下無響應式行為

## 對應需求規格
對應 G1 已核准的需求規格:寬度小於 768px（md 斷點以下）時,側欄不應
以固定展開狀態佔用版面寬度,且需有明確的觸發按鈕可開關側欄;768px
以上(md 以上)維持目前固定展開、不收合的視覺呈現與既有 4 組 9 項
導覽結構、標籤文字、7 個無 href 項目「點擊無反應」行為不變;側欄
分組/項目內容本身不受本次修正影響。

## 現狀查核（設計前已讀取的既有程式碼）
- `frontend/components/layout/app-sidebar.tsx` 第 61 行:
  `<Sidebar collapsible="none">`。這是無響應式行為的根因——
  `frontend/components/ui/sidebar.tsx` 第 167–180 行,`collapsible
  === "none"` 分支直接回傳一個固定 `w-(--sidebar-width)` 的 `div`,
  完全不檢查 `isMobile`,也不渲染任何 Sheet/off-canvas 邏輯,因此
  無論可視寬度多少,側欄永遠以固定寬度佔用版面。
- `frontend/components/ui/sidebar.tsx`:
  - 第 163 行:`collapsible` 可選值為 `"offcanvas" | "icon" | "none"`,
    其中 `"offcanvas"` 是元件的預設值(第 155 行)。
  - 第 182–206 行:當 `collapsible !== "none"` 且 `isMobile` 為真時,
    改用 `Sheet`(對話框式滑出面板)渲染側欄內容,由 `openMobile`
    狀態控制開關,初始值為 `false`(第 70 行)。
  - 第 208–251 行:當 `collapsible !== "none"` 且非 mobile 時,渲染
    固定寬度、`md:flex` 的側欄容器;收合與否由 `state`
    (`open`/`setOpen`,初始 `defaultOpen = true`,第 57、74 行)
    控制,`group-data-[collapsible=offcanvas]:left-[calc(...)]`
    只在 `data-collapsible` 屬性被設為非空(即 `state === "collapsed"`)
    時才把側欄位移出畫面(第 212、233 行)。也就是說,只要
    `open` 保持 `true`(預設值,且本故事不會呼叫 `setOpen(false)`),
    桌面寬度下的視覺呈現與目前「固定展開、不收合」完全相同。
  - 第 254–278 行:`SidebarTrigger` 是一顆以 `toggleSidebar()` 為
    `onClick` 的圖示按鈕,`toggleSidebar`(第 92–94 行)依
    `isMobile` 決定切換 `openMobile` 或 `open`。元件本身未限制在
    哪個斷點顯示,外部使用者需自行用 className 控制可見性。
- `frontend/hooks/use-mobile.ts` 第 3 行:
  `MOBILE_BREAKPOINT = 768`,`useIsMobile()` 以
  `window.matchMedia("(max-width: 767px)")` 判斷,與 Tailwind 的
  `md` 斷點(768px)完全對齊——元件現有的 `isMobile` 判斷與本票
  AC 的「md 斷點以下」定義一致,不需另外調整斷點數字。
- `frontend/app/layout.tsx`:目前無任何 header/topbar 元件;
  `SidebarProvider` 直接包住 `AppSidebar` 與 `SidebarInset`,
  `SidebarInset` 內容即為各頁面 `children`,頁面本身(如
  `cost-dashboard/page.tsx`)也未自帶頂部列可放置觸發按鈕。
- `tests/e2e/` 目錄不存在(`Glob("**/tests/e2e/**")` 無結果),與
  SDLCCT-34/35 設計文件查核結果一致,因此不存在任何比較兩個元素
  computed style 相等的既有測試;本故事雖然變動 `Sidebar` 的
  `collapsible` 屬性,但未新增/變更任何其他選取器的樣式,跨元素
  樣式耦合測試檢查不適用。
- `docs/design/SDLCCT-34.md`、`SDLCCT-35.md`:4 組 9 項導覽的分組、
  標籤文字、href 設定已在前兩票核准定案,本票不修改
  `NAV_GROUPS` 常數本身(第 32–55 行),僅修改 `AppSidebar` 第 61
  行的 `collapsible` 屬性與新增觸發按鈕的放置位置。

## 介面/API 契約
無——本故事不涉及任何對外 HTTP 端點、request/response 格式或狀態碼
變更。純前端元件屬性與版面配置調整。

## 資料模型
無新增資料模型。`NavItem`/`NavGroup` 型別與 `NAV_GROUPS` 常數的值
完全不變。

## 關鍵技術決策

### 1. `collapsible` 屬性由 `"none"` 改為 `"offcanvas"`(而非 `"icon"`)
AC 明確要求「側欄不以固定展開狀態佔用版面寬度」且「點擊觸發按鈕後
側欄內容(4 組 9 項導覽)變為可見」——`"icon"` 模式在收合時仍會以
圖示寬度(`--sidebar-width-icon`)佔用版面,且收合狀態下導覽項目
文字會隱藏,不符合「不佔用固定版面寬度」與「點擊後完整導覽內容
可見」兩項要求。`"offcanvas"` 模式完全符合:窄螢幕下元件自動切換
為 `Sheet`(滑出式對話框),初始 `openMobile = false`,不佔用任何
版面寬度;點擊 `SidebarTrigger` 呼叫 `toggleSidebar()` 展開後,
`SidebarContent` 的完整 4 組 9 項導覽原樣渲染在 Sheet 內,再次點擊
或既有的 Sheet 關閉機制(背景點擊、ESC)可收回——後者即 AC 要求的
「既有的收合機制」,不需額外開發。這是 shadcn Sidebar 元件的預設值
(`collapsible = "offcanvas"`,第 155 行),改回預設值即可,不需
自訂收合邏輯。

### 2. 桌面(md 以上)不渲染 `SidebarTrigger`,維持「不收合」不變
元件本身的 `isMobile` 判斷(`useIsMobile()`,斷點 768px)已確保
窄螢幕與桌面寬度自動切換渲染模式,開發者不需額外寫媒體查詢條件。
但 `SidebarTrigger` 元件本身不限制顯示斷點,若直接放置會在桌面也
可見並可點擊,讓使用者得以在桌面收合側欄——這會改變 AC3 要求「桌面
寬度下側欄維持目前固定展開、不收合的視覺呈現」之外的新互動可能性
(規格未要求,也未測試過桌面收合後的畫面)。決策:在觸發按鈕
外層容器加上 `md:hidden`,使其只在小於 768px 時出現,桌面寬度下
完全不渲染觸發按鈕,`open` 狀態維持 `defaultOpen = true` 不被使用者
觸發變更,桌面視覺與互動行為與修正前逐位元相同。理由:規格只要求
新增窄螢幕的開關能力,未要求新增桌面收合能力,依 CONSTITUTION
「不要實作規格未要求的能力」的 scope 原則,不在桌面引入未被要求、
也未被測試覆蓋的新互動。

### 3. `SidebarTrigger` 放置位置:`SidebarInset` 內容最上方新增一行
極簡 inline 列,不新建獨立 Header/Topbar 元件
目前 repo 沒有任何頂部列/Header 元件(`layout.tsx`、各 `page.tsx`
皆無)。本故事只需要在窄螢幕下有地方可以放一顆觸發按鈕,新增一個
正式的全站 Header/Topbar 元件(含品牌、麵包屑等)超出本票範圍
(AC 未提及任何頂部列內容,只要求「觸發按鈕」存在)。決策:在
`SidebarInset` 內、`{children}` 之前插入一個只在 `md:hidden` 時
顯示的極簡列(僅包含 `SidebarTrigger`),不建立新的共用 Header
元件、不引入標題/麵包屑等本票未要求的內容。理由:比照
`docs/design/SDLCCT-34.md`「決策 7」與 `SDLCCT-35.md`「決策 2」已
定案的「不預先設計未被要求的抽象層」原則——若未來故事要求完整
頂部列,再由該故事決定是否重構為獨立元件,本票不預先設計。
放在 `layout.tsx`(`SidebarInset` 內側最上方)而非每個 `page.tsx`
重複加入,因為這是跨頁面共用的版面殼層邏輯,放在 `layout.tsx` 可
一次套用到所有頁面,符合 AC4「任一頁面」的範圍要求,且與
`SidebarProvider`/`AppSidebar`/`SidebarInset` 已有的版面組裝位置
一致。

### 4. 不處理收合狀態持久化
`SidebarProvider` 的 `setOpen` 本身會寫入 `sidebar_state` cookie
(第 86 行,既有邏輯,非本故事新增),但 `openMobile`(窄螢幕開關
狀態)只存在於元件內部 React state,重新整理頁面後永遠重置為
`false`(收合)。規格範圍外明文排除「收合狀態持久化(不預設需求)」,
故不額外處理,也不去新增/移除既有 `open` 狀態的 cookie 行為。

## UI 原型
`docs/design/SDLCCT-36-prototype.html`:靜態 HTML 原型,以純
CSS media query(`@media (max-width: 767px)` / `(min-width: 1024px)`)
模擬兩個並排區塊:
- 「sm(< 640px)」區塊:固定寬度 375px 容器,預設不顯示側欄面板
  (off-canvas,寬度 0,不佔用版面),內容區滿寬;可見一顆側欄觸發
  按鈕;並以 `:target`/checkbox 技巧示範「點擊觸發按鈕後側欄面板
  滑出覆蓋、顯示完整 4 組 9 項導覽」與「再次點擊可收回」兩個互動
  狀態(各自一張可見的靜態畫面,標註「收合狀態」/「展開狀態」)。
- 「lg(≥ 1024px)」區塊:固定寬度 1024px 容器,側欄固定展開佔用
  左側 256px 版面寬度,不顯示觸發按鈕,內容區占用剩餘寬度——與
  目前桌面樣式逐位元相同。

兩區塊並排呈現、各自標註寬度與狀態文字,讓人類審核者不需真的縮放
瀏覽器視窗即可在單一檔案中同時看到 sm 收合/展開兩態與 lg 固定態的
真實外觀與互動,滿足 G1b「不可僅以文字描述取代視覺示範」要求。

## 開放設計問題（定稿時必須為空）
（無）
