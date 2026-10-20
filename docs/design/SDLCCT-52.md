# 設計文件 — SDLCCT-52 Anomalies screen UI (frontend) — split from SDLCCT-45

## 對應需求規格

對應 G1 已核准的需求規格「Anomalies screen UI (frontend) — split from
SDLCCT-45」。User Story：Portal 使用者想在單一畫面看到聚合端點回傳的全部
異常列（含持續中的治理缺口），以便進行分類處理（triage）。4 條 AC：
`date` 非 null 時原樣顯示（AC1）；`date=null`（`governance_gap` 類型）顯示
「持續中」而非空白/null/錯誤（AC2）；`agent`、`anomaly_type`（本地化標
籤）、`reason` 各自獨立一欄顯示（AC3）；端點回報某條規則的錯誤項
（`status="error"`，依 SDLCCT-51 的 per-rule-error-row 設計）時，UI 必須
明確呈現（例如 banner/row）——絕不悄悄省略受影響的 Agent（AC4）。

**範圍外**（spec 已標明）：前端篩選/排序、即時更新/輪詢；畫面不得出現底
層觀測性後端（Opik）名稱或品牌字樣（沿用 `docs/PRD.md` 第 645、741 行
E3 Epic 既有限制，與 SDLCCT-32 等既有 Portal 畫面同一慣例——本票新增的
畫面內容只會顯示 registry key/本地化異常類型/錯誤訊息文字，不會顯示任
何 Opik 專有名詞，天然符合此限制,不需要額外遮罩邏輯）。

**依賴**：SDLCCT-51（已 Done，`GET /api/anomalies` 聚合端點，本文件的
唯一資料來源）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `bff/api/schemas.py::AnomalyRow`/`AnomalyFeedResponse`：欄位型別為
  `agent: str | None`、`anomaly_type: str`、`date: str | None`、
  `status: str`、`reason: str`；外層 `AnomalyFeedResponse{anchor_date:
  str, anomalies: list[AnomalyRow]}`。
- `bff/api/anomalies.py`：`anomaly_type` 實際只會出現 5 種字面字串值——
  `"tool_retry_loop"`、`"context_bloat"`、`"night_batch_burst"`、
  `"model_switch"`、`"governance_gap"`（第 129/140/151/240/253/278/288
  行逐一確認,無其他變體）。`status` 只會是 `"ok"` 或 `"error"`
  （SDLCCT-51 介面契約逐字規定）。`status="error"` 時 `date` 一律
  `null`、`agent` 僅 `governance_gap` 的整批錯誤為 `null`、其餘情境
  `agent` 為該 Agent 的 registry key（SDLCCT-51 決策 #3/#4）。
- `frontend/lib/generated/bff-types.ts`：目前**沒有** `Anomaly`
  相關型別（`Grep("Anomaly", ...)` 零命中）——該檔案由
  `npm run generate:types`（`openapi-typescript ../bff/openapi.json`）產
  生,尚未在 SDLCCT-51 合併後重新產生。本票 developer 實作前必須先重跑
  `bff/scripts/export_openapi.py`（更新 `bff/openapi.json`）與
  `npm run generate:types`,否則 `components["schemas"]["AnomalyRow"]`
  在型別層面不存在,見下方關鍵決策 1。
- `frontend/lib/api-client.ts::fetchJson<T>(path)`：既有共用 fetch 封裝
  （screen-agnostic,SDLCCT-39）,本票沿用,不新增第二套 fetch 邏輯。
  失敗（網路錯誤或 non-2xx）時拋出 `ApiError{endpoint, status, message}`
  ——這是「整個請求失敗」的錯誤通道,與 AC4「200 回應內某一列
  `status="error"`」是不同語意的兩種錯誤（見決策 2）。
- `frontend/lib/agents-api.ts`：既有「畫面專屬 API client」範例
  （`fetchAgentsList()` 回傳型別從 `@/lib/generated/bff-types` 的
  `components["schemas"]` re-export）。本票比照此結構新增
  `frontend/lib/anomalies-api.ts`。
