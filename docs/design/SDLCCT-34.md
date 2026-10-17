# 設計文件 — SDLCCT-34 Portal shell：側欄導覽（包裝 Cost Dashboard）

## 對應需求規格
對應 G1 已核准的需求規格「Portal shell: sidebar navigation (wraps Cost
Dashboard)」。使用者故事：工廠主管打開 Portal 時應看到依 L1 觀測／L2
治理／L3 介入分層的專業側欄導覽（Overview／Governance／Action／
Settings 四組、共 9 個導覽項），取代目前單頁 + 固定頂部 navbar 的畫面，
同時成本儀表板（SDLCCT-32）功能必須完全不變。8 條 AC：(1) 側欄結構與
分組正確、逐字 zh-TW 標籤；(2) Cost Dashboard 包裝後兩個既有 API 呼叫
行為/錯誤呈現方式完全不變；(3) 目前畫面在側欄被標示（current-page
indicator）；(4) 七個無功能項目點擊不產生任何導向/彈出/console 錯誤；
(5) 七個無功能項目視覺樣式與可用項目完全一致，不呈現 disabled 外觀，
不加「規劃中」標記；(6) Settings/System 為可導覽的空白頁面；(7) 套用
`docs/design-system.md` 既定 token，不新增色彩/間距，`--sidebar*` 系列
CSS 變數必須別名指向既有 5 個 token，不得維持 shadcn 預設獨立 oklch
值；(8) zh-TW、無 Opik 品牌字樣、G1b 原型可獨立開啟。範圍外：其餘 5 個
畫面的實際內容、Policy Engine/Approval Workflow/Pause Agent/Kill
Switch 的真實邏輯、Settings/System 的實際設定功能、側欄收合展開等進階
互動、登入/權限/多租戶、客戶品牌/Logo。依賴：SDLCCT-32（Done）、
SDLCCT-33（Done）。

## 現狀查核（實作前已讀取的既有程式碼）
- `frontend/app/page.tsx`：目前整個「成本總覽」畫面（含固定頂部
  `<header>` navbar：左側「Agent Control Tower」標題、右側「今天（台灣
  時間）」錨點日期）、`<main>` 內兩個 `<section>`（`SummarySection`、
  `PeriodComparisonSection`），皆為單一頁面元件，無任何路由分頁。
- `frontend/app/layout.tsx`：`RootLayout` 只設定 `<html lang="zh-Hant">`
  + `<body className="min-h-full flex flex-col">{children}</body>`，無
  任何導覽/側欄結構。
- `frontend/app/globals.css`：`--background`/`--foreground`/
  `--muted-foreground`/`--border`/`--primary`/`--accent` 等 shadcn 語意
  變數已正確別名指向本專案 5 個 `--color-*` token（SDLCCT-33 定案）；但
  `--sidebar`、`--sidebar-foreground`、`--sidebar-primary`、
  `--sidebar-primary-foreground`、`--sidebar-accent`、
  `--sidebar-accent-foreground`、`--sidebar-border`、`--sidebar-ring`
  （`:root` 第 101–108 行）目前仍是 shadcn `init` 產生的獨立 oklch 灰階
  值，未被別名指向任何 `--color-*` token——此為 AC7 明文要修的缺口。
- `frontend/components/ui/`：只有 `button.tsx`（base-ui + CVA 封裝），
  尚無任何 `sidebar.tsx`，`npx shadcn@latest add sidebar` 尚未執行過。
- `frontend/components.json`：`style: "base-nova"`、`iconLibrary:
  "lucide"`、`cssVariables: true`——shadcn CLI 設定已就位，可直接
  `add sidebar`。
- `frontend/components/cost-overview/summary-section.tsx`、
  `period-comparison-section.tsx`、`error-card.tsx`、
  `lib/cost-overview-api.ts`、`lib/use-fetch-once.ts`、`lib/format.ts`：
  SDLCCT-32 既有的資料請求/錯誤呈現/格式化邏輯，本故事**不修改**這些
  檔案的內部行為，只搬動它們被誰（哪個 route 的 page.tsx）渲染。
