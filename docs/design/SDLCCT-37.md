# 設計文件 — SDLCCT-37 Portal UI 字串 i18n 架構（僅 zh-TW）

## 對應需求規格
對應 G1 已核准的需求規格：`app-sidebar.tsx`、`cost-dashboard/page.tsx`、
`summary-section.tsx`、`period-comparison-section.tsx`、`error-card.tsx`
五個檔案內目前寫死的繁體中文字串，全部改為透過一個集中管理的 i18n 機制
（zh-TW only，不做語言切換）讀取；重複文字共用同一個 key；改動前後
`/cost-dashboard` 的可見文字/版面/互動行為逐字相同，並以 Playwright e2e
佐證；`frontend/AGENTS.md` 記載未來新畫面可遵循的 key 命名慣例；
`settings/system/page.tsx` 空骨架不受影響。

## 介面/API 契約
不適用。本票不新增/變更任何對外 API 端點或 request/response 格式，只新增
前端內部的訊息目錄模組與一個讀取用的 `t()` 函式。

## 資料模型
不適用。本票不涉及任何資料表、欄位或索引變更。

## 現狀盤點：跨元素樣式一致性測試（依流程步驟 4 檢查）
已對 `frontend/` 全目錄搜尋 `toEqual`/`getComputedStyle`/「一致」等跨元素
computed-style 比較斷言，以及 `frontend/e2e/`、`tests/e2e/` 下現有測試檔
——**目前皆無結果**。原因：SDLCCT-40（測試工具鏈）在撰寫本設計文件時尚未
合併進 `main`，`frontend/` 目前沒有任何已落地的 e2e 測試檔或
`playwright.config.ts`。因此本票沒有需要擔心的既有跨元素樣式耦合測試鏈，
也沒有需要在開放設計問題中提出的衝突。本票新增的示範 e2e 測試（決策 7）
只斷言文字可見性，不比較任何兩個元素的 computed style，故也不會新建這類
耦合。

## 關鍵技術決策

1. **採用手刻的輕量 i18n 機制（單一訊息目錄檔 + 一個 `t()` 函式），不採用
   `next-intl` 或其他多語系函式庫。**
   本案目前且可預見範圍內只需要 zh-TW 一種語言（範圍外明文排除語言切換
   UI 與第二語言內容），不需要路由層級的 locale 判斷、`middleware.ts`、
   `next-intl` 的 `NextIntlClientProvider`/`getLocale()` 等機制。
   `next-intl` 的核心價值是「多語系路由 + 格式化」，在只有一種語言的專案
   上引入它等於只用到其 API surface 的一小部分，卻背負其 provider
   wrapping、訊息載入（`getMessages()`/`useMessages()`）等執行期成本與
   設定複雜度。這正是 CONSTITUTION.md「Scope discipline — Implement only
   what the spec requires. Anything you can see will be needed later but
   the current story does not ask for is left for a future story」要排除
   的「為假設性未來需求建置」；若未來真的需要第二語言，那是一張新故事，
   屆時再評估是否導入函式庫，不在本票預先決定。此外，`frontend/app/
   layout.tsx` 的 `metadata` 是 Server Component 模組頂層的靜態匯出
   （Next.js metadata API 在 React 樹外求值），用一個純匯入的 TS 物件
   （plain object）可以直接讀取，不需要任何 provider/context；若用
   `next-intl` 讀取 metadata 需要額外的 `getTranslations()` 非同步呼叫與
   設定，對這張票而言是不必要的間接層。

2. **訊息目錄：`frontend/lib/i18n/messages.ts`，一個巢狀常數物件，依
   「頁面/元件 → 區段 → 元素」分層；葉節點是字串，或在需要插值時是回傳
   字串的函式。**
   巢狀分層對應決策 4 的 key 命名慣例，讓 key 本身就能反映字串出現的畫面
   位置,不需要額外的扁平前綴字串拼接。插值用函式而非字串模板
   變數替換（例如 `next-intl` 的 `{count}` 語法），是因為專案已是
   TypeScript + ESM，函式插值可以直接用 TypeScript 的參數型別檢查
   插值內容（例如 `days: number`），不需要額外引入模板解析/型別宣告檔。

