# 設計文件 — SDLCCT-48 Agent detail screen (frontend) — split from SDLCCT-44

## 對應需求規格

對應 G1 已核准的需求規格「Agent detail screen (frontend) — split from
SDLCCT-44」。User Story：FinOps reviewer 想從 Agent 清單點進某個 Agent，
看到成本跳增時間點（version-split 序列）、模型分解、以及最貴的執行清
單，以便調查成本異常。5 條 AC：清單頁某列被點擊時導覽到該 Agent 的新
動態路由 detail 頁（AC1）；成功載入時顯示 `version_cost_series`（AC2）；
顯示 `model_cost_breakdown`（AC3）；顯示 `top_traces`，每列視覺上可點擊
（cursor/hover 樣式）但點擊不觸發任何導覽或 API 呼叫（畫面 #4 是另一張
未來票，AC4）；後端任一區塊或整個請求失敗時，該區塊（或整頁）必須顯示
明確錯誤卡片,絕不呈現 0/空白（AC5）。

**範圍外**（spec 已標明）：畫面 #4「執行詳情」（span tree）——目前完全
沒有組裝邏輯,另一張未來票;任何寫入操作;不得出現 Opik 品牌字樣。

**依賴**：SDLCCT-47（已 Done,`GET /api/agents/{key}/cost-breakdown`,
本文件的唯一資料來源）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `bff/api/schemas.py::VersionCostPoint`/`VersionCostSeriesEntry`/
  `ModelCostBreakdownEntry`/`TopTraceItem`/`AgentCostBreakdownResponse`：
  欄位型別為 `version_cost_series: list[{version: str, points:
  list[{date: str, value: float|None}]}]`、`model_cost_breakdown:
  list[{model: str, cost: float|None}]`、`top_traces:
  list[{id: str, total_estimated_cost: float|None, metadata: dict|None}]`，
  外層再含 `key`/`display`/`anchor_date`/`period_start`。
- `docs/design/SDLCCT-47.md` 決策 2：`cost`/`value` 查無資料時一律
  `null`,不回傳 `0`——本票展示層必須延續這條規則（絕不把 `null` 顯示成
  `0`,見下方介面契約段落）。決策 1：`version_cost_series` 是近 7 天
  DAILY 序列（固定視窗,所有 version 共用同一組日期）；
  `model_cost_breakdown` 是當月月初至今的單點彙總（TOTAL interval,非
  序列）——兩者資料形態本質不同（序列 vs 單點),前端不應用同一元件硬套。
  決策 3：Agent key 不存在於 registry 時整個請求回傳 404,在任何 Opik
  查詢之前就短路——代表這個端點沒有「部分資料 + 部分錯誤」的情境,AC5
  的「該區塊或整頁」在本端點只會落在「整頁」這一支（見下方決策 1）。
- `frontend/lib/generated/bff-types.ts`：`Grep("AgentCostBreakdownResponse
  |VersionCostSeriesEntry|TopTraceItem", ...)` 已命中——SDLCCT-47 合併
  時已重新跑過 `export_openapi.py` + `generate:types`,型別已存在,本票
  不需要像 SDLCCT-52 現狀查核那樣另外提醒 developer 補跑產生流程。
- `frontend/app/agents/page.tsx`：既有清單頁,目前 `AgentTable`/
  `AgentCardList` 兩個子元件各自把 `agent.key` 只當 React `key` prop
  用,整列（`<tr>`/`<li>`）完全沒有任何 `onClick`/`<Link>`/`cursor`
  樣式——本票是第一個讓這個清單頁「列可點擊」的故事（見下方決策 2）。
- `frontend/app/` 目前只有 5 個既有 `page.tsx`
  （`/`、`/settings/system`、`/cost-dashboard`、`/agents`、
  `/anomalies`）,**沒有任何既有的動態路由段**（`[param]`）——本票的
  `/agents/[key]` 會是這個 repo 第一個動態路由,沒有既有慣例可完全照搬,
  只能依 Next.js App Router 標準慣例（`params` prop）新增,並說明理由
  （見下方介面契約段落）。
