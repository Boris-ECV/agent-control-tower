# 設計文件 — SDLCCT-110 Agent 詳情頁視覺一致性：最貴執行清單新增執行時間欄、Trace ID 截斷與複製

## 對應需求規格

G1 核准版本（拆分自 SDLCCT-86，依 `ui review/design-changes-v2-.md` 第二章
第 4 節），3 條 Gherkin AC：
1. 合法 UUIDv7 格式 Trace ID → 該列顯示從 ID 解析出的執行開始時間（台灣
   時間，分鐘精度）。
2. 非合法 UUIDv7 格式 Trace ID → 執行時間欄顯示「—」，不影響同列其他
   欄位渲染。
3. 完整 36 字元 Trace ID → 欄位顯示中間截斷格式，hover 顯示完整 ID 並提
   供複製按鈕，點擊後完整 36 字元 ID 寫入剪貼簿。

範圍外：成本標籤分組、共同中繼資料整併、廠別篩選（其他拆分子單）；執行
列可點擊導覽（SDLCCT-101 已完成，本票不可破壞）；最貴執行清單金額精度
（PO 另評）。依賴 SDLCCT-82（Done，金額格式/`ClickableRow` 前身）、
SDLCCT-101（Done，`ClickableRow` 共用元件，見下方現況盤點）。

**現況盤點**（實作前逐一確認的程式碼事實）：

- `frontend/components/agent-detail/top-traces-table.tsx`：目前欄位順序為
  Trace ID（純文字，完整 36 字元或測試用短字串原樣顯示）／預估成本（靠
  右，`formatTableCurrency`）／中繼資料（`MetadataCell`）／尾端箭頭裝飾欄
  （`aria-hidden`）。整列已是 `ClickableRow`（SDLCCT-101），`onActivate`
  呼叫 `router.push` 導覽到 trace 詳情頁。
- `MetadataCell` 內的「更多/收合」按鈕已示範本票要用的相容模式：
  `onClick={(e) => { e.stopPropagation(); setExpanded(...); }}` 加
  `onKeyDown` 對 Enter/空白鍵也 `stopPropagation()`——因為 `ClickableRow`
  把 `onClick`/`onKeyDown`（Enter/空白鍵觸發 `onActivate`）直接掛在
  `<tr>` 本身（見 `frontend/components/common/clickable-row.tsx`），列內
  任何子元素的點擊/按鍵事件預設會冒泡到 `<tr>` 觸發導覽，必須在子元素的
  handler 內擋下冒泡才能讓子元素有自己的獨立互動。本票新增的複製按鈕直
  接沿用同一組已驗證可行的模式，不是新發明。
- `frontend/e2e/agent-detail.spec.ts` 多處 mock `top_traces` 用短字串 ID
  （如 `"trace-001"`、`"trace-002"`，10 字元，非 UUID 格式），並有多處
  `page.getByText("trace-001")` 斷言其**完整文字**可見（例如第 74、773、
  813、854、862、890、928 行），其中第 813/854/862/890/928 行更進一步用
  `.locator("xpath=ancestor::tr")` 從這個文字節點找回整列——若本票的截斷
  邏輯對這些短字串也截斷或改變其可見文字節點內容，會直接打斷這些既有
  SDLCCT-56/74/101 測試。因此截斷只能套用在「看起來真的是長 ID」的字
  串，短字串必須完整顯示（見決策 3）。
- 搜尋 `frontend/e2e/` 全域 `toEqual`/`一致`/`getComputedStyle` 等跨元素
  樣式相等斷言（依流程第 4 步規則）：`agent-detail.spec.ts` 現有的
  `toEqual`/`getComputedStyle` 比較對象是 trace 列的 hover 底色/焦點外
  框/箭頭位移（SDLCCT-101 既有驗收）、daily 欄位標題文字陣列、折線圖
  point 數量——皆與本票新增的「執行時間欄」或「Trace ID 截斷/複製」無
  關，**未發現**任何將本票要改動的選擇器與另一元件計算樣式綁定相等的鏈
  式測試。
