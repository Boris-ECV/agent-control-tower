# 設計文件 — SDLCCT-109 成本標籤（原「模型成本分解」）欄位標題與維度分組

## 對應需求規格

G1 核准版本（拆分自 SDLCCT-86，依 `ui review/design-changes-v2-.md` 第二章
第 4 節「成本標籤（原『模型成本分解』）」小節）。2 條 Gherkin AC：

1. 畫面渲染完成後，欄位標題顯示「維度／標籤／成本」；目前所有資料皆為
   `model` 維度，全部顯示在同一個 `model` 分組內；每筆金額皆為兩位小數。
2. 後端回應目前只提供 `model` 維度資料時，畫面不得顯示「環境」或「團
   隊」的空分組或錯誤訊息。

**範圍與修正方向**（spec 原文）：
- 欄位標題「模型」→「維度／標籤／成本」。
- 依維度分組顯示，組之間用較深分隔線區隔。
- 金額統一兩位小數（沿用既有 `formatTableCurrency`，確認不回歸）。
- **本票僅實作「model」這一個維度**（已依 HUMAN-INPUT SDLCCT-112 選項 B
  定稿；「環境」「團隊」維度在目前資料模型下無對應 tag/metadata key，
  資料來源未定，拆為後續票，不在本票範圍）。

**範圍外**：環境／團隊維度分組（資料層缺口，待後續票）；版本成本時間
序列圖表（SDLCCT-81 已處理）；最貴執行清單（SDLCCT-110/111）。

**依賴**：SDLCCT-82（Done，金額格式 `formatTableCurrency`）。

## 現狀查核（實作前已逐字讀取的既有程式碼）

- `frontend/components/agent-detail/model-breakdown-table.tsx`：目前是
  純 2 欄表格（`model`／`cost`），單一 `<tbody>`，無分組邏輯；
  `cost === null` 顯示 `"—"`，不顯示 `0`（見 `docs/design/SDLCCT-48.md`
  「三個區塊的對應與渲染」段落，決策延續自 SDLCCT-47 決策 2）；金額經
  `formatTableCurrency`（已是兩位小數格式，見下方決策 3）。
- `frontend/lib/generated/bff-types.ts::ModelCostBreakdownEntry`：欄位
  僅 `{ model: string; cost: number | null }`，**沒有**任何 `dimension`
  / `tag` 欄位——後端回應本身不帶維度資訊，目前唯一能推得的維度就是
  「這整個端點回傳的就是 model 維度資料」（spec 背景與範圍段落已明確
  定案：環境/團隊維度在現有資料模型下無對應來源）。本票不新增/變更
  bff schema（見下方資料模型段落）。
- `frontend/components/agent-detail/agent-detail-content.tsx`：
  `<section>` 外層 `<h2>` 文字為 `t("agentDetail.modelBreakdown.title")`
  = 「模型成本分解」。spec 的「範圍與修正方向」四條只列欄位標題/分組/
  金額格式/維度範圍，**未列**將此 `<h2>` 區塊標題文字改為「成本標
  籤」——「成本標籤」只出現在 ticket 背景段落作為這張票在 Epic 拆分中
  的**子範圍命名**（呼應 `design-changes-v2.md` 的章節小標），不是
  「範圍與修正方向」列出的修正項目，Gherkin AC 也未斷言此文字。本票
  不更動這個 `<h2>` 文字，維持「模型成本分解」（見下方決策 1；若後續
  需要統一改名，屬於另一個未在本票 AC 範圍內的產品決策）。
- `frontend/lib/i18n/messages.ts` 第 164-172 行
  `agentDetail.modelBreakdown.table.columns`：既有 `model`/`cost` 兩個
  鍵，本票只改 `model` 鍵對應的文字內容，不新增/刪除鍵名（沿用既有
  i18n 結構慣例，純附加/修改文案，不動既有其他命名空間）。
- `frontend/e2e/currency-rollout.acceptance.spec.ts`
  第 94-110 行：既有「agent detail: model, top-trace and version
  fallback tables are 2-decimal, right-aligned」測試，直接斷言
  `model_cost_breakdown` 的 cost 欄位格式（`US$ 1,300.13` 樣式、靠右、
  `tabular-nums`）——本票不得回歸此測試（即不可移除/改變 cost 欄位本身
  的渲染邏輯，只能改動 model 欄位標題文字與外層分組容器）。
- 全 repo `Grep("toEqual|getComputedStyle|一致")`（依流程第 4 步規
  則，跨元素樣式相等斷言檢查）：命中的 `toEqual`/`getComputedStyle`
  斷言（`agents.spec.ts`、`agent-detail.spec.ts`、
  `currency-rollout.acceptance.spec.ts` 等）比較對象皆為「某元素的
  computed style 與一個固定期望值（如 `textAlign: "right"`、
  `fontVariantNumeric` 含 `"tabular-nums"`）」，或「同一元素在不同狀態
  下的位移/顏色」，**沒有一個**是「比較本票要改動的選擇器（model 欄位
  標題、cost 欄位儲存格）與另一個元件的 computed style 是否相等」的
  鏈式耦合測試。本票不觸發跨元素樣式耦合測試鏈，此檢查不適用（與
  SDLCCT-48/110 現狀查核結論一致）。

## 介面/API 契約

無。本票不新增/變更任何 bff 端點或回應格式，純前端消費既有
`GET /api/agents/{key}/cost-breakdown` 回應中的 `model_cost_breakdown`
欄位（型別不變）。