- `frontend/lib/agents-api.ts`：既有「畫面專屬 API client」範例
  （`fetchAgentsList()` 回傳型別從 `@/lib/generated/bff-types` 的
  `components["schemas"]` re-export,函式本體只是 `fetchJson<T>(path)`
  薄包裝）。本票比照此結構新增 `frontend/lib/agent-detail-api.ts`。
- `frontend/lib/api-client.ts::fetchJson<T>(path)`：既有共用 fetch
  封裝（screen-agnostic,SDLCCT-39）,本票沿用,不新增第二套 fetch 邏輯。
  非 2xx（含 404/502）一律拋 `ApiError{endpoint, status, message}`。
- `frontend/lib/use-fetch-once.ts::useFetchOnce<T>(fetcher)`：既有
  per-section 資料抓取 hook（loading/error/success 三態 + `retry`）,本
  票沿用,一個頁面一個 instance（本端點是單次原子呼叫,回傳全部三個區塊
  的資料,沒有「各區塊各自 fetch」的情境,見下方決策 1）。
- `frontend/components/cost-overview/error-card.tsx::ErrorCard`：既有
  「整個請求失敗」三態渲染用元件,接受 `ApiError` 形狀的 prop,本票沿用
  於本端點唯一的失敗情境（404/502,見決策 1）。
- `frontend/lib/format.ts::formatCurrency`/`formatTaiwanDate`：既有展
  示層格式轉換慣例,本票沿用（`cost`/`value`/`total_estimated_cost`
  經 `formatCurrency`,`date`/`anchor_date`/`period_start` 經
  `formatTaiwanDate`）。
- `frontend/components/agents/sparkline.tsx` 其實不存在獨立檔案——
  `Sparkline` 元件目前定義在 `frontend/app/agents/page.tsx` 內（未抽成
  共用元件）,簽名吃 `{date: string, value: number|null}[]`。本票
  `version_cost_series[].points` 與 `top_traces` 都不是這個形狀（後者
  完全不是序列）,`model_cost_breakdown` 也不是序列,因此本票**不**從
  `agents/page.tsx` import 這個元件（它目前也不是 export 的）,而是依
  决策 3 手刻一個同風格的小型多序列折線圖,不重複發明視覺語言但也不跨
  頁面 import 一個頁面私有元件。
- `frontend/package.json`：確認**沒有**任何圖表函式庫依賴（`recharts`/
  `visx`/`chart.js` 等皆不存在）,與 SDLCCT-43 現狀查核結論一致——本票
  沿用 SDLCCT-43 已確立的「手刻 inline SVG,不為此新增圖表依賴」慣例
  （CONSTITUTION「規格模糊時不要過度設計」）。
- `frontend/lib/i18n/messages.ts`：既有巢狀中文字串物件 + `t()` helper,
  本票新增 `agentDetail` 命名空間,不更動既有任何命名空間（純附加）。
- `frontend/e2e/agents.spec.ts`：既有 Playwright 測試慣例——(1) 頁面載
  入後 `<header>`/`<h1>` 皆可見（`page.locator("header").getByText(...)`
  避免 sidebar 同文字造成 strict-mode 歧義）；(2) sidebar 連結導覽與
  `data-active` 驗證。本票新增 `frontend/e2e/agent-detail.spec.ts`,
  另外新增「清單頁點擊列導覽到 detail 頁」的測試改寫進
  `frontend/e2e/agents.spec.ts`（因為這是清單頁行為變更,不是 detail
  頁本身的行為,見下方介面契約段落）。
- 全 repo `Grep("toEqual|getComputedStyle|一致")` 只命中
  `frontend/AGENTS.md`（文件說明文字）與
  `frontend/lib/use-fetch-once.test.ts`（與樣式無關的 hook 單元測
  試）——**不存在**任何比較兩個元素 computed style 相等的既有測試,本票
  新增的畫面/元件（含清單頁新增的 cursor/hover 樣式、新 detail 頁）不
  會觸發任何跨元素樣式耦合測試鏈,本票的跨元素樣式耦合測試檢查不適用
  （與 SDLCCT-46/52 現狀查核結論一致）。