- `frontend/components/cost-overview/error-card.tsx::ErrorCard`：既有
  「整個請求失敗」三態渲染用元件,接受 `ApiError` 形狀的 prop,本票沿用
  於「`/api/anomalies` 本身回應非 2xx 或網路錯誤」的情境,但**不**用它
  表達 AC4（AC4 是 200 回應內的資料內容,不是請求失敗,見決策 2）。
- `frontend/lib/use-fetch-once.ts::useFetchOnce<T>(fetcher)`：既有
  per-card/per-section 資料抓取 hook（loading/error/success 三態 +
  `retry`）,本票沿用,一個頁面一個 instance（與 `agents/page.tsx` 同一
  用法,本頁無需多張獨立卡片各自抓取,因為只有一個端點）。
- `frontend/lib/format.ts::formatTaiwanDate(isoDate)`：既有「bff 回傳
  UTC `YYYY-MM-DD` → 展示層轉台灣時間顯示字串」慣例（SDLCCT-32 決策：
  時間轉換只在前端做）。`row.date` 與既有 `anchor_date` 同為
  `anchor.get_anchor_date()` 衍生的 UTC-midnight `YYYY-MM-DD` 字串,格式
  相容,本票沿用同一函式格式化非 null 的 `date`（見決策 3,說明 AC1「原
  樣顯示」與此既有轉換慣例的關係）。
- `frontend/app/agents/page.tsx`：既有頁面檔案結構範例（`"use client"`
  + 固定 `<header>`（含 `formatTaiwanDate(anchor_date)`）+ `<main>` 包
  `<h1>`/`<p>`/`<section>`/`<footer>`,three-state 渲染：loading
  skeleton/`ErrorCard`/成功內容）。本票新頁面
  `frontend/app/anomalies/page.tsx` 比照此結構。
- `frontend/components/layout/app-sidebar.tsx`：Governance 分組第 43 行
  `{ label: t("sidebar.items.anomalyAlerts") }` 目前**沒有** `href`（與
  SDLCCT-46 改動前的 `budgetSimulation` 項目同樣狀態）。本票比照
  SDLCCT-43/46 的手法,只改這一項加上 `href: "/anomalies"`,不動其餘 4
  個無 href 項目。
- `frontend/lib/i18n/messages.ts`：既有巢狀中文字串物件 + `t()`
  helper,本票新增 `anomalies` 命名空間,不更動既有任何命名空間（純附
  加,比照 SDLCCT-46 新增 `budgetSimulation` 命名空間的做法）。
- `frontend/e2e/agents.spec.ts`：既有 Playwright 測試慣例——(1) 頁面載
  入後 `<header>` 內「Agent Control Tower」與頁面 `<h1>` 標題皆可見
  （用 `page.locator("header").getByText(...)` 避免 sidebar 同文字造成
  strict-mode 歧義）;(2) 從 sidebar 點擊導覽連結可到達目標頁面;(3)
  `data-active` 屬性驗證 sidebar active 樣式切換。本票新增
  `frontend/e2e/anomalies.spec.ts` 比照這三類測試,新增第四類：資料列
  渲染驗證（AC1-3 的欄位內容、AC2 的「持續中」、AC4 的錯誤 banner 可
  見性),不新增第二套 e2e 慣例。
- 全 repo `Grep("toEqual|getComputedStyle|一致")` 只命中
  `frontend/AGENTS.md`（文件說明文字）與
  `frontend/lib/use-fetch-once.test.ts`（與樣式無關的 hook 單元測
  試）——**不存在**任何比較兩個元素 computed style 相等的既有測試,本票
  新增的畫面/元件不會觸發任何跨元素樣式耦合測試鏈,本票的跨元素樣式耦
  合測試檢查不適用（與 SDLCCT-46 現狀查核結論一致）。

## 介面/API 契約

**前端呼叫既有端點,不新增/變更任何 bff 端點。**