- 本 repo 目前沒有 `tests/e2e/` 目錄（與 SDLCCT-32/33 設計文件查核結果
  一致，`Glob("**/tests/e2e/**")` 無結果），因此**不存在**任何比較兩個
  元素 computed style 相等的既有測試，跨元素樣式耦合測試檢查不適用。

## 介面/API 契約
無新增、無變更 HTTP 介面。本故事純粹是前端畫面結構重組（加入側欄 +
路由拆分），沿用 SDLCCT-32 已定案的兩個 bff 端點
（`GET /api/cost-overview/summary`、`GET /api/cost-overview/period-
comparison`），呼叫方式、request/response 格式、狀態碼、錯誤呈現方式
全部不變（對應 AC2）。

## 資料模型
無新增資料模型。本故事不碰任何資料表、欄位、索引，也不新增任何
Pydantic/TypeScript 資料結構（側欄導覽項目清單是前端純靜態常數，不是
「資料模型」）。

## 關鍵技術決策

### 1. `--sidebar*` CSS 變數別名對應（AC7 明文要求的修正）
`frontend/app/globals.css` 的 `:root` 區塊中，8 個現存的
`--sidebar*` 變數改為別名指向既有 5 個 `--color-*` token（比照
`--background`/`--primary` 等既有別名寫法），不新增任何獨立色值：

```css
--sidebar: var(--color-bg);
--sidebar-foreground: var(--color-text-primary);
--sidebar-primary: var(--color-accent);
--sidebar-primary-foreground: #ffffff;
--sidebar-accent: var(--color-border);
--sidebar-accent-foreground: var(--color-text-primary);
--sidebar-border: var(--color-border);
--sidebar-ring: var(--color-accent);
```

決策理由（逐項）：
- `--sidebar` → `--color-bg`：側欄背景與頁面/卡片背景一致（白底），
  比照 `docs/design-system.md` 第 7 節「導覽列：背景 `--color-bg`」的
  既定規則，側欄在本故事中扮演的正是「導覽列」角色，直接沿用同一條
  規則，不另創語意。
- `--sidebar-foreground` → `--color-text-primary`：側欄內文字（導覽項
  標籤）與站內其他主要文字一致。
- `--sidebar-primary` → `--color-accent`：側欄中唯一需要「強調」的狀態
  是 current-page indicator（AC3），直接沿用全站唯一的強調色，不新增
  第二種強調色語意。
- `--sidebar-primary-foreground` → `#ffffff`：比照既有
  `--primary-foreground: #ffffff` 的寫法（非 token 但也非新增色值，
  `docs/design-system.md` 本身在定義 `--primary-foreground` 時就是
  直接寫字面值 `#FFFFFF`，不是另開一個 token），保持兩處「強調色配白字」
  的寫法一致。
- `--sidebar-accent` → `--color-border`：此變數在 shadcn sidebar 元件中
  用於「hover / 非當前項目的淺色背景襯底」。5 個既定 token 中，
  `--color-bg`（白）與 `--color-accent`（強調藍，已保留給 current-page
  indicator）都不適合，`--color-text-primary`/`--color-text-secondary`
  是文字色不適合當背景；唯一適合當作「比背景深一點、比強調色淺」的
  中性襯底色是 `--color-border`（`#E5E7EB`，本來就是本規範中唯一的
  「中性結構色」，用於分隔線與卡片外框）。重用它當 hover 背景，與
  AC7「不得新增色彩」的要求一致——不是發明新語意，是讓既有的「中性結構
  色」多一個用途。
- `--sidebar-accent-foreground` → `--color-text-primary`：hover 狀態下
  文字仍是主要文字色，不換色。
- `--sidebar-border` → `--color-border`：側欄本身的外框線，與全站分隔
  線同一個 token，符合「只用邊框表達分隔」的既定規則（design-system
  第 7 節「導覽列」規則）。