## 介面/API 契約

**前端呼叫既有端點,不新增/變更任何 bff 端點。**

```
GET /api/agents/{key}/cost-breakdown   （SDLCCT-47 已實作,本票原樣消費,不變更）

Response 200 (application/json):
{
  "key": "<agent key>",
  "display": "<registry 的 display 名稱>",
  "anchor_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD",
  "version_cost_series": [
    { "version": "<string>", "points": [ { "date": "YYYY-MM-DD", "value": <float>|null }, ... ] }
  ],
  "model_cost_breakdown": [ { "model": "<string>", "cost": <float>|null } ],
  "top_traces": [ { "id": "<string>", "total_estimated_cost": <float>|null, "metadata": {...}|null } ]
}

Response 404 (key 不存在於 registry): { "detail": "Agent '<key>' not found" }
Response 502 (任一底層查詢失敗): 既有 OpikClientError/OpikConfigError handler 形狀
```

### 路由與導覽（AC1）

- 新頁面 `frontend/app/agents/[key]/page.tsx`（Next.js App Router 動態
  路由段,`params: Promise<{ key: string }>`,Next 16 慣例,比照
  `frontend/app/settings/system/page.tsx` 之外本 repo 第一個動態路由；
  路徑字串本身沿用清單頁既有的 `/agents` 前綴,與 SDLCCT-43 決策 3 的
  `/agents` 命名風格延伸一致）。
- `frontend/app/agents/page.tsx` 的 `AgentTable`/`AgentCardList` 兩個
  子元件改為：整列可點擊,導覽到 `/agents/${agent.key}`。
  - 桌面表格（`AgentTable`）：`<tr>` 加上 `onClick={() =>
    router.push(\`/agents/${agent.key}\`)}`、`className="cursor-pointer
    hover:bg-gray-50"`、`tabIndex={0}`、`role="link"`、
    `aria-label={agent.display}`、`onKeyDown` 在 Enter/Space 時觸發同一
    個 `router.push`（鍵盤可及性——`<tr>` 不能是 `<a>`/`<Link>` 的合法
    子結構,這是 Next.js App Router 常見的「整列可點」寫法,比照一般
    React table-row-as-link 慣例,非本 repo 已有範例但沒有更貼合現有
    慣例的替代寫法）。
  - 窄螢幕卡片（`AgentCardList`）：`<li>` 內包一層
    `<Link href={\`/agents/${agent.key}\`} className="block">`,把原本
    `<li>` 內容整個包起來（`<li>` 本身允許合法的 block-level `<a>`
    子元素,不像 `<tr>` 需要特殊處理）。
  - 點擊目標是**整列**（不是某個特定欄位/按鈕）——spec AC1 只說「row
    is clicked」,沒有限定子區域,且整列可點是這個 repo 已有的視覺密度
    （8 欄表格/多欄卡片）下最直覺的點擊面積,不需要額外加一個「查看
    詳情」按鈕佔用版面（見下方決策 2）。
- `[key]` 的值即 `agent.key`（registry key,與 SDLCCT-47 的 path param
  `key` 同一值,不需要任何對照表）。

### 三個區塊的對應與渲染（AC2/AC3/AC4）

- `frontend/lib/agent-detail-api.ts`（新檔案,比照 `agents-api.ts`）：
  ```ts
  import { fetchJson } from "@/lib/api-client";
  import type { components } from "@/lib/generated/bff-types";

  export type AgentCostBreakdownResponse =
    components["schemas"]["AgentCostBreakdownResponse"];

  export function fetchAgentCostBreakdown(
    key: string,
  ): Promise<AgentCostBreakdownResponse> {
    return fetchJson<AgentCostBreakdownResponse>(
      `/api/agents/${encodeURIComponent(key)}/cost-breakdown`,
    );
  }
  ```