```
GET /api/anomalies  （SDLCCT-51 已實作,本票原樣消費,不變更）

Response 200 (application/json):
{
  "anchor_date": "YYYY-MM-DD",
  "anomalies": [
    { "agent": "<registry key>" | null,
      "anomaly_type": "tool_retry_loop" | "context_bloat" | "night_batch_burst"
                       | "model_switch" | "governance_gap",
      "date": "YYYY-MM-DD" | null,
      "status": "ok" | "error",
      "reason": "<human-readable string>" }
  ]
}
```

### 新增前端模組

- `frontend/lib/anomalies-api.ts`（新檔案,比照 `agents-api.ts`）：
  ```ts
  import { fetchJson } from "@/lib/api-client";
  import type { components } from "@/lib/generated/bff-types";

  export type AnomalyRow = components["schemas"]["AnomalyRow"];
  export type AnomalyFeedResponse = components["schemas"]["AnomalyFeedResponse"];

  export function fetchAnomalyFeed(): Promise<AnomalyFeedResponse> {
    return fetchJson<AnomalyFeedResponse>("/api/anomalies");
  }
  ```
  （型別從重新產生後的 `bff-types.ts` re-export,見現狀查核與決策 1）

- `frontend/app/anomalies/page.tsx`（新檔案）：
  - `"use client"` + `useFetchOnce(fetchAnomalyFeed)`。
  - `<header>`：左「Agent Control Tower」,右
    `formatTaiwanDate(state.data.anchor_date)`（成功時）/
    `t("costOverview.header.unavailable")`（非成功時),與
    `agents/page.tsx` 完全同一寫法。
  - `<main>`：`<h1>{t("anomalies.header.title")}</h1>` +
    `<p>{t("anomalies.header.subtitle")}</p>`。
  - 三態：
    - `loading`：骨架佔位（比照 `agents/page.tsx` 4 條骨架列）。
    - `error`（`fetchAnomalyFeed()` 本身的網路/HTTP 失敗,即
      `ApiError`)：渲染既有 `<ErrorCard>`（AC4 以外的既有錯誤路
      徑,見決策 2）。
    - `success`：
      1. 先把 `state.data.anomalies` 依 `status` 分成
         `okRows`/`errorRows` 兩組（見決策 2）。
      2. 若 `errorRows.length > 0`,在表格**上方**渲染一個或多個
         `AnomalyErrorBanner`（每個 `errorRows` 項目一個 banner,逐一
         顯示該列的 `agent`（`null` 時顯示
         `t("anomalies.errorBanner.unknownAgent")`,比照
         `agents/page.tsx` 的 `agent.owner ?? t("agents.unknownOwner")`
         既有「null 顯示明確占位字串」慣例)、本地化的
         `anomaly_type` 標籤、`reason`（AC4：絕不省略受影響 Agent）。
      3. 渲染 `AnomalyTable`（只收 `okRows`),欄位順序：Agent / 異常
         類型 / 日期 / 原因（AC3 的三欄 + AC1/AC2 的日期欄,見決策
         4）。
  - `<footer>`：`{t("anomalies.footer.dataSource")}`（比照既有頁尾資
    料來源說明句型）。

- `frontend/components/anomalies/anomaly-table.tsx`（新檔案）：
  - `ANOMALY_TYPE_LABELS: Record<string, string>`（見決策 5,5 個
    key 對應本地化標籤),未知值 fallback 顯示原始字串本身（防禦性寫
    法,不因未來新增第 6 種規則而顯示空白——與既有「null 顯示明確占
    位字串」慣例同精神,但這裡是「未知字串」而非「null」,fallback 用
    原字串而非占位詞,因為原始字串本身仍是有意義的除錯資訊）。
  - `formatAnomalyDate(date: string | null): string`：`date === null
    ? t("anomalies.table.ongoing") : formatTaiwanDate(date)`（AC1/AC2,
    見決策 3）。
  - 同時提供 `<table>`（desktop,比照 `AgentTable` 的 `hidden ...
    md:table`）與 `<ul>` 卡片清單（mobile,比照 `AgentCardList` 的
    `md:hidden`),兩者皆吃同一組 `okRows`,不新增第二套 responsive 慣
    例。