- `--sidebar-ring` → `--color-accent`：focus-visible 外框色，與全站
  focus 樣式（`docs/design-system.md` 第 8 節：
  `outline: 2px solid var(--color-accent)`）一致，不新增第二種
  focus 色。

`.dark` 區塊中的對應 8 個 `--sidebar*` 值維持 shadcn 預設不動——本故事
範圍內無任何深色模式 AC，且 `docs/design-system.md` 全文沒有深色模式
章節，改動深色模式色值屬於設計外的額外工作，不在本故事範圍內處理
（AC7 只針對「目前會被實際渲染的淺色模式」提出要求）。

### 2. 元件架構：shadcn sidebar 原語 + App Router layout
使用 `npx shadcn@latest add sidebar`（開發階段執行）產生的標準
`Sidebar`/`SidebarProvider`/`SidebarInset` 組合，掛載在
`frontend/app/layout.tsx`（root layout），而非個別頁面內——這樣所有
路由（Cost Dashboard、Settings/System，未來其他 5 個畫面）共用同一份
側欄，不需要每個 page.tsx 各自重複側欄程式碼。

**預期產生的檔案結構**（shadcn sidebar 元件的標準產出，*開發階段執行
`npx shadcn@latest add sidebar` 時以實際產出為準，若與下列預期不符，
開發者可自行調整檔名/匯出，不視為偏離本設計*）：
- `frontend/components/ui/sidebar.tsx`：單一檔案內匯出
  `SidebarProvider`、`Sidebar`、`SidebarHeader`、`SidebarContent`、
  `SidebarFooter`、`SidebarGroup`、`SidebarGroupLabel`、
  `SidebarGroupContent`、`SidebarMenu`、`SidebarMenuItem`、
  `SidebarMenuButton`、`SidebarInset`、`SidebarTrigger`、
  `useSidebar` 等（shadcn sidebar 元件慣例，具體清單以 CLI 實際產出
  為準）。
- `frontend/hooks/use-mobile.ts`（或 `frontend/lib/use-mobile.ts`，依
  `components.json` 的 `aliases.hooks` 設定）：shadcn sidebar 的響應式
  判斷 hook，隨元件一併產生。
- `frontend/components/ui/separator.tsx`、`skeleton.tsx`、
  `tooltip.tsx`、`sheet.tsx`：shadcn sidebar 元件通常依賴這幾個子元件，
  CLI 會自動一併加入；本故事的側欄視覺不使用 tooltip/sheet 的進階互動
  （見下方「側欄不可收合」決策），但元件檔案本身會被產生，留著不刪，
  避免手動修改 shadcn 產生的程式碼。

新增應用層檔案（本故事實際撰寫的程式碼，非 shadcn CLI 產生）：
- `frontend/components/layout/app-sidebar.tsx`：定義 4 組 9 項導覽資料
  （純靜態陣列常數，非 props 傳入），用 `usePathname()`
  （`next/navigation`）取得目前路徑，渲染側欄本體。
- `frontend/app/layout.tsx`：改為
  `<SidebarProvider><AppSidebar /><SidebarInset>{children}</SidebarInset></SidebarProvider>`
  的結構（取代目前單純的 `<body>{children}</body>`）。

**側欄不可收合（`collapsible="none"`）**：shadcn `Sidebar` 元件預設支援
icon/offcanvas 收合模式；本故事明確將 `collapsible` 設為 `"none"`
（固定展開，不渲染收合按鈕/`SidebarTrigger`）。理由：規格明文把「側欄
收合展開等進階互動」列為範圍外，除非 G1b 原型判斷必要；本原型要呈現
的是「4 組 9 項的完整結構」與「包裝後的 Cost Dashboard」，固定展開比
收合互動更直接地滿足這個審核目的，且避免引入本故事未被要求驗證的互動
狀態（收合時的 icon-only 樣式、`SidebarTrigger` 的 focus/hover 樣式等）。