- `frontend/app/agents/[key]/page.tsx`：
  - `"use client"` + `useFetchOnce(() => fetchAgentCostBreakdown(key))`
    （`key` 來自 `useParams<{ key: string }>()`,App Router client
    component 標準取 route param 方式）。
  - `<header>`：與既有頁面同一寫法（左「Agent Control Tower」,右
    `formatTaiwanDate(state.data.anchor_date)` 成功時/
    `t("costOverview.header.unavailable")` 非成功時）。
  - `<main>`：
    - `loading`：骨架佔位（比照既有頁面 3-4 條骨架列,本頁三個區塊各
      一組骨架）。
    - `error`（`fetchAgentCostBreakdown()` 失敗——涵蓋 404「Agent 不存
      在」與 502「底層查詢失敗」兩種情境,**兩者都走同一個頁面層級
      `<ErrorCard>`**,見決策 1）：渲染既有 `<ErrorCard
      title={t("agentDetail.header.title")} error={state.error}
      onRetry={state.retry} />`,取代整個 `<main>` 內容（三個區塊都不
      渲染——AC5「絕不呈現 0/空白」在本端點的唯一失敗模式就是整頁失敗,
      見決策 1）。
    - `success`：依序渲染三個 `<section>`：
      1. `<h2>{t("agentDetail.versionSeries.title")}</h2>` +
         `VersionCostChart`（見決策 3）,吃
         `state.data.version_cost_series`（AC2）。
      2. `<h2>{t("agentDetail.modelBreakdown.title")}</h2>` +
         `ModelBreakdownTable`（簡單兩欄表格：`model`/`cost`,
         `cost === null` 顯示 `"—"`,不顯示 `0`——延續 SDLCCT-47 決策 2
         與 CONSTITUTION「缺值顯示 unknown,不可顯示 0」),吃
         `state.data.model_cost_breakdown`（AC3）。
      3. `<h2>{t("agentDetail.topTraces.title")}</h2>` +
         `TopTracesTable`（見決策 4）,吃 `state.data.top_traces`
         （AC4）。
  - `<footer>`：`{t("agentDetail.footer.dataSource")}`（比照既有頁尾
    資料來源說明句型）。

- `frontend/components/agent-detail/version-cost-chart.tsx`（新檔案）：
  - 表格 + inline SVG 折線圖雙呈現（見決策 3）：
    - 上半部：一張多序列折線圖（手刻 SVG,比照 `agents/page.tsx` 的
      `Sparkline` 手法延伸為多條 `<polyline>`,每個 `version` 一條線,
      顏色依索引輪替一組固定色票,圖例列出每個 `version` 字串對應顏色
      色塊),X 軸為所有 `points` 的 union 日期（已排序去重,因為
      SDLCCT-47 決策 1 保證同一回應內所有 version 共用同一組 7 天日
      期,union 僅為防禦性寫法,不假設後端永遠對齊）。`value === null`
      的點造成線段斷點（不連接、不當作 0——延續 `agents/page.tsx`
      `Sparkline` 已有的斷點邏輯)。
    - 下半部：一張明細表格,欄 = 版本 + 每個日期一欄,值經
      `formatCurrency`,`null` 顯示 `"—"`（圖表給視覺趨勢,表格給可追
      溯的確切數字——呼應 CONSTITUTION「每個數字必須可追溯回來源」,純
      圖表無法滿足,純表格不容易看出「跳增點」,AC2 的「to show when
      cost jumped」需要視覺變化,兩者互補,見決策 3）。

- `frontend/components/agent-detail/model-breakdown-table.tsx`（新檔
  案）：兩欄表格,`model`/`cost`（`formatCurrency`,`null→"—"`）。