- `frontend/components/anomalies/anomaly-error-banner.tsx`（新檔案）：
  比照 `error-card.tsx` 的紅色 banner 視覺慣例（`border-red-300
  bg-red-50`），但 prop 形狀是本票自己的 `{ agent: string | null,
  anomalyType: string, reason: string }`（不是 `ApiError`,見決策
  2）,不接受 `onRetry`（AC4 的錨點是「這條規則這次呼叫失敗」,不是
  「整個頁面請求失敗」,沒有「重試」的對應動作,見決策 2）。

- `frontend/lib/i18n/messages.ts`：新增 `anomalies` 命名空間（只附
  加,不更動既有內容),鍵名：`anomalies.header.title`/`.header.subtitle`
  /`.table.columns.agent`/`.table.columns.anomalyType`/
  `.table.columns.date`/`.table.columns.reason`/`.table.ongoing`
  （「持續中」）/`.table.unknownAgent`（AC3 欄位的 `agent=null` 占位,
  理論上 `status="ok"` 列的 `agent` 不會是 null,但防禦性保留,見決策
  6）/`.errorBanner.title`/`.errorBanner.unknownAgent`/
  `.anomalyTypes.toolRetryLoop`/`.anomalyTypes.contextBloat`/
  `.anomalyTypes.nightBatchBurst`/`.anomalyTypes.modelSwitch`/
  `.anomalyTypes.governanceGap`/`.footer.dataSource`/`.empty`
  （`okRows.length === 0 && errorRows.length === 0` 時的「目前沒有異常」
  空狀態文字,AC 未要求但資料結構允許此狀態發生,顯示明確文字而非空白
  表格,防止使用者誤以為載入失敗）。

### 新增 e2e

- `frontend/e2e/anomalies.spec.ts`：比照 `agents.spec.ts` 慣例,涵蓋
  (1) 頁面載入與標題可見;(2) sidebar `t("sidebar.items.anomalyAlerts")`
  連結可導覽至 `/anomalies` 且 `data-active` 正確切換;(3) mock
  `/api/anomalies` 回應（Playwright route mock）驗證 AC1（非 null
  日期原樣顯示,經 `formatTaiwanDate` 格式化後的值)、AC2（`date=null`
  列顯示「持續中」)、AC3（三欄皆可見且值正確)、AC4（`status="error"`
  列不進入表格,而是以 banner 顯示,且 banner 文字包含該列
  `agent`/`reason`)。

## 資料模型

無新增資料模型。本票純消費既有 `GET /api/anomalies` 回應
（`AnomalyFeedResponse`,SDLCCT-51 已定案),不新增/變更任何 bff
Pydantic 類別、資料表或欄位。前端新增的 TypeScript 型別
（`anomalies-api.ts` 內的 re-export）皆從重新產生的
`bff-types.ts`（openapi-typescript 產物）取得,不是獨立定義的新資料模
型。

## 關鍵技術決策

### 1. Developer 實作前必須先重跑 `export_openapi.py` + `generate:types`,本文件不「新增」型別,只是標注既有產生流程的缺口

現狀查核已確認 `frontend/lib/generated/bff-types.ts` 目前沒有
`AnomalyRow`/`AnomalyFeedResponse`(SDLCCT-51 合併後未重新產生)。這不
是本票新增的介面,只是既有「bff schema 變更 → 重新產生前端型別」兩步
驟流程(`bff/scripts/export_openapi.py` 寫 `bff/openapi.json`,
`npm run generate:types` 讀它產生 `.ts`)在 SDLCCT-51 合併時漏跑了一
次。寫在這裡是為了讓 developer 不會在實作本票時誤以為要手刻一份
重複的 TS interface,也不會誤以為型別缺失是本票要解決的新問題。