### 3. 路由結構：Cost Dashboard 搬到 `/cost-dashboard`，`/` 導向它
**決策**：新增 `frontend/app/cost-dashboard/page.tsx`，把現有
`frontend/app/page.tsx` 的內容（`CostOverviewPage` 元件本體，含兩個
`<section>`、`SummarySection`、`PeriodComparisonSection`、錨點日期顯示）
原樣搬移過去；原 `frontend/app/page.tsx` 改為一個只做
`redirect("/cost-dashboard")`（`next/navigation` 的 server-side
`redirect`）的極簡頁面。

理由：
- 側欄的「目前畫面標示」（AC3）用 `usePathname()` 比對每個導覽項的
  `href`。若 Cost Dashboard 不給自己一個具名路徑、仍掛在 `/`，則
  Settings/System（`/settings/system`）會有具名路徑而 Cost Dashboard
  沒有，兩個「有功能」的導覽項在路由語意上不對稱，未來新增其他 5 個
  畫面時也沒有一致的命名可循。
- 給 Cost Dashboard 一個具名路徑後，「目前在哪個畫面」這件事對使用者
  與對程式碼都更明確（網址列會顯示 `/cost-dashboard`，不是模糊的根
  路徑）。
- `/` 保留為重導向（而非直接刪除），確保舊的書籤/直接開啟根網址仍能
  到達儀表板，不產生 404。
- 這是本故事範圍內「如何安排側欄所需的路由」的技術細節決定，不是在
  設計未來 5 個畫面的路由（那些畫面的路由留給各自的故事決定，不預先
  命名 `/governance/agent-registry` 等路徑）。
- 搬移過程**不修改** `SummarySection`/`PeriodComparisonSection`/
  `cost-overview-api.ts`/`use-fetch-once.ts` 的任何程式碼，只搬動
  「誰 import 誰」，確保 AC2「兩個既有 API 呼叫行為/錯誤呈現方式完全
  不變」。

### 4. 七個無功能項目的渲染方式：與可用項目相同的 `SidebarMenuButton`，但不給 `href`/`onClick`
**決策**：9 個導覽項全部用同一個 `SidebarMenuButton` 元件渲染（同一套
CSS class，無任何條件式的「disabled 變體」）。差異只在於資料層：
- Cost Dashboard、Settings/System 兩項：`SidebarMenuButton asChild`
  包一層 Next.js `<Link href={...}>`。
- 其餘 7 項：`SidebarMenuButton` **不加 `asChild`，不包 `<Link>`，不給
  `href`，不給 `onClick`**，直接渲染為一個普通的
  `<button type="button">`（`SidebarMenuButton` 元件未給 `asChild` 時
  的預設渲染結果）。

理由：
- 「同一個元件、同一套 class，只是沒有點擊行為」是視覺樣式與可用項目
  100% 一致（AC5）最直接的做法——不是另外寫一套「看起來像按鈕但加
  `opacity`/`pointer-events: none`」的樣式分支，從根本上避免兩套樣式
  分叉維護的風險，也不需要額外的視覺迴歸測試去驗證「兩者看起來一樣」。
- `<button type="button">` 沒有 `onClick`，點擊後瀏覽器原生行為就是
  什麼都不做：不導向（不是 `<a>`，沒有 `href` 可跳轉）、不彈出任何
  內容、不噴 console 錯誤（沒有任何事件處理器會執行，也沒有無效的
  `href="#"` 導致的 hash 導覽副作用）——直接滿足 AC4，不需要寫
  `onClick={(e) => e.preventDefault()}` 這種「先給事件再擋掉」的寫法
  （那種寫法要維護一個空的 handler，且 `preventDefault` 隱含「原本會
  發生什麼事」的心智負擔，不如一開始就不給任何可觸發行為）。