3. **讀取機制：`frontend/lib/i18n/t.ts` 匯出 `t(key)` 函式，`key` 是
   `messages` 物件的巢狀路徑字串（例如
   `"costOverview.summarySection.title"`），用 TypeScript 的遞迴
   conditional type 從 `messages` 的實際形狀推導出合法路徑與回傳型別
   （字串葉節點回傳 `string`，函式葉節點回傳該函式本身，由呼叫端自行帶參
   數呼叫，例如
   `t("costOverview.summary.projectedOverspend.sub")(summary.days_in_month)`）。**
   不做成 React hook（例如 `useT()`），因為目前完全不需要 locale 切換時
   的 re-render 行為——`t()` 是純函式，Server Component（`layout.tsx`）
   與 Client Component 都可以直接呼叫，不需要 Context Provider。這滿足
   AC1「t()/等效 hook」的要求（函式形式即是「等效」），同時保留了未來若
   真的需要切換語言時，可以在不改動呼叫端 call site 的前提下，把
   `t()` 內部實作改成讀取某個 locale context 的最小改動路徑。
   ```ts
   // frontend/lib/i18n/messages.ts
   export const messages = {
     sidebar: {
       groups: {
         overview: "總覽",
         governance: "治理",
         operations: "操作",
         settings: "設定",
       },
       items: {
         costDashboard: "成本儀表板",
         agentList: "Agent 清單",
         anomalyAlerts: "異常與告警",
         budgetSimulation: "預算與節省模擬",
         policyEngine: "政策引擎",
         approvalFlow: "核准流程",
         pauseAgent: "暫停 Agent",
         emergencyShutdown: "緊急關閉",
         system: "系統",
       },
     },
     costOverview: {
       header: {
         today: "今天（台灣時間）：",
         unavailable: "無法取得",
         title: "成本總覽",
         subtitle: "本月成本 vs 預算、預估月底超支、跨 Agent 期間比較",
       },
       summarySection: { title: "本月成本 vs 預算總覽" },
       periodSection: {
         title: "跨 Agent 期間比較",
         heading: "跨 Agent 期間比較（誰漲最多）",
       },
       footer: { dataSource: "資料來源：Agent registry ＋ 觀測性後端成本查詢。" },
       summary: {
         totalSpend: {
           label: "本月總花費（含未登錄 Agent）",
           sub: "9 個 Agent 累計（COST，本月至今）",
         },
         totalBudget: { label: "本月總預算", sub: "已登錄 Agent 的 budget 加總" },
         budgetConsumedPct: {
           label: "預算消耗百分比",
           subOverBudget: "已超過本月預算",
           subWithinBudget: "尚在預算內",
         },
         projectedOverspend: {
           label: "預估月底超支金額",
           sub: (daysInMonth: number) =>
             `依目前花費速度線性外推至月底（第 ${daysInMonth} 天）`,
         },
         governanceGap: {
           hasGap: (count: number) => `⚠ 治理缺口：${count} 個 Agent 未登錄`,
           noGap: "✓ 無治理缺口：所有 Agent 皆已登錄",
           note: "花費計入總花費，但不計入總預算分母",
         },
         unregisteredBadge: "未登錄",
       },
       period: {
         currentPeriod: (range: string) => `本期花費（${range}）`,
         previousPeriod: (range: string) => `前期花費（${range}）`,
         delta: "漲幅",
       },
     },
     errorCard: {
       loadFailedTitle: (title: string) => `無法載入「${title}」`,
       queryFailed: (endpoint: string, status: string, message?: string) =>
         `查詢失敗：${endpoint} 回應 ${status}${message ? `（${message}）` : ""}。其他卡片資料不受影響。`,
       connectionUnavailable: "無法連線",
       retry: "重試",
     },
     app: {
       metadata: {
         title: "成本總覽 — Agent Control Tower",
         description: "本月成本 vs 預算總覽、預估月底超支、跨 Agent 期間比較。",
       },
     },
   } as const;
   ```
   ```ts
   // frontend/lib/i18n/t.ts
   import { messages } from "./messages";

   type Messages = typeof messages;

   type Path<T, P extends string = ""> = T extends string
     ? P
     : T extends (...args: never[]) => string
       ? P
       : {
           [K in keyof T & string]: Path<T[K], P extends "" ? K : `${P}.${K}`>;
         }[keyof T & string];

   type Leaf<T, P extends string> = P extends `${infer K}.${infer Rest}`
     ? K extends keyof T
       ? Leaf<T[K], Rest>
       : never
     : P extends keyof T
       ? T[P]
       : never;

   export function t<P extends Path<Messages>>(key: P): Leaf<Messages, P> {
     const segments = key.split(".");
     let node: unknown = messages;
     for (const seg of segments) {
       node = (node as Record<string, unknown>)[seg];
     }
     return node as Leaf<Messages, P>;
   }
   ```

