# 設計文件 — SDLCCT-96 Agent 詳情與執行詳情頁側邊選單維持「Agent 清單」反白

## 對應需求規格

對應 G1 已核准的需求規格，3 條情境（已定稿）：

1. Agent 詳情：使用者在 Agent 詳情頁 -> 側邊選單「Agent 清單」反白。
2. 執行詳情：使用者在 trace／執行詳情頁 -> 側邊選單「Agent 清單」反白。
3. 其他頁：使用者在成本儀表板 -> 「Agent 清單」**不**反白。

**範圍外**：麵包屑（SDLCCT-97）；不得更動選單項目與順序。無相依。規格無開放問題。

## 現狀查核（實作前已逐字讀取）

### 路由結構（`frontend/app/**/page.tsx`）

| 路徑 | 檔案 | 對應選單項目 |
|------|------|--------------|
| `/` | `app/page.tsx:3-5`（`redirect("/cost-dashboard")`，不會停留在 `/`） | 無 |
| `/cost-dashboard` | `app/cost-dashboard/page.tsx` | 成本儀表板 |
| `/agents` | `app/agents/page.tsx` | Agent 清單 |
| `/agents/[key]` | `app/agents/[key]/page.tsx`（Agent 詳情） | 目前無（本票：Agent 清單） |
| `/agents/[key]/traces/[traceId]` | `app/agents/[key]/traces/[traceId]/page.tsx`（執行詳情） | 目前無（本票：Agent 清單） |
| `/anomalies` | `app/anomalies/page.tsx` | 異常與告警 |
| `/settings/system` | `app/settings/system/page.tsx` | System |

e2e 實際使用的詳情路徑：`/agents/sales-copilot`、`/agents/sales-copilot/traces/trc_123`（`e2e/trace-detail.spec.ts:3-4、34、76`）。

### 側邊欄現況

- `components/layout/app-sidebar.tsx:60` `const pathname = usePathname();`（來自 `next/navigation`，第 4 行；回傳不含 query／hash 的路徑）。
- `app-sidebar.tsx:34-57` 的 `NAV_GROUPS`，**有 href 的僅 4 項**：`/cost-dashboard`（第 37 行）、`/agents`（第 42 行）、`/anomalies`（第 43 行）、`/settings/system`（第 55 行）；其餘 5 項無 href，永遠不 active。
- `app-sidebar.tsx:78-81`：`<SidebarMenuButton render={<Link href={item.href} />} isActive={pathname === item.href}>` —— 精確比對是本票問題的根源。
- 沒有任何選單項目的 href 是 `/`，也沒有 href 是另一項的前綴（`/agents`、`/anomalies`、`/cost-dashboard`、`/settings/system` 彼此不相交），故前綴比對在現有選單中只有 `/agents` 會多命中 `/agents/[key]` 與 `/agents/[key]/traces/[traceId]`，正好是規格要的。
- shadcn：`components/ui/sidebar.tsx:522-527` 把 `isActive` 轉為 render state `active`，產生 `data-active` 屬性（true 時為空字串屬性、false 時不存在；樣式 `sidebar.tsx:478` 的 `data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground`）。token 見 `app/globals.css:107-108`：`--sidebar-accent` = `--color-border` = `#e5e7eb`，`--sidebar-accent-foreground` = `#1f2937`。
- **`aria-current`**：shadcn 元件與 `Link` 皆不設定；全 `frontend/`（排除 node_modules）Grep `aria-current` 沒有任何出現。本票**不新增** aria-current（維持現狀的 a11y，見決策 4）。
- 同一個 `AppSidebar` 同時負責桌面與手機：`sidebar.tsx:182-203` 在 `isMobile`（`useIsMobile()`）時改以 `SheetContent`（`data-mobile="true"`）渲染相同 children，手機的觸發鈕在 `app/layout.tsx:37-39`（`md:hidden`）。故一處修改兩者同時生效，Sheet 僅在開啟時才掛載內容。
- 根 layout `app/layout.tsx:33-35` 已用 `<Suspense>` 包住 `AppSidebar`（`usePathname` 與動態路由段所需），不需動。

### 既有測試盤點

- vitest：`components/layout/` 下**沒有**任何側邊欄單元測試；Grep `sidebar|Sidebar|側邊` 於 `*.test.tsx` 無結果。
- e2e 對 active 的斷言只有兩處，且**都仍成立、不需改斷言**：
  - `e2e/agents.spec.ts:31-53`：`/cost-dashboard` -> Agent 清單無 `data-active`、成本儀表板有；點擊後到 `/agents`，反向成立。
  - `e2e/anomalies.spec.ts:~37-48`：同型態（異常與告警 vs 成本儀表板）。
- 唯一過時的是**註解**：`e2e/agents.spec.ts:38-42` 寫「`usePathname() === item.href`」，實作後不再正確，需同步改為「由 `isNavItemActive(pathname, href)` 推導」。（`anomalies.spec.ts:39-41` 註解為「isActive is true; when false the…」，不含比對式，不需改。）
- 跨元素 computed style 耦合檢查：Grep `getComputedStyle`／`toEqual(reference…)`／「一致」於 `e2e/`，僅 `trace-detail.spec.ts:95-98`（父子列 paddingLeft）與 `agent-detail.spec.ts` 的 `pointerEvents`，與側邊欄選擇器無關；本設計**不改任何樣式／class**（只改 `isActive` 的布林來源），不會打斷任何耦合測試。