- `frontend/lib/format.ts` 已有 `formatSlashDateTimeMinute(date: Date):
  string`（分鐘精度、台灣時間，`Invalid Date` 回傳 `"—"`），本票直接沿
  用，不重複寫一份新的時間格式化與 em dash 邏輯。
- `frontend/components/ui/tooltip.tsx`（base-ui `Tooltip`）目前**只有**
  `sidebar.tsx` 在用（側邊欄收合時的導覽項目提示），尚未有任何資料表格
  儲存格使用這個元件的先例；原生 `title` 屬性足以滿足 AC「hover 顯示完
  整 ID」的行為要求，不需為此新增第一個「表格儲存格 tooltip」先例（見決
  策 4）。
- `frontend/lib/i18n/messages.ts` 第 173–187 行 `agentDetail.topTraces`
  既有 i18n 結構：`table.columns.{id,cost,metadata}`、
  `metadata.{fields,more,collapse}`。本票新增欄位沿用同一層級慣例。

## 介面/API 契約

無新增/變更端點。沿用既有 `TopTraceItem`（`frontend/lib/agent-detail-api.ts`
→ `components["schemas"]["TopTraceItem"]`）的 `id`（trace ID 字串，既有欄
位）。執行時間完全由前端純函式從 `trace.id` 解析，不需要 bff 回應新增任
何欄位（ticket 背景已明確排除後端改動）。

## 資料模型

無新增資料模型。

## 關鍵技術決策

1. **新增純函式工具模組 `frontend/lib/trace-id.ts`，提供
   `parseTraceStartTime(traceId: string): Date | null` 與
   `truncateTraceId(traceId: string): string` 兩個函式。**
   理由：與 `frontend/lib/format.ts`（純格式化函式，無元件相依）同屬
   「展示層純函式」分類，但職責不同（UUID 解析/截斷 vs. 既有的數字/日
   期格式化），獨立成新檔案，避免把與 Trace ID 這個特定概念相關的邏輯混
   進通用的 `format.ts`；命名對齊既有 `lib/*.ts` 檔案以功能命名（如
   `breadcrumbs.ts`、`nav.ts`）的慣例。

2. **`parseTraceStartTime` 的驗證與解析規則（嚴格比對合法 UUIDv7 格
   式，任何一項不符即回傳 `null`）：**
   - 長度必須恰好 36 字元。
   - 必須符合標準 UUID 的 dash 格式
     `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`。
   - 第三段（version 欄位）第一個字元必須是 `"7"`（UUIDv7 的 version
     nibble）——AC 明確區分「合法 UUIDv7 格式」與「非合法 UUIDv7 格式」
     兩個情境，若不檢查 version nibble，一個格式正確但版本是 v4 的
     UUID 會被誤判為可解析，解析出的「時間戳」其實是隨機亂數，不是真
     正的執行時間，這會違反 CONSTITUTION「資料正確性」—— 顯示一個無法
     追溯回真實來源的數字比顯示 em dash 更糟。
   - 通過以上檢查後，取字串移除 dash 後的前 12 個十六進位字元（即前兩
     段 `xxxxxxxx-xxxx` 相連，為 UUIDv7 定義的前 48 bits = 毫秒時間
     戳），`parseInt(hex12, 16)` 得到毫秒數，`new Date(ms)`；若此
     `Date` 本身是 `Invalid Date`（理論上不會發生，但防禦性檢查一次
     `Number.isNaN(date.getTime())`），一併回傳 `null`。
   理由：規格情境二明確要「非合法格式」才顯示 em dash，合法格式才解
   析，version nibble 檢查是「合法 UUIDv7」判定的必要條件,不只是長度
   和十六進位格式。