- `frontend/components/agent-detail/top-traces-table.tsx`（新檔案）：
  - 欄：Trace ID（`id` 原樣顯示,單一不透明字串,不嘗試解析）/ 預估成本
    （`total_estimated_cost`,`formatCurrency`,`null→"—"`）/ 中繼資料
    （`metadata`,`null` 顯示 `"—"`,非 null 時顯示
    `JSON.stringify(metadata)` 置於 `<code className="text-xs
    break-all">`——`metadata` 是未型別化的 `dict`<!-- -->（SDLCCT-47
    決策 4：只有 `id`/`metadata` 本身被驗證存在,內容結構未經驗證),
    本票不嘗試從中挑選特定欄位渲染,避免對一個未定義結構做臆測,見決
    策 4）。
  - 每一 `<tr>` 加 `className="cursor-pointer hover:bg-gray-50"`
    **但不加任何 `onClick`/`<Link>`/`onKeyDown`**（AC4：視覺上可點擊,
    點擊不觸發任何導覽或 API 呼叫——與清單頁列的「真的可點」明確不同,
    這裡只有 CSS 層面的視覺暗示,刻意不做任何互動邏輯）。

- `frontend/lib/i18n/messages.ts`：新增 `agentDetail` 命名空間（只附
  加,不更動既有內容）,鍵名：`agentDetail.header.title`/
  `.versionSeries.title`/`.versionSeries.table.columns.version`/
  `.modelBreakdown.title`/`.modelBreakdown.table.columns.model`/
  `.modelBreakdown.table.columns.cost`/`.topTraces.title`/
  `.topTraces.table.columns.id`/`.topTraces.table.columns.cost`/
  `.topTraces.table.columns.metadata`/`.footer.dataSource`/`.unknown`
  （`"—"` 的集中文案key,供三個表格共用,不逐一手刻字面 `"—"`）。

### 新增/修改 e2e

- `frontend/e2e/agent-detail.spec.ts`（新檔案）：比照 `agents.spec.ts`
  慣例,mock `/api/agents/:key/cost-breakdown`（Playwright route mock），
  涵蓋 (1) 直接造訪 `/agents/<mock-key>` 載入成功時三個區塊標題與資料
  皆可見（AC2/AC3/AC4）；(2) `top_traces` 列具備 `cursor-pointer`/
  hover 樣式,但點擊後 URL 不變、且沒有送出任何新的 network request
  （AC4 的「不觸發導覽或 API 呼叫」——用 `page.on("request")` 計數在
  點擊前後不變來驗證,比單純檢查 DOM 沒有 `href` 更直接)；(3) mock
  404 時顯示明確錯誤卡片,不是空白頁（AC5,見決策 1）；(4) mock 502
  時同樣顯示錯誤卡片。
- `frontend/e2e/agents.spec.ts`：新增一條測試「清單頁點擊某一列可導
  覽到 `/agents/<key>`」（AC1）——放在既有檔案而非新檔案,因為這是清單
  頁本身行為的變更,與既有「sidebar 連結導覽」測試同屬清單頁的導覽行
  為類別,比照既有檔案組織慣例（一個頁面的導覽行為測試放在該頁面自己
  的 spec 檔）。

## 資料模型

無新增資料模型。本票純消費既有 `GET /api/agents/{key}/cost-breakdown`
回應（`AgentCostBreakdownResponse`,SDLCCT-47 已定案）,不新增/變更任
何 bff Pydantic 類別、資料表或欄位。前端新增的 TypeScript 型別
（`agent-detail-api.ts` 內的 re-export）皆從既有
`bff-types.ts`（openapi-typescript 產物,已含本端點型別）取得,不是獨
立定義的新資料模型。

## 關鍵技術決策

### 1. AC5「該區塊或整頁顯示錯誤卡片」在本端點只會落在「整頁」這一支,不實作獨立的 per-section 錯誤狀態

