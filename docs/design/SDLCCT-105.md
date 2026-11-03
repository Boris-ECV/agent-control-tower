# 設計文件 — SDLCCT-105 Agent 清單：既有欄位格式統一、淡色佔位文字、本期期間註腳

## 對應需求規格
G1 核准版本(見 ticket SDLCCT-105 描述與 Gherkin AC):
1. 「未登錄資料視覺區分」— `owner`/`budget` 為 null 時顯示佔位文字，並以淡色樣式與一般文字區分。
2. 「本期期間標示」— 表格下方顯示 `period_start`–`anchor_date` 期間註腳。
3. 「金額欄格式與對齊」— 預算、本期花費欄皆靠右對齊、套用千分位兩位小數格式。

依賴 SDLCCT-82（已 Done）提供的 `formatTableCurrency`、`formatDateRange`（`frontend/lib/format.ts`）。
範圍外：sparkline 合計、進度條（SDLCCT-107）、搜尋/篩選、預算消耗分子分母範圍一致性。

## 介面/API 契約
無新增/變更端點。沿用既有 `GET /api/agents`（`frontend/lib/agents-api.ts` `fetchAgentsList`），
回應型別 `AgentsListResponse`（`frontend/lib/generated/bff-types.ts`）已包含本票所需的所有欄位，
不需 bff 變更：

```ts
AgentsListResponse {
  agents: AgentRegistryEntry[];
  anchor_date: string;   // YYYY-MM-DD
  period_start: string;  // YYYY-MM-DD
}
AgentRegistryEntry {
  budget: number | null;
  budget_consumed_pct: number | null;
  current_period_spend: number;
  owner: string | null;
  // ...(其餘欄位不受本票影響)
}
```

`period_start`/`anchor_date` 目前已由 `fetchAgentsList()` 回傳但未被 `AgentsPage` 讀取/顯示 —
本票新增使用這兩個既有欄位，不新增型別。

## 資料模型
無新增資料模型。沿用 SDLCCT-82 已定義的 `AgentsListResponse`/`AgentRegistryEntry` schema。

## 關鍵技術決策

1. **AC3（金額欄格式/對齊）已由既有程式碼滿足，本票不需改動。**
   檢查 `frontend/app/agents/page.tsx` 的 `AgentTable`（90-152 行）與 `AgentCardList`
   （154-193 行）：`budget`（有值時）與 `current_period_spend` 兩欄在表格版皆已是
   `text-right tabular-nums` + `formatTableCurrency(...)`（第 113-116 行），卡片版的
   `<dd>` 亦同（第 172-178 行）；表頭 `<th>` 亦已有 `text-right`（第 95-96 行）。
   逐一核對後沒有遺漏的金額欄。理由：避免無依據改動已通過先前 story（SDLCCT-82/43）
   驗收的程式碼；本票僅在設計文件中記錄「已驗證合規」，developer 不需為此欄再動手。

2. **佔位淡色樣式採用既有 token `text-text-tertiary`，不新增 token/樣式。**
   `docs/design-system.md` 色票表已定義 `--color-text-tertiary`（`#667085`），對比度
   4.97:1（≥ AA 4.5:1，已由 `frontend/lib/design-tokens.contrast.acceptance.test.ts`
   鎖定）。表格一般資料文字的顏色來自 `body { @apply text-foreground }`（對應
   `--color-text-primary #1F2937`，見 `frontend/app/globals.css` 149-159 行）或顯式
   `text-text-primary`；`text-text-secondary`（`#475467`）已用於表頭/說明文字
   （例如 `<thead>` 的 `text-text-secondary`、`agents.footer.dataSource`）。
   `text-text-tertiary` 比 `text-secondary` 更淡、比表頭文字更不顯眼，且是目前色票表中
   唯一未被「一般資料文字」或「次要說明文字」佔用的既有語意色階，可與兩者都明顯區分，
   不需新增第三個色票。目前程式碫中唯一既有用法是 `app-sidebar.tsx` 的分類標題
   （次要語意色），語意與「佔位/未知值」相容（兩者都是「比一般內容更不重要的文字」）。
   **此為 SDLCCT-107（預算消耗%進度條）依賴的決策：同一欄（`budget`/
   `budget_consumed_pct` 為 null 時）沿用 `text-text-tertiary`，不要另外發明樣式。**

3. **期間註腳文案沿用 `costOverview.period.currentPeriod` 的括號包裹慣例，新增
   `agents.footer.period` i18n key，而非重用跨模組的 key。**
   `frontend/lib/i18n/messages.ts` 第 64 行已有慣例：
   `currentPeriod: (range) => \`本期花費（${range}）\``。本票新增
   `agents.footer.period: (range: string) => \`本期（${range}）\`}`，`range` 傳入
   `formatDateRange(period_start, anchor_date)` 的輸出（如 `10/1–10/31`），與
   `period-comparison-section.tsx` 第 62-71 行「標籤 + `formatDateRange(...)`」的呈現
   風格一致（該檔案同樣使用 `formatDateRange` 而非 `formatSlashDate` 來顯示期間區間）。
   不重用 `costOverview.period.*` key，因為那是 cost-dashboard 模組的 i18n 命名空間，
   跨模組共用 key 會讓兩個模組的文案意外耦合（例如未來 cost-dashboard 改字會誤動到
   Agent 清單）。

4. **期間註腳只渲染一次（非逐列），放在 `AgentTable`/`AgentCardList` 兩者之外、
   既有 `<footer>` 之前。**
   `period_start`/`anchor_date` 是整個清單共享的單一期間（非各 Agent 各自的期間），
   語意上屬於整個表格的註腳，不屬於任何一列；放在 `<section>` 內、兩種版面
   （table 與 card list，用 `md:table`/`md:hidden` 切換顯示但不會同時出現）共用同一個
   註腳元素之後，避免重複渲染兩次期間文字。

## UI 原型
見 `docs/design/SDLCCT-105-prototype.html`（可直接在瀏覽器開啟）。展示：
- 一列 owner/budget 皆有值（一般深色文字）。
- 一列 owner 為 null（顯示「未指定」，`text-text-tertiary` 淡色）、budget 為 null
  （顯示「未設定」，同樣淡色），與一般文字並列對照。
- 預算、本期花費欄靠右對齊、千分位兩位小數。
- 表格下方「本期（10/1–10/31）」期間註腳。

## 開放設計問題(定稿時必須為空)
無。