### 2. AC4 的錯誤列用「獨立 banner,不混入表格」表達,且與既有 `ErrorCard`/`ApiError` 走的是兩條不同錯誤通道

這個端點有兩種完全不同層次的「失敗」：(a) `fetchAnomalyFeed()` 這次
HTTP 請求整體失敗(網路錯誤/非 2xx)——用既有 `ApiError` + `ErrorCard`
既定三態渲染路徑,與 `agents/page.tsx` 一致;(b) 請求本身成功(200),
但回應內某一列 `status="error"`,代表某條規則這次對某個 Agent(或
governance_gap 整批)的呼叫失敗——這是 SDLCCT-51 特意設計成「回應內資
料」而不是「HTTP 錯誤」(AC6 原文:其餘 Agent/規則繼續處理),所以不能
重用 `ApiError`/`ErrorCard`(那個 prop 形狀要求 `endpoint`/`status`,
這裡沒有單一 HTTP status 可對應,也沒有「重試」這個有意義的動作——
重試的是下一次對 `/api/anomalies` 的整體請求,不是單獨重跑某條規
則)。AC4 原文本身給了「banner 或 row」兩個選項,本文件選 banner(獨
立渲染在表格上方,不混入表格列),理由:(i) 表格的欄位語意是「這是一
筆異常」,錯誤列不是異常,是「這條規則這次沒能告訴你有沒有異常」,
混在同一張表格容易被誤讀成第 6 種異常類型;(ii) banner 可以用現有
`error-card.tsx` 同一套紅色警示視覺語言,使用者已經在其他畫面見過這
個視覺模式,學習成本低。這是在 AC4 本身給出的兩個選項之間做選擇,不
是發明 AC 沒講的新產品決策。

### 3. AC1「原樣顯示」透過既有 `formatTaiwanDate()` 格式化,不是逐字元原始字串輸出

AC1 字面是「as-is」/「原樣顯示」,但本 repo 既有慣例(SDLCCT-32 決
策,`format.ts` 檔頭註解)是「bff 回傳 UTC `YYYY-MM-DD`,台灣時間換算
在展示層做」,`agents/page.tsx`/`cost-dashboard` 等既有畫面的日期欄
位皆經過 `formatTaiwanDate()` 才顯示,不會直接印出 ISO 字串。AC1 的
「原樣顯示」在上下文中(與 AC2「date=null 顯示『持續中』」對比)語意
是「有值就老實顯示這個值代表的日期,不要空白/錯誤」,不是「禁止既有
的展示層格式轉換」——若解讀成逐字元輸出 ISO 字串,會讓本畫面的日期
顯示格式與全站其他畫面(Agent 清單的 `budget_consumed_pct`、
`cost-dashboard` 等)不一致,沒有任何既有慣例支持這種不一致。因此採
用與全站一致的 `formatTaiwanDate()`,只對 `date === null` 這一種情況
特殊處理成「持續中」(AC2)。

### 4. 表格欄位順序:Agent / 異常類型 / 日期 / 原因

AC3 只列了「agent、anomaly_type、reason 各自一欄」,AC1/AC2 額外要求
日期欄。欄位順序 spec 未指定,排序原則:先身份欄(誰、什麼類型)、再
時間欄、最後是最長的自由文字欄(reason,內容長度不定,放最後避免擠
壓其他欄的可讀寬度)——與 `agents/page.tsx` 的 `AgentTable`(身份欄
在前、數字/狀態欄居中、最後才是需要較寬空間的 `Sparkline`)同一排版
原則延伸。

### 5. `anomaly_type` 本地化標籤(5 個,逐一列出,供後續故事沿用同一組文案)

| `anomaly_type` 字面值 | 中文標籤 |
|---|---|
| `tool_retry_loop` | 工具重試迴圈 |
| `context_bloat` | 情境膨脹 |
| `night_batch_burst` | 非營業時段流量暴增 |
| `model_switch` | 模型切換 |
| `governance_gap` | 治理缺口 |