4. **Key 命名慣例（寫入 `frontend/AGENTS.md`，附加在既有
   `<!-- END:nextjs-agent-rules -->` 之後，不插入自動產生區塊內部，做法
   比照 SDLCCT-40 決策 10 的附加方式）：**
   ```markdown
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
   ```

5. **`frontend/app/layout.tsx` 的 `<head>` metadata（`title`/
   `description`）納入本票範圍，一併改為透過 `messages.app.metadata`
   讀取。**
   這兩個字串是 zh-TW 使用者可見文字（瀏覽器分頁標題、搜尋引擎/分享預覽
   摘要），且 `layout.tsx` 本身就在規格要求盤點的程式碼路徑之一
   （AC1 的「`/cost-dashboard` 頁面載入路徑」必定會經過這個 Server
   Component）。改動成本極低（兩個字串常數），若不納入會讓這張票留下
   「同一個載入路徑裡，有些中文字串用 i18n、有些沒有」的不一致狀態，
   違背本票「建立明確可遵循慣例」的目的。範圍外明確排除的只是「語言切換
   UI」與「第二語言內容」，不包含「這兩個既有字串改走哪個讀取機制」，
   故此處用低成本、降低不一致為由直接納入，不留為開放問題。

6. **字串盤點結果（本票實際遷移範圍，共 6 個檔案、29 個獨立 zh-TW 字串
   key，另有 3 處英文字面明確排除不遷移）：**

   | 檔案 | 字面（現況） | 對應 key |
   |---|---|---|
   | app-sidebar.tsx L34 | 總覽 | `sidebar.groups.overview` |
   | app-sidebar.tsx L35 | 成本儀表板 | `sidebar.items.costDashboard` |
   | app-sidebar.tsx L38 | 治理 | `sidebar.groups.governance` |
   | app-sidebar.tsx L40 | Agent 清單 | `sidebar.items.agentList` |
   | app-sidebar.tsx L41 | 異常與告警 | `sidebar.items.anomalyAlerts` |
   | app-sidebar.tsx L42 | 預算與節省模擬 | `sidebar.items.budgetSimulation` |
   | app-sidebar.tsx L43 | 政策引擎 | `sidebar.items.policyEngine` |
   | app-sidebar.tsx L44 | 核准流程 | `sidebar.items.approvalFlow` |
   | app-sidebar.tsx L48 | 操作 | `sidebar.groups.operations` |
   | app-sidebar.tsx L49 | 暫停 Agent | `sidebar.items.pauseAgent` |
   | app-sidebar.tsx L49 | 緊急關閉 | `sidebar.items.emergencyShutdown` |
   | app-sidebar.tsx L52 | 設定 | `sidebar.groups.settings` |
   | app-sidebar.tsx L53 | 系統 | `sidebar.items.system` |
   | cost-dashboard/page.tsx L22 | 今天（台灣時間）： | `costOverview.header.today` |
   | cost-dashboard/page.tsx L23 | 無法取得 | `costOverview.header.unavailable` |
   | cost-dashboard/page.tsx L29 | 成本總覽 | `costOverview.header.title` |
   | cost-dashboard/page.tsx L32 | 本月成本 vs 預算、預估月底超支、跨 Agent 期間比較 | `costOverview.header.subtitle` |
   | cost-dashboard/page.tsx L35/L37; summary-section.tsx L56 | 本月成本 vs 預算總覽（三處共用） | `costOverview.summarySection.title` |
   | cost-dashboard/page.tsx L42; period-comparison-section.tsx L18 | 跨 Agent 期間比較（兩處共用） | `costOverview.periodSection.title` |
   | cost-dashboard/page.tsx L44 | 跨 Agent 期間比較（誰漲最多） | `costOverview.periodSection.heading` |
   | cost-dashboard/page.tsx L50 | 資料來源：Agent registry ＋ 觀測性後端成本查詢。 | `costOverview.footer.dataSource` |
   | summary-section.tsx L69/71 | 本月總花費（含未登錄 Agent）／9 個 Agent 累計（COST，本月至今） | `costOverview.summary.totalSpend.{label,sub}` |
   | summary-section.tsx L74/76 | 本月總預算／已登錄 Agent 的 budget 加總 | `costOverview.summary.totalBudget.{label,sub}` |
   | summary-section.tsx L79/81 | 預算消耗百分比／已超過本月預算／尚在預算內 | `costOverview.summary.budgetConsumedPct.{label,subOverBudget,subWithinBudget}` |
   | summary-section.tsx L85/87 | 預估月底超支金額／依目前花費速度線性外推至月底（第 N 天） | `costOverview.summary.projectedOverspend.{label,sub(days)}` |
   | summary-section.tsx L96/97 | ⚠ 治理缺口：N 個 Agent 未登錄／✓ 無治理缺口：所有 Agent 皆已登錄 | `costOverview.summary.governanceGap.{hasGap(count),noGap}` |
   | summary-section.tsx L100 | 花費計入總花費，但不計入總預算分母 | `costOverview.summary.governanceGap.note` |
   | summary-section.tsx L113 | 未登錄 | `costOverview.summary.unregisteredBadge` |
   | period-comparison-section.tsx L33 | 本期花費（{range}） | `costOverview.period.currentPeriod(range)` |
   | period-comparison-section.tsx L36 | 前期花費（{range}） | `costOverview.period.previousPeriod(range)` |
   | period-comparison-section.tsx L40 | 漲幅 | `costOverview.period.delta` |
   | error-card.tsx L22 | 無法載入「{title}」 | `errorCard.loadFailedTitle(title)` |
   | error-card.tsx L25-26 | 查詢失敗：{endpoint} 回應 {status}（{message}）。其他卡片資料不受影響。 | `errorCard.queryFailed(endpoint, status, message)` |
   | error-card.tsx L25 | 無法連線（`error.status` 為空時的 fallback 字面） | `errorCard.connectionUnavailable` |
   | error-card.tsx L34 | 重試 | `errorCard.retry` |
   | layout.tsx L15 | 成本總覽 — Agent Control Tower | `app.metadata.title` |
   | layout.tsx L16 | 本月成本 vs 預算總覽、預估月底超支、跨 Agent 期間比較。 | `app.metadata.description` |

   **明確排除（非 zh-TW 字面，不搬進 `messages.ts`）**：
   `app-sidebar.tsx` L64、`cost-dashboard/page.tsx` L19 的
   「Agent Control Tower」（英文品牌名稱，兩處維持字面常數）；
   `period-comparison-section.tsx` L31 的表格欄位「Agent」（英文詞彙）。
   理由見決策 4 命名慣例「非中文字面」一節，直接依 AC2 原文「繁中字串」
   的字面範圍判斷，不是本設計另行放寬。

