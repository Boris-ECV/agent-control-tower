# 設計文件 — SDLCCT-64 Drill-down 到詳情頁後缺少返回上一層列表的方式

## 對應需求規格

對應 G1 已核准的需求規格（標題：「Drill-down 到詳情頁後缺少返回上一層
列表的方式」）。User Story：使用 Portal 的使用者希望在 Agent 詳情頁
（`/agents/{key}`）與執行詳情頁（`/agents/{key}/traces/{traceId}`）上有
可操作的返回元件，不需依賴瀏覽器上一頁或重新點側欄。3 條 AC：
(1) Agent 詳情頁的返回元件導向 Agent 清單頁 `/agents`；
(2) 執行詳情頁的返回元件導向**該筆 trace 所屬的** Agent 詳情頁
`/agents/{key}`，而不是 Agent 清單頁；
(3) 返回元件在 loading/error 狀態下仍可用，不受資料請求成敗影響。

**範圍外**（spec 已標明）：具體 UI 樣式（麵包屑 vs 返回按鈕）留給本設
計/開發者判斷；異常頁返回路徑不建；Agent 清單頁本身不適用；不保留
滾動/篩選/分頁狀態；不變更瀏覽器原生上一頁行為。

**依賴**：無新增依賴（SDLCCT-48、SDLCCT-55/56 已完成並合併）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/agent-detail-content.tsx`：
  `<header className="... justify-end ...">` 目前只有一個子元素（日期
  `<span>`），且這個 `<header>` 是在 `useFetchOnce` 三態判斷**之外**
  無條件渲染的（loading/error/success 三個分支都在 `<main>` 內，不影響
  `<header>`）——這點是 AC3「返回元件在 loading/error 下仍可用」的直接
  依據：只要返回元件放進這個無條件渲染的 `<header>`，就自動滿足 AC3，
  不需要額外為返回元件寫第二套條件判斷。`key` 來自
  `useParams<{ key: string }>()`，在元件掛載瞬間即可取得，不依賴
  `fetchAgentCostBreakdown()` 的回應。
- `frontend/components/trace-detail/trace-detail-content.tsx`：
  `<header className="... justify-between ...">` 目前是空的（SDLCCT-68
  移除重複標題後沒有填回任何內容）。同樣在三態判斷之外無條件渲染。
  `key`/`traceId` 皆來自 `useParams<{ key: string; traceId: string }>()`，
  `key` 同樣在元件掛載瞬間即可取得，**不需要等待** `fetchTraceSpans()`
  成功才能算出返回目標 `/agents/{key}`——這是 AC2「返回所屬 Agent 詳情
  頁而非清單頁」能在 loading/error 狀態下也正確運作（AC3）的關鍵：目標
  路徑是從路由參數算出來的，不是從回應資料算出來的。
- `frontend/lib/i18n/messages.ts`：既有 `agentDetail`/`traceDetail`
  命名空間（純附加慣例，SDLCCT-48/56 已確立），`agents.header.title`
  現有字串 `"Agent 清單"` 可重複使用其語意，但本設計選擇在
  `agentDetail`/`traceDetail` 命名空間下各自新增一個返回專用 key（見
  決策 2），不是直接 import 跨命名空間的既有 key。
- `frontend/package.json`：確認沒有任何 icon 函式庫（`lucide-react` 等）
  依賴，與 SDLCCT-48 現狀查核「零圖表/圖示依賴」結論一致——本設計延續
  SDLCCT-48 決策 3「手刻 inline SVG，不為此新增依賴」慣例（spec 本身也
  明文「無新增依賴」）。
- `docs/design-system.md` §7「元件規則．連結」：顏色
  `--color-accent`、預設不加底線、`:hover` 加底線、`:focus-visible`
  套用 §8 統一 focus 樣式（`outline: 2px solid var(--color-accent);
  outline-offset: 2px;`）——返回元件本質是頁面間導覽，依此規則判定為
  **連結**而非按鈕語意（見決策 1）。
- `frontend/e2e/agent-detail.spec.ts`/`trace-detail.spec.ts`：現有測試
  對 `<header>` 的斷言只檢查「不再出現『Agent Control Tower』文字」
  （SDLCCT-68）與 trace 列點擊導覽，兩者都不會與新增的返回連結文字/
  `href` 衝突。
- 全 repo `Grep("toEqual|getComputedStyle|一致")` 只命中
  `frontend/e2e/trace-detail.spec.ts`（span-tree 父子列的
  `paddingLeft` 大小比較，與本票改動的 `<header>` 元素無關，不構成跨
  元素樣式耦合測試鏈）與 `frontend/AGENTS.md`（文件說明文字，非測試）。
  本票新增/修改的 `<header>` 內容不會觸發任何既有跨元素樣式耦合測試。

## 介面/API 契約

無。本票純前端路由導覽變更，不新增/呼叫任何新的 bff 端點，也不變更既
有端點的 request/response 格式。導覽目標路徑：

- Agent 詳情頁返回元件：導向 `/agents`（既有清單頁路由，AC1）。
- 執行詳情頁返回元件：導向 `` `/agents/${key}` `` ，`key` 取自該頁
  `useParams<{ key: string; traceId: string }>()` 已有的 `key` 值
  （AC2；不是導向 `/agents`，且不需要任何新的查詢參數或後端呼叫才能
  算出這個值）。

## 資料模型

無新增資料模型。

## 關鍵技術決策

### 1. 返回元件是 Next.js `<Link>`（錨點語意），不是 `<button>` + `router.push`

返回元件的本質是「導覽到另一個頁面」，不是觸發一個動作（無副作用、無
表單提交），依 `docs/design-system.md` §7「連結」規則定性為連結而非按
鈕——這與 SDLCCT-48 決策裡「`AgentCardList` 用 `<Link>` 包裹」的理由
一致：只有在合法 HTML 結構不允許 `<a>`（如 `<tr>`）時才改用
`role="link"` + 手刻鍵盤處理（如 SDLCCT-48 的 `AgentTable`）；這裡的返
回元件沒有這種結構限制，優先用語意正確、原生支援瀏覽器「開新分頁」
等標準行為的 `<a>`/`<Link>`。

### 2. 返回元件放進既有的無條件渲染 `<header>`，不新增條件判斷來滿足 AC3

兩個頁面的 `<header>` 都已經在 `useFetchOnce` 三態（loading/error/
success）判斷**之外**無條件渲染（見現狀查核）。把返回元件放進
`<header>`，而不是放進 `<main>` 內某個三態分支，讓 AC3「loading/error
狀態下仍可用」自動成立，不需要額外在每個分支重複渲染一份返回元件（避
免三處重複程式碼，也避免某個分支漏寫返回元件的風險）。

### 3. 執行詳情頁的返回目標從 `useParams().key` 算出，不等待 `fetchTraceSpans()` 回應

AC2 要求返回「該筆 trace 所屬的 Agent 詳情頁」，AC3 要求這件事在
loading/error 時也成立。`key` 是路由參數，在元件掛載瞬間就可用，與
`fetchTraceSpans()` 的成敗無關；若改用回應資料中的某個欄位算目標路
徑，AC3 會被迫為錯誤分支另外設計 fallback（且目前
`TraceSpansResponse` 本身也沒有比路由參數更可靠的來源）。因此直接用
路由參數是唯一不需要額外假設的作法。

### 4. 新增共用元件 `frontend/components/common/back-link.tsx`，不在兩個 content 檔案內各自手刻一份

兩個頁面的返回元件除了 `href`/文案不同外，視覺樣式（icon + 文字、
focus-visible、hover 底線）完全相同。抽成一個小型共用元件比照
CONSTITUTION「三行重複優於過早抽象」的反向情境——這裡不是三行簡單
JSX，而是「icon SVG path + 鍵盤事件處理 + 一致的 focus 樣式」一組邏
輯，兩處重複會有維護風險（例如 focus 樣式之後要調整，容易漏改一處）；
抽成共用元件比兩份幾乎相同但分開維護的 JSX 更合適。`frontend/
components/common/` 是本 repo 第一個「跨畫面共用、非特定頁面」元件目
錄（既有 `components/ui`/`cost-overview`/`agent-detail`/`trace-detail`
/`anomalies`/`layout` 皆是 shadcn 產物或單一頁面私有元件），本票是第
一個需要「兩個不同頁面共用同一個小元件」的情境，比照既有「依頁面/用
途命名子目錄」慣例新增此目錄，不塞進任何既有頁面私有目錄。

介面（developer 可直接依此實作，不需另外發明）：

```tsx
// frontend/components/common/back-link.tsx
"use client";