本端點（SDLCCT-47）是單一原子 HTTP 呼叫,三個區塊的資料全部包在同一
個 200 回應裡；唯一的失敗模式是整個請求失敗（404「key 不存在」或 502
「任一底層查詢失敗」,SDLCCT-47 決策 3/路由定義——404 檢查甚至在任何
Opik 查詢之前就短路,502 則是三個底層查詢中任一失敗就讓整個例外原樣往
上拋,不吞掉其中一個查詢的失敗再回傳部分結果）。因此本端點沒有「第一
區塊成功、第二區塊失敗」的情境可能發生,AC5 給出的兩個選項（「該區
塊」或「整頁」）由後端的原子性決定答案是「整頁」——這不是本文件發明
一個 AC 沒講的新產品決策,而是在 AC5 本身給出的兩個選項之間,依既有後
端行為做出的選擇（與 SDLCCT-52 決策 2 的「在 AC 給定選項間選擇,不是
發明新決策」同一精神）。`useFetchOnce` 一個頁面一個 instance 正是這
個決策的直接結果,不是偷懶省事。

### 2. 清單頁整列可點擊,不加獨立的「查看詳情」按鈕/連結文字

AC1 原文只說「a row is clicked」,沒有限定點擊必須命中某個特定子元
素。清單頁（`agents/page.tsx`）目前每列已經是 8 欄表格/多欄卡片,版
面已經相當密集,額外加一個按鈕欄位會擠壓既有欄位寬度,且對「FinOps
reviewer 快速點進任何一個 Agent 查看明細」這個使用情境而言,整列可點
的點擊面積明顯比塞進一顆小按鈕更符合可用性直覺（與 SDLCCT-43 決策 4
「一眼看出哪些需要優先處理」的整列掃視使用情境一致延伸——這裡是整列
點擊,同一種「以列為單位操作」的設計語言）。

### 3. version_cost_series 採「折線圖 + 明細表格」雙呈現,不是純圖表也不是純表格,且不引入圖表函式庫

AC2 的用詞是「cost-jump timeline」「to show when cost jumped」——這
需要使用者能一眼看出「哪個時間點、哪個版本開始變貴」,純表格（只有數
字）需要逐格比對才能看出跳增,不直覺滿足這個使用情境;但純圖表無法
讓使用者取得精確數字去追溯/回報（CONSTITUTION「每個數字必須可追溯回
來源」),也不利於 `null` 點的明確呈現（圖表上的斷點容易被誤讀為「沒
有這個版本」而非「這天這個版本的資料未知」)。因此選擇兩者並存:圖表
負責「一眼看出跳增」,表格負責「精確數字與可追溯性」。不引入
`recharts`/`chart.js` 等函式庫：`frontend/package.json` 現狀查核確認
目前零圖表依賴,資料規模（通常數個 version × 7 個點）与 SDLCCT-43
`Sparkline` 已經手刻解決的規模同等級,不足以證成新增一個前端依賴
（CONSTITUTION「規格模糊時不要過度設計」,比照 SDLCCT-43 決策/UI 原
型段落同一結論的延伸）。

### 4. top_traces 的 metadata 欄位用 `JSON.stringify` 原樣顯示,不嘗試解析特定欄位

`TopTraceItem.metadata` 型別是 `dict | None`——依 SDLCCT-47 決策 4,
`opik_traces.TraceSummary` 本身只對 `id`/`metadata` 做型別化保證,其
內容結構（`metadata` 底下有哪些 key）未被驗證過、也未被本票的 spec
要求呈現任何特定子欄位。挑選特定 key 顯示（例如假設一定有
`"user_id"`）會是對一個未定義結構做臆測,一旦後端實際資料不含該 key
就會顯示空白/`undefined`,違反「絕不呈現空白」的精神;因此採用最保守
的「完整原樣顯示」作法,開發成本也最低。

### 5. `/agents/[key]` 動態路由使用 Next.js App Router 標準 `params`/`useParams` 機制,不新增路由輔助層

本 repo 目前零動態路由先例,沒有既有慣例可完全照搬。Next.js App
Router 的動態路由段是框架本身提供的標準機制（檔案名 `[key]` 即聲明
路由參數),與本 repo 其餘頁面「檔案路徑即路由」的既有慣例（
`settings/system/page.tsx` → `/settings/system`）同一原則的直接延伸,
不需要額外的路由輔助層或自訂 hook。

## UI 原型