7. **遷移範例（代表性 before/after，其餘檔案依同模式遷移）：**

   `app-sidebar.tsx`：
   ```ts
   // before
   const NAV_GROUPS: NavGroup[] = [
     {
       label: "總覽",
       items: [{ label: "成本儀表板", href: "/cost-dashboard" }],
     },
     ...
   ];

   // after
   import { t } from "@/lib/i18n/t";

   const NAV_GROUPS: NavGroup[] = [
     {
       label: t("sidebar.groups.overview"),
       items: [{ label: t("sidebar.items.costDashboard"), href: "/cost-dashboard" }],
     },
     ...
   ];
   ```

   `summary-section.tsx`（插值範例）：
   ```tsx
   // before
   <Card
     label="預估月底超支金額"
     value={formatCurrency(summary.projected_overspend)}
     sub={`依目前花費速度線性外推至月底（第 ${summary.days_in_month} 天）`}
     danger={overspend}
   />

   // after
   <Card
     label={t("costOverview.summary.projectedOverspend.label")}
     value={formatCurrency(summary.projected_overspend)}
     sub={t("costOverview.summary.projectedOverspend.sub")(summary.days_in_month)}
     danger={overspend}
   />
   ```

   `error-card.tsx`：
   ```tsx
   // before
   <p className="mb-1 text-sm font-semibold text-red-700">
     無法載入「{title}」
   </p>
   <p className="mb-3 text-xs leading-[18px] text-red-700/85">
     查詢失敗：{error.endpoint} 回應 {error.status || "無法連線"}
     {error.message ? `（${error.message}）` : ""}。其他卡片資料不受影響。
   </p>
   <button type="button" onClick={onRetry} className="...">
     重試
   </button>

   // after
   <p className="mb-1 text-sm font-semibold text-red-700">
     {t("errorCard.loadFailedTitle")(title)}
   </p>
   <p className="mb-3 text-xs leading-[18px] text-red-700/85">
     {t("errorCard.queryFailed")(
       error.endpoint,
       error.status || t("errorCard.connectionUnavailable"),
       error.message,
     )}
   </p>
   <button type="button" onClick={onRetry} className="...">
     {t("errorCard.retry")}
   </button>
   ```
   註：`error.status || "無法連線"` 原本的 fallback 字面「無法連線」與
   `costOverview.header.unavailable`「無法取得」是兩個不同語意的字串
   （連線失敗 vs 資料缺失），**不可**誤併為同一個 key——盤點時發現兩者
   文字不同，上表第 L23 的 `costOverview.header.unavailable` 只對應
   `page.tsx` 的「無法取得」。`error-card.tsx` 這個「無法連線」字面本票
   新增 key `errorCard.connectionUnavailable`，上表第 6 項已更新收錄
   （原始盤點遺漏此字面，於此處一併補上，避免開發者遺漏這一個 fallback
   分支）。