## 資料模型

無新增資料模型。`ModelCostBreakdownEntry` 維持 `{ model, cost }` 不
變；「維度」在本票是前端顯示層的靜態概念（目前永遠是 `"model"` 這一
個值，見決策 2），不是後端回應的欄位。

## 關鍵技術決策

### 1. 不更動區塊 `<h2>` 標題文字（維持「模型成本分解」，不改成「成本標籤」）

spec「範圍與修正方向」四條列出的修正項目只涵蓋欄位標題/分組/金額格
式/維度範圍，不含區塊標題文字；Gherkin 兩條 AC 也都只斷言欄位標題文
字與分組/金額格式，未斷言區塊 `<h2>` 文字。「成本標籤」一詞只出現在
ticket 背景段落，用於描述這張票在 Epic 拆分中的子範圍名稱（呼應
`design-changes-v2.md` 章節小標），不是規格明文要求的文案修正項目。
依 CONSTITUTION「規格模糊時不要過度設計 / 做規格要求的，不自己加
碼」，本票不擴大解讀去改動一個 AC 未斷言、「範圍與修正方向」也未列出
的文字，避免發明一個規格沒講的產品決策。

### 2. 「維度」在元件內以靜態常數 `"model"` 標記每一筆 entry，不新增通用的多維度分組資料結構

後端回應（`ModelCostBreakdownEntry`）本身不帶維度欄位，且本票明確只
處理 `model` 一個維度（HUMAN-INPUT SDLCCT-112 選項 B 已定稿，環境/
團隊維度的資料來源尚未確認，非本票範圍）。依 CONSTITUTION「Prefer
three similar lines over a premature abstraction」與「Implement only
what the spec requires」，不預先搭建一套「依維度列表動態產生分組」
的通用機制（例如預先列舉 `["model", "env", "team"]` 再逐一渲染，遇到
沒有資料的維度就跳過）——這種寫法反而要特別處理「空維度不顯示」的
邊界條件，且是為了一個尚未確定資料形狀的未來故事預先搭基礎設施。改
為最直接的寫法：元件內把傳入的 `entries`（`ModelCostBreakdownEntry[]`）
視為單一一組「model 維度」資料，整組渲染在同一個分組容器內。AC2
「不顯示環境/團隊的空分組」因此是程式碼結構的自然結果（程式碼裡根本
不存在列舉其他維度的邏輯），不是額外加一個 if 判斷去隱藏空分組。未
來若新增第二個維度（例如 env），再由那張票依實際資料形狀決定如何擴
充本元件的分組邏輯（可能改為真正的 `groupBy`），本票不預先設計。

### 3. 金額格式維持現狀使用 `formatTableCurrency`，本票只需回歸驗證，不修改格式化邏輯

讀取 `frontend/lib/format.ts::formatTableCurrency` 與既有元件程式碼
確認：cost 欄位目前已經是兩位小數（`US$ 1,300.13` 樣式），且
`currency-rollout.acceptance.spec.ts` 已有測試覆蓋格式、對齊、
`tabular-nums`。spec 本身也寫明「目前已符合，本票僅需確認不回歸」。
本票不修改 `formatTableCurrency` 或 cost 欄位的渲染程式碼，只在開發
完成後重跑既有 `currency-rollout.acceptance.spec.ts` 確認未回歸。

### 4. 分組容器用一層 `<div>`／`<table>` 外框包住整組 `model` 列，分組間的「較深分隔線」規則本票不產生可見效果（只有一組）

spec「依維度分組顯示，組之間用較深分隔線區隔」描述的是多組情境下的
樣式規則；本票資料永遠只有一組（`model`），分組之間的分隔線沒有第二
組可供分隔，因此視覺上不會出現額外的粗分隔線（表格本身既有的外框/
`border-border` 已足以界定這一組的邊界）。本決策只是記錄「規則本身
在單一分組情境下必然不產生可見效果」，不是元件層面新增一條沒人看得
到的樣式規則；若後續故事新增第二個維度，該故事需要在渲染多組時加上
組間 `border-b-2 border-border`（或等效的較深分隔線樣式），本票不預
先實作這條在目前永遠用不到的樣式規則（見決策 2 的 scope 理由）。

## UI 原型

`docs/design/SDLCCT-109-prototype.html`（可直接在瀏覽器開啟的靜態
HTML，套用 `docs/design-system.md` 色彩/字級/間距 token，與既有
`SDLCCT-48-prototype.html`/`SDLCCT-110-prototype.html` 同一視覺語
言）。涵蓋：
- 區塊標題維持「模型成本分解」（決策 1）。
- 表格欄位標題：第一欄「維度／標籤／成本」、第二欄「成本」（靠右）。
- 至少 4 筆 model 維度資料列（如 `gpt-4o`、`claude-3-opus`、
  `gpt-3.5-turbo`、`gemini-pro`），全部在同一個分組容器內，無任何組
  間分隔線（因只有一組，見決策 4）。
- 其中一列 `cost` 顯示「—」，示範 `null` 不顯示為 `0`（既有行為，確
  認不回歸）。
- 其餘列金額皆為兩位小數格式（`US$ 1,234.56` 樣式）、靠右、等寬數字
  字體。
- 旁註文字說明：「範例資料僅示意，實際資料來自後端 API」、「目前僅有
  model 維度，環境／團隊維度待後續故事補資料來源後再開發」。

## 開放設計問題（定稿時必須為空）

無。