全部取自 `bff/api/anomalies.py` 實際會寫入的 5 個字面字串值(現狀查
核已逐一核對無其他變體),與 `docs/PRD.md` 各規則 Story(SDLCCT-27/
28/29/30/31)描述該規則時使用的中文名詞一致,不是本票自創新譯名。

### 6. 表格只渲染 `status === "ok"` 的列,`okRows` 內 `agent` 理論上不會是 `null`,但仍加防禦性 fallback

依 SDLCCT-51 決策 #4,`agent === null` 只發生在
`anomaly_type === "governance_gap"` **且** `status === "error"` 的組
合。表格只收 `status === "ok"` 的列,所以表格內 `agent` 欄理論上永
遠有值。仍保留 `t("anomalies.table.unknownAgent")` 防禦性 fallback
（而非直接假設非 null 省略判斷),理由與 SDLCCT-47 決策一致:後端契
約是本票 import 進來的既有事實,不是本票能保證不變的常量——防禦性
處理成本幾乎是零(一行 `?? fallback`),換來的是即使後端未來行為變
化也不會讓前端顯示空白/`null` 字樣。

## UI 原型

`docs/design/SDLCCT-52-prototype.html`(可直接在瀏覽器開啟的靜態
HTML,內嵌 `<style>`,套用與 `docs/design/SDLCCT-46-prototype.html`
相同的色彩/字級/間距 token,佔位資料清楚標示為範例,非真實查詢結
果)。涵蓋:
- 頁首:比照 `cost-dashboard`/`agents`/`budget-simulation` 頁面結構
  （固定 `<header>` + 頁面標題/副標題)。
- 一個「資料錯誤」banner 區塊範例(AC4):示範 `governance_gap` 整批
  失敗(`agent` 占位顯示「不明」)與某個已註冊 Agent 的
  `tool_retry_loop` 規則呼叫失敗兩種情境各一個 banner,皆附
  `reason` 文字,絕非空白。
- 一張異常資料表(AC1-3):至少 6 列示例,涵蓋全部 5 種
  `anomaly_type` 各一列,其中 `governance_gap` 列的日期欄顯示「持續
  中」(AC2),其餘列顯示示意日期(AC1)。
- 中文字串對應下方 i18n 新增 key 的規劃內容(置於
  `frontend/lib/i18n/messages.ts` 新增 `anomalies` 命名空間,鍵名列
  表見介面契約段落)。

## 本 Story 開發範圍判斷:維持單一 Story,不需依 docs/02 §6 再拆分

本票標題本身已標明「split from SDLCCT-45」——即在 Epic 規劃階段就已
經被拆成「SDLCCT-51 後端聚合端點」與「SDLCCT-52 前端畫面」兩張獨立
票,本文件只需要判斷**這一張**(前端部分)自身是否還需要再拆。比較
對象:
- **SDLCCT-43**(Agent 清單畫面,單一已存在端點 + 一個新頁面 + 一張
  表格/卡片雙版面 + sidebar href + i18n + e2e)與
  **SDLCCT-46**(預算模擬畫面,單一新端點 + 一個新頁面 + 表單 + 結果
  卡片 + sidebar href + i18n + e2e)兩者都被各自的架構師判定為「單一
  Story,不拆」,規模是「一個頁面消費一個端點」等級。
- 本票(SDLCCT-52)比 SDLCCT-43/46 更單純:**不需要新增表單互動**
  （SDLCCT-46 有下拉選單 + 送出按鈕的表單狀態管理),也**不需要新增
  任何 bff 端點**（SDLCCT-46/51 都需要新端點),純粹是「一個頁面 +
  一張表格 + 一個 banner 元件 + 既有端點消費」,比 SDLCCT-43/46 的既
  有規模還小一截。

結論:規模明顯小於已判定「不拆」的 SDLCCT-43/46,維持單一 Story,不
依 docs/02 §6 拆分。

## 開放設計問題(定稿時必須為空)

(無)