8. **顯示結果不變的驗證：新增 Playwright e2e 測試
   `frontend/e2e/i18n-cost-dashboard-strings.spec.ts`，斷言遷移前後逐字
   相同的靜態可見文字（建立在 SDLCCT-40 落地的 Playwright 工具鏈上，
   `npm run test:e2e` 會執行）。**
   只斷言**不依賴後端成功**的靜態字串（比照 SDLCCT-40 決策 4 的理由：
   e2e CI 環境沒有啟動真正的 BFF，`summary-section.tsx`/
   `period-comparison-section.tsx` 實際資料內容在 CI 下會是 loading 或
   error 狀態，不適合斷言）。斷言內容：
   ```ts
   import { expect, test } from "@playwright/test";

   test("cost dashboard 靜態文字在 i18n 重構後維持不變", async ({ page }) => {
     await page.goto("/cost-dashboard");

     await expect(page.getByText("Agent Control Tower")).toBeVisible();
     await expect(page.getByRole("heading", { name: "成本總覽" })).toBeVisible();
     await expect(
       page.getByText("本月成本 vs 預算、預估月底超支、跨 Agent 期間比較"),
     ).toBeVisible();
     await expect(
       page.getByRole("heading", { name: "本月成本 vs 預算總覽" }),
     ).toBeVisible();
     await expect(
       page.getByRole("heading", { name: "跨 Agent 期間比較（誰漲最多）" }),
     ).toBeVisible();
     await expect(
       page.getByText("資料來源：Agent registry ＋ 觀測性後端成本查詢。"),
     ).toBeVisible();
     await expect(page).toHaveTitle("成本總覽 — Agent Control Tower");
   });

   test("app sidebar 導覽文字在 i18n 重構後維持不變", async ({ page }) => {
     await page.goto("/cost-dashboard");

     await expect(page.getByText("總覽")).toBeVisible();
     await expect(page.getByRole("link", { name: "成本儀表板" })).toBeVisible();
     await expect(page.getByText("治理")).toBeVisible();
     await expect(page.getByText("Agent 清單")).toBeVisible();
     await expect(page.getByText("異常與告警")).toBeVisible();
     await expect(page.getByText("預算與節省模擬")).toBeVisible();
     await expect(page.getByText("政策引擎")).toBeVisible();
     await expect(page.getByText("核准流程")).toBeVisible();
     await expect(page.getByText("操作")).toBeVisible();
     await expect(page.getByText("暫停 Agent")).toBeVisible();
     await expect(page.getByText("緊急關閉")).toBeVisible();
     await expect(page.getByText("設定")).toBeVisible();
     await expect(page.getByRole("link", { name: "系統" })).toBeVisible();
   });
   ```
   選擇新開一個獨立檔案而非直接修改 SDLCCT-40 既有的示範 e2e 檔案
   （`frontend/e2e/cost-dashboard.spec.ts`），是為了讓本票的驗證邏輯可
   獨立追溯於這張票、不與 SDLCCT-40 的示範測試職責混在一起；兩份檔案的
   斷言不衝突（本檔案涵蓋範圍更廣，含既有示範檔已斷言的兩個字串，屬刻意
   重疊以確保本測試單獨執行也能完整驗證）。這滿足 AC3「不得僅以開發者
   肉眼看過作為唯一證據」的要求，且依 `frontend/AGENTS.md`（SDLCCT-40
   決策 10）判準，本票屬於「既有、已通過審核頁面的內容調整，且不影響任何
   既有互動邏輯」之外的情形——本票會改變字串的*讀取機制*而非僅文案微調，
   屬於「新增/修改有邏輯變更」的範疇，依判準應寫自動化測試，故此處不只
   是依循先例宣告免測，而是確實新增測試。

## UI 原型
不適用，不需要新增原型檔案。本票是純文字讀取機制的重構（字面文字、版面、
互動行為依驗收條件要求逐字不變），不產生、也不修改任何使用者可見的畫面
外觀——決策 8 的 e2e 測試即是「畫面外觀未變」的驗證依據，不需要另外的
視覺原型給人類在 G1b 審核。

## 開放設計問題（定稿時必須為空）
無——規格與既有程式碼已足以決定本票所有 HOW 層級的選擇（機制選型、訊息
目錄結構、`t()` 簽名、key 命名慣例文字、6 個檔案的完整字串盤點與遷移方式、
metadata 是否納入、驗證用的 e2e 測試內容），且未發現既有跨元素樣式一致性
測試鏈需要處理。
