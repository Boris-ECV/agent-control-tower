# 設計文件 — SDLCCT-107 Agent 清單：預算消耗進度條

## 對應需求規格
G1 核准版本(見 ticket SDLCCT-107 描述與 Gherkin AC):
1. 在 `AgentTable`/`AgentCardList` 的「預算消耗%」欄，百分比數字旁加上水平進度條，
   寬度對應 `budget_consumed_pct`（clamp 到 0–100%）。
2. `budget_consumed_pct` 為 null（預算未設定）時，不渲染進度條，只顯示佔位文字。
3. 消耗 ≥100% 時進度條使用警示色（比照 `summary-section.tsx` 的 danger 配色），
   <100% 使用一般色。

依賴 SDLCCT-82（已 Done，`summary-section.tsx` 的進度條視覺慣例）。
本票與 SDLCCT-105 共用「預算消耗%」欄的 null 分支：**SDLCCT-105 已定案**
null 佔位文字樣式用既有 `text-text-tertiary`，本票沿用、不重新定義（見下方決策 2）。
範圍外：淡色佔位樣式本身的定義、搜尋/篩選、sparkline 合計、預算消耗分子分母範圍一致性。

## 介面/API 契約
無新增/變更端點。沿用既有 `GET /api/agents`（`frontend/lib/agents-api.ts`
`fetchAgentsList`），回應型別 `AgentsListResponse`/`AgentRegistryEntry`
（`frontend/lib/generated/bff-types.ts`）已包含本票所需欄位，不需 bff 變更：

```ts
AgentRegistryEntry {
  budget: number | null;
  budget_consumed_pct: number | null;  // null 僅在 budget 為 null/0 時出現
  // ...(其餘欄位不受本票影響)
}
```

後端不變性（`bff/api/agents.py` 第 97-98 行）：
```python
budget_consumed_pct = (
    current_period_spend / budget * 100 if budget else None
)
```
即 `budget_consumed_pct is None` 與 `budget is None`（或 0）**恆等**，兩者
一對一對應 —— 這是決策 2 能把本欄 null 文案安全對齊 `agents.unknownBudget`
的依據，不是臨時假設。

## 資料模型
無新增資料模型。沿用既有 `AgentsListResponse`/`AgentRegistryEntry` schema
（SDLCCT-82/105 已定義）。

## 關鍵技術決策

1. **進度條元件直接搬用 `summary-section.tsx` 的 `Card` 進度條片段
   （`h-1.5 rounded-full` 容器 + inline `style={{width}}` 填充條），抽成
   `frontend/components/common/progress-bar.tsx` 的共用小元件，而非在
   `agents/page.tsx` 內重寫一份。**
   理由：SDLCCT-82 已定案此視覺慣例（容器 `h-1.5 w-full overflow-hidden
   rounded-full bg-gray-100`；填充 `h-1.5 rounded-full` + `bg-accent`
   一般色 / `bg-red-600` 警示色；寬度 `Math.min(100, Math.max(0, pct))%`），
   表格欄位空間較窄，沿用同一組 class 與 clamp 邏輯可保證兩處視覺一致，
   抽成共用元件避免未來任一處改動又要手動同步兩份程式碼（現有
   `summary-section.tsx` 的進度條目前是 `Card` 的私有實作，抽出後
   `summary-section.tsx` 本身可改為呼叫新元件，但這屬於重構、非本票 AC
   要求，故本票僅新增元件、不強制回頭改 `summary-section.tsx`，留給
   developer 視工時決定是否同時重構；不影響本票驗收）。

2. **`budget_consumed_pct` 為 null 時，佔位文字沿用既有
   `t("agents.unknownBudget")`（"未設定"）+ `text-text-tertiary`，不新增
   i18n key、不新增樣式。**
   理由：如上「介面/API 契約」所述，null 與 `budget` 欄的 null 一對一對應，
   語意上就是「預算未設定」，重用同一句文案與 SDLCCT-105 定案的
   `text-text-tertiary` 淡色，避免同一列相鄰兩欄（預算欄、預算消耗%欄）
   在同一筆資料上出現兩種不同措辭或顏色造成閱讀不一致；也避免違反
   SDLCCT-105 的決策（該文件明確標註「本欄位為 SDLCCT-107 依賴的決策」）。
   目前 `AgentTable`/`AgentCardList` 對 `budget_consumed_pct` 是呼叫
   `formatPercent(...)`（回傳 `"—"`、無特殊樣式），本票改為：null 時渲染
   `<span className="text-text-tertiary">{t("agents.unknownBudget")}</span>`
   並省略進度條；非 null 時維持 `formatPercent(...)` 數字顯示（本票不改
   既有數字格式，只加進度條），不渲染 tertiary 樣式。

3. **≥100% 的 clamp 與配色直接複用 SDLCCT-82 的門檻（`pct > 100` ≡
   danger），而非另外定義「120% 算超出多少才算警示」之類的子規則。**
   理由：AC 明確給了 45%（一般色）與 120%（警示色、填滿 100% 寬度）兩個
   例子，數值本身已確定門檻在 100；`summary-section.tsx` 第 68 行
   `overBudget = (summary.budget_consumed_pct ?? 0) > 100` 是同一專案內
   唯一既有的「消耗%轉警示色」邏輯，沿用可與 cost dashboard 的視覺語言
   保持一致，避免同一數字在不同頁面呈現不同警示門檻語意。

## UI 原型
見 `docs/design/SDLCCT-107-prototype.html`（可直接在瀏覽器開啟）。展示：
- 一列 `budget_consumed_pct = 45`：數字旁一般色（`bg-accent`）進度條，填滿 45%。
- 一列 `budget_consumed_pct = 120`：數字旁警示色（`bg-red-600`）進度條，
  填滿 100% 寬度（clamp）。
- 一列 `budget = null`（`budget_consumed_pct = null`）：不顯示進度條，
  僅顯示 `text-text-tertiary` 的「未設定」佔位文字，與上兩列並列對照。

## 開放設計問題(定稿時必須為空)
無。
