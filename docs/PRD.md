# 產品需求文件（PRD）

本文件為活文件（living document）。每個story通過 G1 gate 後，其需求以獨立章節追加於此，內容源自已核准的需求規格。未標示「(implemented)」的章節表示已核准、尚未完成開發。

所屬 Epic：SDLCCT-1「E1 Foundation and baseline」（Epic 描述待 orchestrator 提供）

## SDLCCT-7 — Deterministic test for the seed data generator

**使用者故事**
身為負責對帳與 Demo 重現性的工程師，我希望 `seed/` 產生器在固定種子（seed）、固定 anchor 日期與固定 scale 下，重複執行時輸出完全一致，使 Portal 顯示的每個數字都能回溯到同一份可重現的 manifest，讓對帳與 Demo 具有意義。

**驗收條件（Gherkin 情境名稱摘要）**
1. 相同參數下兩次乾跑產生完全相同的 manifest
2. 每個 Agent 的 trace 數與 span 數在重複執行下一致
3. 每日成本在重複執行下一致
4. 總成本與預算比較在重複執行下一致

**範圍外**
- 任何連線後端的測試
- 修改情境內容（catalog.py 中的 Agent、事件、金額、INCIDENTS）
- UI、伺服器、部署；不涉及 e2e
- 對個別 trace/span 的逐筆內容做跨執行相等性斷言（本質不可重現，且不影響 manifest 決定性）
- 效能/壓力測試

**規模預估**
<= 1 開發日