3. **`truncateTraceId` 只在 `traceId.length > 12` 時才截斷為
   `` `${id.slice(0, 8)}…${id.slice(-4)}` ``（省略符用全角「…」）；
   長度 ≤ 12 的字串原樣完整回傳，不截斷。**
   理由：AC 的截斷格式是「前 8 碼…後 4 碼」，對 36 字元的真實 UUID 才
   有縮短視覺長度的意義；但現況盤點發現既有 e2e 測試（SDLCCT-56/74/
   101）用 10 字元的短字串 mock trace ID（如 `"trace-001"`），並直接以
   `getByText("trace-001")` 斷言完整文字可見、再從該文字節點反查整列
   —— 若對這類短字串也套用「前 8…後 4」（`"trace-001"` 只有 9 字元,
   8+4=12 已經比原字串還長,截斷毫無意義且會產生比原字串更長或格式怪異
   的輸出），會直接打斷三個既有 Story 的測試。選擇 `> 12` 作為門檻（而
   非直接以 36 字元判斷）是因為往前端顯示層不應該把「是否為合法
   UUIDv7」這個語意綁進純粹的顯示截斷邏輯 —— 即使是語法上不合法的
   UUIDv7（情境二的「—」案例）,只要原始 Trace ID 字串本身夠長,視覺上
   一樣需要截斷與複製功能(複製按鈕複製的是原始字串,不是解析出的時
   間),兩者是獨立關注點。

4. **Hover 顯示完整 ID 用原生 HTML `title` 屬性，不引入 `@/components/
   ui/tooltip`（base-ui Tooltip）元件。**
   理由：現況盤點確認 `ui/tooltip.tsx` 目前唯一使用者是側邊欄收合時的
   導覽提示，尚無任何資料表格儲存格採用這個元件的先例;原生 `title`
   已完整滿足 AC「hover 顯示完整 ID」的行為要求（滑鼠停留顯示瀏覽器原
   生提示框,含完整 36 字元內容）,不需要為了一個單純的「懸停看完整文
   字」需求引入互動式 tooltip 元件的額外狀態管理與定位邏輯,符合
   CONSTITUTION「Scope discipline」—— 做規格要求的,不因為程式碼裡已經
   有一個 tooltip 元件就順手套用。

5. **複製按鈕的 `onClick`/`onKeyDown` 必須呼叫
   `event.stopPropagation()`，這是與 SDLCCT-101 `ClickableRow` 相容的
   關鍵約束。**
   實作：
   ```tsx
   <button
     type="button"
     aria-label={t("agentDetail.topTraces.traceId.copyAriaLabel")}
     onClick={(e) => {
       e.stopPropagation();
       void navigator.clipboard.writeText(trace.id);
       setCopiedId(trace.id);
       window.setTimeout(() => setCopiedId((cur) => (cur === trace.id ? null : cur)), 1500);
     }}
     onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
         e.stopPropagation();
       }
     }}
     className="rounded p-1 text-text-secondary hover:bg-gray-100 hover:text-accent"
   >
     {/* 複製圖示，與既有箭頭圖示同樣做法：inline SVG，不引入圖示套件 */}
   </button>
   ```
   理由：`ClickableRow`（`frontend/components/common/clickable-row.tsx`）
   把 `onClick`/`onKeyDown`（Enter/空白鍵觸發 `onActivate` 導覽）直接掛
   在 `<tr>` 本身，子元素事件預設會冒泡觸發整列導覽；`MetadataCell` 的
   「更多/收合」按鈕已用完全相同的 `stopPropagation` 模式證明可行（見
   現況盤點），複製按鈕沿用同一慣例，不另創新模式。`setTimeout` 清除時
   用 `cur === trace.id` 比對而非直接 `null`，是因為清單有多列、使用者
   可能在 1.5 秒內連續複製不同列,避免後點的列的「已複製」狀態被前一列
   逾時的 timer 誤清掉。

6. **複製圖示沿用本檔案既有慣例：inline SVG `<svg>` + `<path>`，不引
   入 `lucide-react`。**
   理由：`lucide-react` 雖已是專案相依套件,但目前只有 shadcn 產生的
   `components/ui/sheet.tsx`/`sidebar.tsx` 在用；本檔案（
   `top-traces-table.tsx`）既有的尾端箭頭圖示（SDLCCT-101）就是手寫
   inline SVG,沒有先例在「功能元件」（非 `ui/` 目錄下的 shadcn 元件）
   層級引入圖示套件。為一個圖示改變此檔案一致的寫法不划算,遵循
   CONSTITUTION「Code style」follow existing conventions 原則。

