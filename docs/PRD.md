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

## SDLCCT-8 — Reconciliation integration test against the backend

**使用者故事**
身為維護此 demo 資料集的開發者，我需要一個可重跑的 pytest 整合測試，比對 Opik 後端實際回傳的數字與產生器（seed/generate.py）預期產生的數字，使後端升級、重置或資料被誤動之後，能快速確認資料仍然對得上。

**驗收條件（Gherkin 情境名稱摘要）**
1. 未設定 OPIK_BASE_URL 時乾淨略過
2. 各專案每日成本對帳
3. 依版本與依廠區（plant）的成本對帳
4. 依模型的成本對帳
5. 夜間批次時段分布對帳
6. 錯誤率型態對帳
7. 延遲檢查與正確性檢查可分開判讀

**範圍外**
- 對後端寫入、刪除或重置任何資料
- 修改產生器情境內容
- 主機效能調整
- trace 總數核對、最貴 trace 清單、span tree 結構核對（現有 verify.py 有，但本工單範疇未列）
- 在 CI 中執行本測試
- seed/preflight.py 相關檢查

**規模預估**
<= 1 開發日。判斷為機械式搬移 verify.py 既有邏輯，非新邏輯設計；若搬移本身超出預期，建議拆分為「成本類對帳」與「錯誤率+延遲類對帳」兩票。

## SDLCCT-12 — Agent registry store

**使用者故事**
身為 BFF 的開發者，我需要一份以 `seed/catalog.py` 的 AGENTS 為唯一事實來源、可查詢的 Agent registry（欄位含 key、display、dept、dept_code、owner、budget、registered），使 Portal 的 Agent 清冊畫面與異常偵測能查到每個 Opik project 對應的顯示名、部門、負責人、月預算，以及是否已登錄。

**驗收條件（Gherkin 情境名稱摘要）**
1. 讀取 registry 回傳全部 9 個 Agent 及其完整欄位
2. 可查詢並區分「有花費但未登錄」的治理缺口案例（temp_supplier_scraper）
3. registry 的種子資料由 catalog.py 匯出，而非手動重複維護

**範圍外**
- 異常偵測／比對邏輯（屬 E4）
- 預算超支告警
- 新增或修改劇本內容
- 與治理查詢無關的模擬資料生成欄位
- 寫入介面是否實作，留給 G1b 架構師判斷

**規模預估**
<= 1 開發日

## SDLCCT-9 — Demo anchor date configuration

**使用者故事**
身為資料存取層開發者（下一張 Story：Opik 客戶端，以及任何時間窗查詢邏輯的實作者），我需要一個可在 seed/ 的 Python 程式碼中讀取、且有清楚記載的「演示錨點日」設定值（含預設值與覆寫機制），使所有「本月成本」「近 30 天趨勢」等查詢都能用同一個穩定的「今天」基準，不會因系統實際時鐘推進而讓資料集與查詢窗口對不上，且未來即使 BFF 改用非 Python 語言實作，也能照同一份契約讀到相同的值。

**驗收條件（Gherkin 情境名稱摘要）**
1. 讀取錨點日設定值（Python API），回傳帶 UTC tzinfo 的日期
2. 未設定環境變數 DEMO_ANCHOR_DATE 時使用固定預設值 2026-10-15T00:00:00+00:00（人類已於 SDLCCT-13 確認）
3. 以環境變數 DEMO_ANCHOR_DATE 覆寫錨點日
4. 環境變數格式不合法時明確報錯（而非靜默回退或回傳 None）

**範圍外**
- 畫面上可調整「演示日期」的 UI（屬 E3）
- UTC 轉顯示時區的轉換邏輯
- 決定 portal/API 層（BFF）技術選型（延至 SDLCCT-10 的 G1b）
- 修改 seed/generate.py 現有 CLI --anchor 預設行為本身（人類已於 SDLCCT-14 確認維持現狀，不在本票範圍）

**規模預估**
<= 1 開發日
## SDLCCT-10 — Opik read client: project metrics endpoints (explicit project ids, explicit error handling)

**使用者故事**
身為 Portal/BFF 開發者，我需要一層可重用、唯讀的 Opik 查詢客戶端，涵蓋「專案指標」端點（COST、TRACE_COUNT、TRACE_ERROR_RATE、SPAN_COUNT、SPAN_TOKEN_USAGE，可選擇依 metadata key / tags / name 拆分），且強制呼叫端明確傳入 project id、對後端失敗明確拋出錯誤、並使用 SDLCCT-9 的演示錨點日作為時間窗基準，使之後所有畫面與資料存取都能安全重用同一套規則，不會因為忘記傳 project id 而把已刪除專案的殘留資料一併加總，也不會把查詢失敗誤顯示成「沒有花費」。

**驗收條件（Gherkin 情境名稱摘要）**
1. 未傳入 project id 時直接拒絕，不送出 HTTP 請求
2. 傳入明確單一或多個 project id 成功取得指標
3. 後端 HTTP 錯誤、逾時、非預期格式時明確拋出錯誤，不回傳 0 或空值
4. 每次請求都帶上 Comet-Workspace 標頭
5. 查詢時間窗以演示錨點日（SDLCCT-9）為基準，而非系統時鐘
6. 成本缺少必要欄位時保留為 null，不可當作 0
7. 可依 metadata key、tags 或 name 拆分指標；支援全部五種指標名稱

**範圍外**
- 不對 Opik 執行任何寫入
- 不含任何快取（SDLCCT-11 處理）
- /workspaces/costs、/projects/stats、/projects/{id}/kpi-cards、/spans/stats、trace 搜尋端點（已拆分為 SDLCCT-15/16/17）
- BFF/API 層的語言與框架選擇（延至本票 G1b）

**規模預估**
<= 1 開發日（原票已拆分為 4 張 Story）
## SDLCCT-11 — Caching layer for Opik queries

**使用者故事**
身為 Portal 使用者，我需要重複查詢同一組參數時立即拿到結果而不必每次重新打 Opik 後端，使在主機 CPU 被節流、單次查詢延遲偏高的環境下，操作體感不受拖累，且不需要等主機升級或額度恢復。

**驗收條件（Gherkin 情境名稱摘要）**
1. 快取未命中時照常呼叫後端並寫入快取
2. 完全相同參數組合的快取命中不重新呼叫後端
3. 不同參數組合不會互相命中快取
4. 快取項目失效後重新呼叫後端（TTL 或明確 invalidate）
5. 快取寫入失敗不影響本次查詢結果
6. 快取讀取失敗時視為未命中，退回呼叫後端，後端錯誤不被掩蓋

**範圍外**
- 不解決主機本身效能問題
- 不做分散式或跨行程共享快取
- 不處理即時資料觸發告警的情境
- 不快取 SDLCCT-15/16/17 尚未存在的端點（只快取 SDLCCT-10 已完成的 `get_project_metrics()`）
- 不決定快取實作細節（TTL 時長、快取後端型態、快取 key 結構，留給 G1b 架構師）

**規模預估**
<= 1 開發日