import Link from "next/link";
import type { KeyboardEvent } from "react";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-sm leading-[22px] text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => {
        // Enter 是 <a> 原生行為；Space 預設不會觸發錨點導覽（只有
        // <button> 原生響應 Space），AC 明文要求 Enter/Space 都要可
        // 用，故補上這一段處理（比照 SDLCCT-48 決策 「AgentTable」
        // role="link" 的 onKeyDown 寫法，套用在這裡的 <a> 上）。
        if (e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 flex-none fill-current">
        <path d="M9.78 2.22a.75.75 0 0 1 0 1.06L5.06 8l4.72 4.72a.75.75 0 1 1-1.06 1.06L3.47 8.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" />
      </svg>
      <span>{label}</span>
    </Link>
  );
}
```

### 5. 兩個頁面的套用方式

- `frontend/components/agent-detail/agent-detail-content.tsx`：
  `<header>` 的 `justify-end` 改為 `justify-between`，新增
  `<BackLink href="/agents" label={t("agentDetail.header.backToList")} />`
  作為第一個子元素，日期 `<span>` 維持在右側不變（AC1）。
  ```tsx
  <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-3">
    <BackLink href="/agents" label={t("agentDetail.header.backToList")} />
    <span className="text-xs leading-[18px] text-text-secondary">
      {state.status === "success" ? formatTaiwanDate(state.data.anchor_date) : t("costOverview.header.unavailable")}
    </span>
  </header>
  ```
- `frontend/components/trace-detail/trace-detail-content.tsx`：
  `<header>` 維持 `justify-between`，在原本空的 `<header>` 內新增
  `<BackLink href={`/agents/${key}`} label={t("traceDetail.header.backToAgent")} />`
  （AC2；`key` 已在檔案頂部由 `useParams()` 解構出來，直接使用，不需
  要等待 fetch 狀態）。
  ```tsx
  <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-3">
    <BackLink href={`/agents/${key}`} label={t("traceDetail.header.backToAgent")} />
  </header>
  ```

### 6. i18n：新增兩個命名空間內的 key，不重用 `agents.header.title`

雖然 `agents.header.title`（"Agent 清單"）語意上可以重複使用，但本設
計選擇在 `agentDetail`/`traceDetail` 命名空間各自新增一個返回專屬
key，理由：返回元件的文案是「這個頁面的返回動作」的描述，語意上屬於
這個頁面自己的文案集合，不應該跨命名空間相依到 `agents` 頁面的標題字
串（若未來 `agents.header.title` 因該頁自己的理由改字，不應該連帶影
響這裡的返回文案，兩者目前文字恰好相同只是巧合，不是語意上同一件
事）。新增 key（純附加，不更動既有內容）：

- `agentDetail.header.backToList`："返回 Agent 清單"
- `traceDetail.header.backToAgent`："返回 Agent 明細"

### 7. 新增/修改 e2e

- `frontend/e2e/agent-detail.spec.ts`：新增一條測試，驗證 (a) `<header>`
  內可見返回連結且 `href="/agents"`；(b) 點擊後 URL 變為 `/agents`
  （AC1）；(c) 以鍵盤 Tab 聚焦該連結後按 Enter 與（另一個 test case）
  按 Space 皆能觸發同一導覽（AC 明文要求兩種鍵）；(d) mock 回應為
  404/502（既有 error 測試情境）時，返回連結仍可見且可點擊，點擊後仍
  能導覽到 `/agents`（AC3）。
- `frontend/e2e/trace-detail.spec.ts`：新增一條測試，驗證 (a) 直接造訪
  `/agents/{MOCK_KEY}/traces/{MOCK_TRACE_ID}` 後 `<header>` 內返回連結
  `href="/agents/${MOCK_KEY}"`（**不是** `/agents`，AC2）；(b) 點擊後
  URL 變為 `/agents/${MOCK_KEY}`；(c) 將 `/traces/.../spans` 的 mock
  route 改為 pending（不 `fulfill`，模擬 loading）或改為回傳
  4xx/5xx（模擬 error）後，返回連結仍可見且可點擊、仍導覽到正確路徑
  （AC3）。

## UI 原型

本票讓使用者第一次在這兩個頁面上看到一個新的可視覺互動元素（返回連
結），依 `templates/design-spec.md`「此 Story 涉及前端畫面新增或變更」
的判定條件，附上 `docs/design/SDLCCT-64-prototype.html`（可直接在瀏
覽器開啟，內嵌 `<style>`，套用與 `docs/design-system.md` 一致的色彩/
字級/間距 token）。涵蓋：

- Agent 詳情頁頭部範例：左側返回連結「← 返回 Agent 清單」+ 右側日期
  文字（沿用既有 `justify-between` 版面），連結 hover 時顯示底線、
  focus 時顯示 `outline` 樣式範例（以靜態 `:focus`/`:hover` CSS class
  示範，不需要真的可點擊導覽）。
- 執行詳情頁頭部範例：左側返回連結「← 返回 Agent 明細」，右側空白
  （與現狀一致）。
- 一段註記文字說明：兩個連結在 loading/error 狀態下視覺上完全相同不
  受影響（因為放在無條件渲染的 `<header>` 內，見決策 2），原型本身不
  需要另外示範 loading/error 版面（那不是本票新增的畫面，是既有
  `<main>` 內已存在的狀態，本票沒有改動）。

## 開放設計問題（定稿時必須為空）

（無）