7. **「已複製」回饋為本票新增的最小狀態，不新建共用元件。**
   `TopTracesTable` 內一個 `useState<string | null>("copiedId", null)`
   記錄目前顯示「已複製」回饋的 trace id（最多同時一列顯示,因為使用者
   一次只能點一個按鈕）；複製成功後,按鈕旁邊短暫以 `aria-live="polite"`
   文字節點顯示 `t("agentDetail.topTraces.traceId.copied")`（「已複
   製」），1.5 秒後自動消失（見決策 5 的 timeout 邏輯）。
   理由：現況盤點確認全站目前**沒有**既有的「複製成功回饋」UI 模式可
   沿用，是本票第一個需要這種回饋的畫面；比照
   `MetadataCell`「更多/收合」用局部 `useState` 控制顯示/隱藏文字的既
   有寫法做最小實作，不新增共用 `Toast`/`Snackbar` 元件（規格只要求
   「複製後寫入剪貼簿」這個行為本身被驗證,UI 回饋的存在是良好使用者體
   驗的合理延伸,但做成一個可重用元件超出本票範圍）。

8. **新的「執行時間」欄插入在 Trace ID 欄之後、預估成本欄之前**
   （欄序：Trace ID → 執行時間 → 預估成本 → 中繼資料 → 箭頭裝飾欄）。
   理由：規格的使用者故事敘述順序是「看到執行時間」在前、「複製 Trace
   ID」在後,但 AC 三個情境都是逐列獨立驗證,未強制規定欄序；選擇把執行
   時間放在識別資訊（Trace ID）之後、金額資訊之前,是因為「這是哪一筆
   執行、何時發生」屬於同一類「識別這筆記錄」的資訊,金額與中繼資料屬於
   該筆執行的「內容」,視覺上相鄰分組比較符合既有表格從左到右「識別→內
   容」的閱讀順序（現有的中繼資料欄本身也包含 `trigger`/`plant` 等情境
   資訊,執行時間與其語意相近,但 ticket 要求獨立欄位而非併入中繼資料
   chip,故仍獨立一欄,只是位置上貼近 Trace ID）。

9. **執行時間欄的渲染：`formatSlashDateTimeMinute(parseTraceStartTime(trace.id) ?? new Date(NaN))`。**
   理由：`parseTraceStartTime` 回傳 `null` 時,直接餵一個 `Invalid Date`
   給既有的 `formatSlashDateTimeMinute`（`frontend/lib/format.ts` 第
   177–181 行已有 `Number.isNaN(date.getTime())` 檢查回傳 `"—"`),避免
   在元件內再手寫第二份「em dash」字面字串,單一事實來源沿用
   `format.ts` 既有的缺值顯示慣例（ticket 背景段也明確要求「沿用
   `lib/format.ts` 既有缺值顯示 em dash 慣例」）。

## UI 原型

見 `docs/design/SDLCCT-110-prototype.html`（可直接在瀏覽器開啟）。展示：
- 表頭新增「執行時間」欄（Trace ID 之後、預估成本之前）。
- 一列合法 UUIDv7 Trace ID：顯示解析出的執行時間（台灣時間、分鐘精
  度）、Trace ID 顯示為「前 8 碼…後 4 碼」截斷格式、hover 時原生
  tooltip（示意為瀏覽器 `title`）顯示完整 36 字元、旁邊有複製圖示按
  鈕。
- 一列非合法 UUIDv7 格式的 Trace ID（如版本 nibble 不是 7）：執行時間
  欄顯示「—」，Trace ID／預估成本／中繼資料欄照常渲染不受影響。
- 一列既有短字串 Trace ID（如 `"trace-001"`，模擬既有測試資料）：完整
  顯示不截斷，執行時間欄因非 UUID 格式顯示「—」。
- 複製按鈕點擊後的「已複製」文字回饋示意（靜態展示兩種狀態並列，因為
  原型為靜態 HTML 不含互動 JS 剪貼簿寫入）。

## 開放設計問題(定稿時必須為空)

無。