- 不使用 `disabled` 屬性：`disabled` 會觸發瀏覽器原生的視覺弱化
  （灰階/不可選取）與 `cursor: not-allowed`，且 CVA 的 `buttonVariants`
  本身就有 `disabled:pointer-events-none disabled:opacity-50` 規則
  （`frontend/components/ui/button.tsx` 第 6 行），shadcn
  `SidebarMenuButton` 很可能繼承類似的 disabled 樣式——用 `disabled`
  會直接違反 AC5「不呈現 disabled 外觀」，所以必須是「普通、未加
  `disabled` 屬性的 button」，而不是「disabled 的 button」。
- 不加任何「規劃中」文字/徽章：逐字對應規格已定案的決定（「點擊沒有
  反應」段落），不是本設計自行選擇。

### 5. Current-page indicator：`usePathname()` 比對 `href`
`AppSidebar` 用 `usePathname()`（`next/navigation`，需 Client
Component，故 `app-sidebar.tsx` 頂部加 `"use client"`）取得目前路徑，
對 9 個導覽項資料中「有 `href`」的兩項（Cost Dashboard →
`/cost-dashboard`、Settings/System → `/settings/system`）各自比較
`pathname === item.href`，相等時把 `isActive` prop 傳給
`SidebarMenuButton`（shadcn sidebar 元件標準支援的 prop，套用
`--sidebar-primary`/`--sidebar-primary-foreground` 的強調樣式）。其餘
7 個無 `href` 的項目資料結構中直接不含 `href` 欄位，`isActive`
永遠不會為真（沒有對應路徑可比對），因此永遠不會被誤標示為「目前
畫面」——不需要額外的 if/else 分支特別排除它們。

### 6. Settings/System：字面意義上的空白頁面
`frontend/app/settings/system/page.tsx` 只回傳一個空的容器（例如
`<div />` 或完全不含文字內容的最小 JSX），不加標題、不加任何說明文字。
理由：規格逐字寫「只需導覽項目與一個空白頁面」，沒有要求任何頁面標題
或佔位文字；比照 CONSTITUTION「規格模糊時不要過度設計」與「implement
only what the spec requires」，不額外發明內容（即使只是一個 `<h1>`
「系統」標題，規格也沒要求）。此頁面仍會被包在同一個 `SidebarInset`
佈局內，所以側欄本身仍會顯示在這個空白頁面上，只有 `<main>` 內容是空的。

### 7. 導覽資料是純靜態常數，不做成可設定/可擴充的通用側欄框架
`app-sidebar.tsx` 內直接寫死 4 組 9 項的陣列（label、href?、group），
不額外設計一套「從 CMS/設定檔讀側欄結構」的通用機制。理由：規格明文
把「其餘 5 個畫面的實際內容」列為範圍外，但側欄結構本身（9 個項目的
存在與分組）是本故事的 AC1，必須在本故事就定案且是具體、固定的內容，
不是留白等未來擴充——比照 CONSTITUTION「scope discipline：implement
only what the spec requires」，不為「未來可能還會加項目」預先設計
抽象層。

## UI 原型
`docs/design/SDLCCT-34-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，內嵌 `<style>`，套用 `docs/design-system.md` 定稿的實際色彩/
字級/間距/元件 token，且側欄配色使用本文件「關鍵技術決策 1」訂定的
修正後 `--sidebar*` 對應值，不是 shadcn 預設灰階 oklch）。涵蓋：
- 完整側欄：Overview/Governance/Action/Settings 四組、9 個項目，
  zh-TW 標籤逐字照抄規格。
- Cost Dashboard 包裝在側欄佈局內，沿用 SDLCCT-32 原型的卡片群組/
  期間比較排行版面（示意資料，非真實查詢結果），並標示為「目前畫面」
  （current-page indicator 樣式示範）。
- 七個無功能項目與可用項目視覺樣式完全一致（同一套 class），僅用
  HTML comment 註記「此項目點擊無反應（設計決策，非遺漏）」供審核者
  辨識，不在畫面上呈現任何視覺差異或文字標記。
- Settings/System 的空白頁面狀態（側欄仍顯示，主內容區域為空）。

## 開放設計問題（定稿時必須為空）
（無）