## 介面/API 契約

無 bff 端點、request／response 異動。前端新增一個純函式並替換一處呼叫。

新檔 `frontend/lib/nav.ts`：

```ts
/**
 * 判斷側邊選單項目是否為目前頁面（含其子路徑）。
 * - pathname 為 usePathname() 的值（不含 query／hash）；仍防禦性剝除 `?`／`#` 之後的字元。
 * - 尾端斜線視同無斜線（根路徑 "/" 除外）。
 * - href 為 "/"：僅 pathname 正規化後恰為 "/" 時 active（根項目不得吃掉所有頁面）。
 * - 其他 href：pathname === href，或 pathname 以 `${href}/` 開頭（段邊界比對）。
 * - pathname 為 null／空字串 -> false。
 */
export function isNavItemActive(pathname: string | null, href: string): boolean;
```

實作草案（developer 可依此，行為以真值表為準）：

```ts
function normalize(p: string): string {
  const base = p.split(/[?#]/, 1)[0];
  return base.length > 1 ? base.replace(/\/+$/, "") || "/" : base;
}
export function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const p = normalize(pathname);
  const h = normalize(href);
  if (h === "/") return p === "/";
  return p === h || p.startsWith(`${h}/`);
}
```

`app-sidebar.tsx:80` 改為 `isActive={isNavItemActive(pathname, item.href)}`，並新增 `import { isNavItemActive } from "@/lib/nav";`。更新第 20-23 行註解中「永遠不會被 usePathname() 比對為 isActive」維持有效（無 href 項目不呼叫 helper），不需改字；`NAV_GROUPS`、項目順序、標籤、其他 class 一概不動。

### 真值表（`lib/nav.test.ts` 逐列斷言）

| # | pathname | href | 結果 | 說明 |
|---|----------|------|------|------|
| 1 | `/agents` | `/agents` | true | 精確 |
| 2 | `/agents/sales-copilot` | `/agents` | true | 情境 1：Agent 詳情 |
| 3 | `/agents/sales-copilot/traces/trc_123` | `/agents` | true | 情境 2：執行詳情 |
| 4 | `/agents/` | `/agents` | true | 尾端斜線 |
| 5 | `/agents/sales-copilot/` | `/agents` | true | 子路徑尾端斜線 |
| 6 | `/agents?tab=cost` | `/agents` | true | query 被剝除（防禦） |
| 7 | `/agents/sales-copilot?x=1#top` | `/agents` | true | query+hash 被剝除 |
| 8 | `/agents-foo` | `/agents` | false | 段邊界：不得前綴誤判 |
| 9 | `/agentsfoo/bar` | `/agents` | false | 同上 |
| 10 | `/agent` | `/agents` | false | 較短路徑 |
| 11 | `/` | `/agents` | false | 根頁面 |
| 12 | `/cost-dashboard` | `/agents` | false | 情境 3：其他頁 |
| 13 | `/anomalies` | `/agents` | false | 其他頁 |
| 14 | `/settings/system` | `/agents` | false | 其他頁 |
| 15 | `/cost-dashboard` | `/cost-dashboard` | true | 精確 |
| 16 | `/cost-dashboard` | `/anomalies` | false | 互斥 |
| 17 | `/anomalies` | `/anomalies` | true | 精確 |
| 18 | `/anomalies/` | `/anomalies` | true | 尾端斜線 |
| 19 | `/anomalies-2` | `/anomalies` | false | 段邊界 |
| 20 | `/settings/system` | `/settings/system` | true | 多段 href 精確 |
| 21 | `/settings/system/` | `/settings/system` | true | 尾端斜線 |
| 22 | `/settings` | `/settings/system` | false | 父路徑不 active 子項 |
| 23 | `/settings/system-x` | `/settings/system` | false | 段邊界 |
| 24 | `/` | `/` | true | 根項目精確 |
| 25 | `/agents` | `/` | false | 根項目不吃所有頁面 |
| 26 | `/cost-dashboard` | `/` | false | 同上 |
| 27 | `""`／`null` | `/agents` | false | 無 pathname |

（目前選單沒有 `/` 項目，第 24-26 列是保證 helper 本身對未來項目安全，不是新增選單。）

## 資料模型

無新增資料模型（無 table、欄位、索引、state、props）。

## 關鍵技術決策

1. **精確相等 OR `${href}/` 前綴（段邊界比對）**：`/agents-foo` 不得命中 `/agents`；`startsWith(href)` 不加斜線會誤判。
2. **根項目 `/` 只做精確比對**：每個路徑都以 `/` 開頭，根項目若走前綴比對會讓所有頁面反白；以明確分支鎖死（目前選單無根項目，屬防禦）。
3. **helper 放 `lib/nav.ts`、純函式**：可獨立單元測試真值表，無需 mock `usePathname`／渲染 sidebar；與 `lib/format.ts` 同層。
4. **不新增 `aria-current="page"`**：shadcn 與 `Link` 現況皆未設定，規格要求「a11y 不變」且範圍僅是反白；詳情頁上「Agent 清單」連結若標 `aria-current="page"` 會與頁面實際（子頁）語意不符，可日後與麵包屑（SDLCCT-97）一併考慮，不在本票。反白仍只靠 `data-active`（視覺）。
5. **所有 href 項目一律走同一規則**（不只 Agent 清單）：規格情境 3 只要求成本儀表板不反白；通用規則對現有 4 個互斥 href 結果等同精確比對（除 `/agents` 子頁外），比對單一硬編碼特例更簡單，且結果與規格一致。
6. **不改 Link 的 `href`、不改點擊行為**：在 `/agents/[key]` 點「Agent 清單」仍導向 `/agents`（Next 一般連結行為），反白不影響導覽。

### 390px／手機

側邊欄在 `<768px`（`useIsMobile()`）收合為 Sheet，由 `layout.tsx:37-39` 的 `SidebarTrigger` 開啟；Sheet 內為同一份 `AppSidebar` children，active 規則自動一致。390px 版面不受影響（未改任何 class／尺寸）；須測試開啟 Sheet 後「Agent 清單」在詳情頁仍有 `data-active`。

## 測試策略

**既有測試異動**：無斷言需改。僅 `e2e/agents.spec.ts:38-42` 的**註解**同步更新（`usePathname() === item.href` -> 由 `isNavItemActive` 推導）。

**新增單元測試（vitest）**
- `frontend/lib/nav.test.ts`：上列真值表 27 列逐列斷言（可用 `it.each`）。
- `frontend/components/layout/app-sidebar.test.tsx`（新檔）：`vi.mock("next/navigation", () => ({ usePathname: vi.fn() }))`（沿用 `components/agent-detail/cost-tables.test.tsx:9` 的 mock 作法），以 `SidebarProvider` 包住渲染（必要時 stub `window.matchMedia`，因 `useIsMobile`）；斷言 `/agents/sales-copilot` 與 `/agents/sales-copilot/traces/trc_123` 時「Agent 清單」連結有 `data-active`、其他連結無；`/cost-dashboard` 時「Agent 清單」無 `data-active` 而「成本儀表板」有；`/agents` 時仍有（回歸）。

**新增 e2e（Playwright）** 新檔 `frontend/e2e/sidebar-active.spec.ts`（桌面預設視窗）：
- Agent 詳情：mock `**/api/agents/sales-copilot/cost-breakdown`（沿用 `trace-detail.spec.ts:9-25` 形狀）-> `goto("/agents/sales-copilot")` -> `getByRole("link", { name: "Agent 清單" })` `toHaveAttribute("data-active")`，「成本儀表板」`not.toHaveAttribute("data-active")`。
- 執行詳情：mock `**/api/agents/sales-copilot/traces/trc_123/spans`（`spans: []`，沿用 `trace-detail.spec.ts:26-32`）-> `goto("/agents/sales-copilot/traces/trc_123")` -> 同上。
- 其他頁：`goto("/cost-dashboard")`、`goto("/anomalies")`、`goto("/settings/system")` 各自「Agent 清單」`not.toHaveAttribute("data-active")`。
- 導覽路徑：自 `/agents/sales-copilot` 點側邊「Agent 清單」-> `toHaveURL(/\/agents$/)` 且仍 active。
- 手機（`test.use({ viewport: { width: 390, height: 844 } })`）：`goto` 詳情頁 -> 點 `SidebarTrigger`（`button` 名稱依 `sidebar.tsx` SidebarTrigger 的 sr-only 文字，developer 以實際 DOM 為準）-> Sheet（`[data-mobile="true"]`）內「Agent 清單」有 `data-active`。

**執行**：一律 `cd frontend && NEXT_PUBLIC_BFF_URL=http://localhost:8000 CI=1 npx playwright test --workers=1`，一次只跑一份。
**驗收**：`pytest -q`、`npm run test`（vitest 全套）、lint／型別檢查、e2e 全套皆實際執行並通過；不得以「只改前端」為由略過任一側。

## UI 原型

見 `docs/design/SDLCCT-96-prototype.html`（靜態、離線可開，真實 token：`--color-bg #ffffff`、`--color-text-primary #1f2937`、`--color-text-secondary #4b5563`、`--color-border #e5e7eb`、`--color-accent #2563eb`，active 樣式 = `--sidebar-accent #e5e7eb` 底 + `font-medium`）。內容：Agent 詳情頁、執行詳情頁、成本儀表板三種頁面的側邊欄改前／改後對照，以及 390px 手機 Sheet 開啟狀態。

## 開放設計問題(定稿時必須為空)

（無。規格對三條情境的答案明確，並採保守讀法：僅讓 `/agents` 子路徑反白「Agent 清單」，不新增 aria-current、不動選單項目與順序、不為其他項目另設父子規則——因現有 4 個 href 彼此互斥，通用段邊界規則對其餘頁面行為等同現狀。）
