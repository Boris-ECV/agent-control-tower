# 設計文件 — SDLCCT-35 側欄導覽標籤：移除英文前綴，改為純中文

## 對應需求規格
對應 G1 已核准的需求規格:側欄導覽標籤目前顯示「英文+中文」併排
（例如「Cost Dashboard 成本儀表板」），應改為「純中文」（例如
「成本儀表板」）。根因:`frontend/components/layout/app-sidebar.tsx`
的 `NAV_GROUPS` 陣列中,全部 13 個 `label` 欄位都寫成「英文前綴 +
中文」字串。修正範圍僅限把這 13 個 `label` 字串改為純中文,其中 2 個
保留外來語「Agent」（「Agent 清單」「暫停 Agent」,這兩個本來就是
正確格式,不再更動）。不涉及路由、無功能項目點擊無反應、樣式等任何
其他行為變更。requirements-analyst 已於 Jira 留言確認
`NAV_GROUPS`（第 32–55 行）逐字對應本票 AC,且 `docs/design/
SDLCCT-34.md` 不需修正。

## 現狀查核（實作前已讀取的既有程式碼）
- `frontend/components/layout/app-sidebar.tsx` 第 32–55 行:
  `NAV_GROUPS` 常數,4 組（Overview/Governance/Action/Settings）共
  13 個 label 字串（4 個 group label + 9 個 item label）,全部是
  「英文 + 空格 + 中文」併排。本故事只改這 13 個字串的*值*,不改
  陣列結構、不改 `NavItem`/`NavGroup` 型別、不改 `href` 欄位、不改
  `AppSidebar` 元件的渲染邏輯（第 57–96 行完全不動）。
- `docs/design/SDLCCT-34.md`「關鍵技術決策 7」:導覽資料是純靜態
  常數,不做成可設定/可擴充框架——本故事延續此決策,純文字值替換,
  不引入新的資料結構或抽象層。
- 本 repo 目前沒有 `tests/e2e/` 目錄（`Glob("**/tests/e2e/**")`
  無結果,與 SDLCCT-34 設計文件查核結果一致）,因此不存在任何比較
  兩個元素 computed style 相等的既有測試;本故事也完全不觸碰樣式/
  CSS,跨元素樣式耦合測試檢查不適用。

## 介面/API 契約
無——本故事不涉及任何對外介面/API 變更。純前端 UI 字串常數修正,
不新增、不移除、不修改任何 HTTP 端點、request/response 格式或狀態碼。

## 資料模型
無新增資料模型。`NavItem`/`NavGroup` 型別定義（`app-sidebar.tsx`
第 22–30 行）完全不變,只改其中 13 個字串*值*,不是資料模型變更。

## 關鍵技術決策

### 1. 13 個 label 字串的 Before → After 對照表
逐字對照 Jira 票面已定稿文字,開發者直接依此表修改,不需自行判斷
譯名:

| 位置 | Before（現狀,英文+中文併排) | After（純中文) |
|---|---|---|
| Overview group label | `Overview 總覽` | `總覽` |
| Cost Dashboard item | `Cost Dashboard 成本儀表板` | `成本儀表板` |
| Governance group label | `Governance 治理` | `治理` |
| Agent Registry item | `Agent Registry Agent 清單` | `Agent 清單` |
| Anomalies & Alerts item | `Anomalies & Alerts 異常與告警` | `異常與告警` |
| Budget & Savings Simulation item | `Budget & Savings Simulation 預算與節省模擬` | `預算與節省模擬` |
| Policy Engine item | `Policy Engine 政策引擎` | `政策引擎` |
| Approval Workflow item | `Approval Workflow 核准流程` | `核准流程` |
| Action group label | `Action 操作` | `操作` |
| Pause Agent item | `Pause Agent 暫停 Agent` | `暫停 Agent` |
| Kill Switch item | `Kill Switch 緊急關閉` | `緊急關閉` |
| Settings group label | `Settings 設定` | `設定` |
| System item | `System 系統` | `系統` |

理由:這是規格已逐字定案的對照表,不是本設計自行決定的譯名
（CONSTITUTION「規格模糊時不要過度設計/implement only what the
spec requires」）；兩個保留「Agent」外來語的項目（Agent 清單、
暫停 Agent）維持原樣,不額外「中文化」,因為票面明文指出這兩個是
正確格式。

### 2. 修改範圍僅限字串值,不重構陣列或型別
不把 13 個字串抽成獨立的 i18n 字典檔、不新增 `label_en`/`label_zh`
雙欄位、不引入任何 i18n 函式庫。理由:規格只要求「英文+中文併排」
改成「純中文」,沒有要求多語系支援;比照 CONSTITUTION「scope
discipline」與 `docs/design/SDLCCT-34.md`「決策 7」已定案的「純
靜態常數,不做通用框架」原則,不為未被要求的多語系需求預先設計
抽象層。

### 3. 不修改 `AppSidebar` 元件渲染邏輯、不新增/刪除測試斷言目標
`group.label`/`item.label` 在第 70、80、85 行被直接渲染為文字節點,
修改字串值後這三處渲染邏輯自動套用新文字,不需任何程式碼結構變更。
理由:字串值變更與渲染邏輯是正交的,維持「只改必要的那一行」降低
diff 面積與審查成本。

## UI 原型
無需新增原型檔案。本故事不是「新增或變更前端 UI 結構/版面配置/
樣式」,而是在 SDLCCT-34 已核准、已有靜態原型
（`docs/design/SDLCCT-34-prototype.html`）證明過結構的側欄元件上,
單純置換 13 個既有導覽項目的*文字內容*——視覺結構、版面、間距、
顏色、互動行為（無功能項目點擊無反應、current-page indicator）
全部沿用 SDLCCT-34 原型已展示的樣式,沒有任何新的畫面狀態需要人類
在瀏覽器中額外審視。改附上方「關鍵技術決策 1」的 before/after 文字
對照表,足以讓人類在 G1b 審核時逐字核對 13 個字串的新舊差異,比
重新產出一份幾乎與既有原型外觀完全相同的 HTML 檔案更直接、更不會
掩蓋真正要審的內容（文字本身）。此判斷亦符合 CONSTITUTION「Design
docs stay in proportion to the story: a small change gets a short
design」。

## 開放設計問題（定稿時必須為空）
（無）