`docs/design/SDLCCT-48-prototype.html`（可直接在瀏覽器開啟的靜態
HTML,內嵌 `<style>`,套用與 `docs/design/SDLCCT-46-prototype.html`/
`SDLCCT-52-prototype.html` 相同的色彩/字級/間距 token,佔位資料清楚標
示為範例,非真實查詢結果）。涵蓋：
- 頁首：比照 `cost-dashboard`/`agents`/`anomalies` 頁面結構（固定
  `<header>` + 頁面標題/副標題,含 Agent `display` 名稱）。
- 清單頁列可點擊的視覺範例（AC1）：一列表格 row,hover 時背景變色、
  游標變成手型,旁邊註記文字說明「點擊整列導覽至 detail 頁」。
- version-split 折線圖區塊（AC2）：2-3 條不同顏色折線（對應 2-3 個
  version 字串）,其中一條線含一個明顯斷點（示範 `null` 點不內插、不
  當作 0）,圖表下方附一張對應的明細表格（版本 × 7 個日期欄,其中一格
  顯示「—」對應斷點的那個日期)。
- model-split 分解表格（AC3）：至少 3 個 model 列,其中一列 `cost`
  顯示「—」（示範 null 不顯示為 0）。
- top-cost trace 清單（AC4）：至少 3 列,每列附 hover 樣式範例（背景
  變色、游標手型),旁邊註記文字說明「視覺上可點擊,但目前點擊無任何
  動作（執行詳情畫面為未來故事)」,`metadata` 欄顯示一段範例 JSON 字
  串。
- 一個錯誤狀態範例（AC5,沿用既有 `ErrorCard` 樣式）：取代整個
  `<main>` 內容,文字示範「查詢失敗：`/api/agents/.../cost-breakdown`
  回應 404（Agent 'xxx' not found）」。

## 開放設計問題（定稿時必須為空）

（無）

## 本 Story 開發範圍判斷：維持單一 Story,不需依 docs/02 §6 再拆分

本票標題本身已標明「split from SDLCCT-44」——即在 Epic 規劃階段就已
經被拆成「SDLCCT-47 後端 cost-breakdown 端點」與「SDLCCT-48 前端
detail 畫面」兩張獨立票,本文件只需要判斷**這一張**（前端部分）自身
是否還需要再拆。比較對象：

- **SDLCCT-46**（預算模擬畫面規劃,單一新端點 + 一個新頁面 + 表單 +
  結果卡片）與**SDLCCT-52**（異常清單畫面,單一既有端點 + 一個新頁面
  + 一張表格 + 一個 banner 元件）兩者都被各自的架構師判定為「單一
  Story,不拆」。
- 本票的規模介於兩者之間：比 SDLCCT-52 多（三個區塊/三個子元件,而非
  一張表格;新增一個動態路由機制;修改既有清單頁的列互動行為)，但不
  需要任何表單輸入狀態管理（SDLCCT-46 有下拉選單 + 送出按鈕的表單狀
  態),也不需要新增任何 bff 端點（三者皆無,本票純消費 SDLCCT-47 已
  完成的單一端點)。三個區塊的呈現邏輯彼此獨立、不互相依賴渲染順序,
  屬於「同一個頁面 fetch 一次、拆成多個展示子元件」的既有模式（與
  `cost-overview` 頁面的 `SummarySection`/`PeriodSection` 兩個獨立
  section 同一模式),不是需要跨多個 PR 協調才能完成的規模。
- 清單頁的列可點擊改動（AC1）雖然碰到另一個既有檔案
  （`agents/page.tsx`),但改動本身只是加一個 `onClick`/`<Link>`
  包裝,不改動該頁既有的資料抓取、欄位、響應式版面邏輯,規模遠小於一
  個獨立 Story 的門檻。

結論：規模與 SDLCCT-46/52 同一量級（單一頁面 + 消費既有或新端點的資
料 + 數個展示子元件 + i18n + e2e),不需要依 docs/02 §6 再拆分,維持
單一 Story。
