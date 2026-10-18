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

## SDLCCT-15 — Opik read client: workspace/project summary endpoints

**使用者故事**
身為 Portal/BFF 開發者，我需要延續 SDLCCT-10 已建立的共用 Opik 唯讀客戶端慣例（明確 project id 強制、型別化錯誤、Comet-Workspace 標頭、SDLCCT-9 演示錨點日），把 `/workspaces/costs`、`/projects/stats` 這兩個已在 seed/verify.py 驗證過的摘要端點封裝起來，使之後 Portal 畫面（E3）需要的工作區成本、專案統計資料都能安全重用同一套規則，不會因為忘記傳 project id 而把已刪除專案的殘留資料一併加總，也不會把查詢失敗誤顯示成「沒有花費/沒有資料」。

**驗收條件（Gherkin 情境名稱摘要）**
1. 未傳入 project id 時拒絕查詢（兩個端點皆適用），不送出 HTTP 請求
2. 傳入明確 project id 成功取得對應資料；`/projects/stats` 並確認不混入回應中其他未被要求的專案
3. 後端 HTTP 錯誤、逾時、非預期格式時明確拋出型別化錯誤，不回傳 0 或空值
4. 每次請求都帶上 Comet-Workspace 標頭
5. 查詢時間窗以演示錨點日（SDLCCT-9）為基準，而非系統時鐘

**範圍外**
- 不對 Opik 執行任何寫入
- 不新增或變更 Portal 對外的 HTTP 路由
- `/projects/{id}/kpi-cards`（repo 內無已驗證形狀，已移出，另開 SDLCCT-18）
- `/spans/stats` 與 trace 搜尋端點（SDLCCT-16/17）
- 快取（留給未排程的後續故事）
- BFF/API 層技術選型（已於 SDLCCT-10 的 G1b 決定）

**規模預估**
<= 1 開發日

## SDLCCT-17 — Opik read client: trace search endpoint (sort by cost)

**使用者故事**
身為 Portal/BFF 開發者，我需要一個封裝好的唯讀函式可以查詢「依 total_estimated_cost 排序」的 trace 清單，使之後上層（Portal 畫面或 BFF 其他模組）可以組出「最貴 trace」清單類的功能，而不必各自重新處理 Opik 的 /v1/private/traces 請求細節、Comet-Workspace 標頭與錯誤處理。

**驗收條件（Gherkin 情境名稱摘要）**
1. 查詢某專案依 total_estimated_cost 由高到低排序的 trace 清單
2. 未指定 project_name 時拒絕查詢、不送出 HTTP 請求
3. 後端非 2xx 回應或逾時時明確拋型別化錯誤，不回傳空清單掩蓋
4. 一律帶 Comet-Workspace 標頭

**範圍外**
- trace 樹（span tree）組裝邏輯放哪一層（留給 G1b 架構師）
- 依 metadata 篩選的 trace 搜尋（無已驗證形狀，已移出，另開 SDLCCT-20）
- /v1/private/spans 本身的查詢
- 對 Opik 執行任何寫入
- 快取（TTLCache 已存在於 SDLCCT-11，本票不套用）
- 多頁分頁迴圈

**規模預估**
<= 1 開發日

## SDLCCT-23 — Guard seed generator writes against existing-data overwrite

**使用者故事**
身為維護 seed/generate.py 的開發者，我需要 main() 既有的「已存在資料拒絕覆寫、--force 可明確繞過」防護邏輯有自動化測試覆蓋，讓這個落實 CONSTITUTION.md 原則的程式碼不會在未來修改中被意外破壞而不被發現。

**驗收條件（Gherkin 情境名稱摘要）**
1. 無 --write 時只落 dry-run manifest，完全不觸碰後端
2. 有既存 project 且未帶 --force 時拒絕寫入（回傳碼 2）
3. 有既存 project 且帶 --force 時正常送出
4. 無既存 project 時帶 --force 為 no-op，行為與不帶 --force 相同

**範圍外**
- 不修改 generate.py::main() 的防護邏輯本身
- 不修改 catalog.py 情境內容
- 不涉及 Portal/BFF/Agent 清冊資料庫
- 不涉及伺服器或部署
- 不測試 generate()/Collector/cohorts() 本身（已有既有測試覆蓋）
- 不針對 manifest 檔案內容做斷言

**規模預估**
<= 1 開發日

## SDLCCT-26 — Convert preflight.py pricing reconciliation into a skip-if-no-backend integration test

**使用者故事**
身為維運此 seed 工具的工程師，我想要把 preflight.py 的定價對帳邏輯轉成可重跑的 pytest 整合測試，以便能像 SDLCCT-8 的 test_reconciliation.py 一樣，在有真實 Opik 後端時驗證定價正確性、無後端時乾淨略過，不再需要手動執行腳本。

**驗收條件（Gherkin 情境名稱摘要）**
1. 未設定 OPIK_BASE_URL 時乾淨略過（SKIPPED）
2. 有定價的模型，實際成本與期望成本一致時測試通過（容差 < 1e-9）
3. 不在定價表中的模型，成本為 None 或 0 時測試通過
4. 某模型實際成本超出容差時測試失敗並指出是哪個模型
5. 無論測試成功或失敗，throwaway 專案都會被清除

**範圍外**
- preflight.py 腳本本身是否繼續保留可獨立執行留待設計文件決定
- 是否需要額外清理機制留待設計文件決定
- 不修改 generate.py 或情境內容
- 不涉及 Portal/BFF/Agent 清冊資料庫
- 不涉及伺服器或部署
- 不在 CI 中啟用此測試
- 不要求重複利用 verify.py 的 metric/parse helper

**規模預估**
<= 1 開發日

## SDLCCT-24 — Unit-test client.py's pure helpers and required-env-var contract

**使用者故事**
身為維護 seed 腳本的開發者，我想要 client.py 的純邏輯函式（iso()、uuid7_at()、load_prices()）與 base_url() 的必填環境變數契約都有單元測試覆蓋，以便能安全重構/變更這些共用函式，並確認「未設定 OPIK_BASE_URL 時應直接失敗、不送網路請求、不悄悄回退預設值」這條原則有可驗證的保證。

**驗收條件（Gherkin 情境名稱摘要）**
1. iso() 將 datetime 轉為帶毫秒精度、Z 結尾的 UTC ISO8601 字串
2. uuid7_at() 依傳入時間遞增產生可字典排序的字串
3. load_prices() 正確解析 model_prices.snapshot.json 並回傳 Decimal 區間
4. base_url() 在 OPIK_BASE_URL 未設定時以 SystemExit 失敗且不送出任何請求
5. base_url() 在 OPIK_BASE_URL 為空字串或僅含空白時同樣以 SystemExit 失敗
6. base_url() 在設定有效值時原樣回傳（去除尾端斜線）

**範圍外**
- 不修改資料產生器情境內容
- 不涉及 Portal/BFF/Agent 清冊資料庫
- 不涉及伺服器或部署
- 不測試 api()（薄組合，測試它等同重複測試 base_url()）
- 不處理 save()/load()/project_ids()
- coverage omit 清單異動為本票產出的一部分

**規模預估**
<= 1 開發日

## SDLCCT-25 — Unit-test ingest.py's retry-and-backoff logic with a mocked transport

**使用者故事**
身為維護 seed/ingest.py 的開發者，我想要用 httpx.MockTransport（或等效 monkeypatch）為 post_all() 的重試/退避邏輯補上單元測試，以便在不呼叫真實 Opik 伺服器的情況下，確保失敗情境明確出錯，避免未來重構時悄悄破壞重試行為。

**驗收條件（Gherkin 情境名稱摘要）**
1. 前兩次 503 後第三次 200 成功
2. 非可重試狀態碼（400）立即失敗
3. 連續 5 次失敗後放棄
4. 第 5 次（最後一次嘗試）成功仍算數
5. 第一次就成功，無延遲
6. 連線層例外（httpx.TransportError）與 HTTP 狀態碼共用重試機制

**範圍外**
- 不修改資料產生器情境內容
- 不涉及 Portal/BFF/Agent 清冊資料庫
- 不涉及伺服器或部署
- 不測試 size 參數的分批（chunking）邏輯本身
- 不測試 print 進度輸出

**規模預估**
<= 1 開發日

## SDLCCT-27 — Day-over-day baseline comparison helper + context-bloat detection rule

**使用者故事**
身為負責異常偵測邏輯的開發者，我想要一個可重用的「近N日基準比較」共用元件，並用它實作「avg prompt token/trace 持續攀升」（context bloat）規則，以便用 Demo 資料集中 maintenance_copilot 的真實攀升模式驗證規則能正確判定，且輸出含可解釋的基準/實際/偏離數字，供未來其他異常規則重用。

**驗收條件（Gherkin 情境名稱摘要）**
1. 純函式正確計算基準比較
2. Demo 資料集中 context_bloat 被正確偵測（deviation_ratio 大於等於 1.30，依公式約1.9倍）
3. 其餘 8 個 agent 不被誤報（deviation_ratio 小於 1.30）
4. 輸出包含具體數字（baseline_value/actual_value/deviation_ratio/pct/baseline_days_used）
5. 可用資料天數不足時明確反映、零資料時拋例外
6. 門檻值邊界（恰為 1.30）視為異常

**範圍外**
- 不含畫面呈現（E3）
- 不含自動處置/暫停 Agent
- 不含 AI 產生說明文字
- 不含 SPAN_TOKEN_USAGE 以外的拆解

**規模預估**
<= 1 開發日

## SDLCCT-31 — Governance-gap (unregistered agent) anomaly detection rule

**使用者故事**
身為平台治理負責人，我想要系統交叉比對 seed/registry.py 的登錄狀態（registered/owner/budget）與 Opik 逐日花費紀錄，自動標記出未登錄、無負責人或無預算卻持續產生花費的 Agent，以便我能在人工審核前就先定位治理缺口，不必逐一手動比對 9 個 Agent 的登錄表與帳單。

**驗收條件（Gherkin 情境名稱摘要）**
1. 標記 temp_supplier_scraper 為治理缺口
2. 8 個已登錄 Agent 不被誤報
3. 輸出包含判斷依據的具體數字
4. project_ids 為空時拋出例外
5. Opik 無花費資料時仍可依 registry 旗標標記

**範圍外**
- 不含前端畫面呈現
- 不含自動處置（停用/通知/工單）
- 不含 AI 產生說明文字
- 不含「逐日花費持續成長」獨立門檻值

**規模預估**
<= 1 開發日

## SDLCCT-28 — Model-switch cost spike detection rule

**使用者故事**
作為 FinOps/維運人員，我想要系統自動偵測某 agent 的 model tag 從低成本模型切換為高成本模型、但交易量未明顯變化的情況，以便在模型升級造成成本暴增被發現前及時收到異常提示。

**驗收條件（Gherkin 情境名稱摘要）**
1. 偵測 order_status 的真實 model 切換日（switch_date 對應第九天，deviation_ratio≈21.0，遠超門檻3.0）
2. 其餘八個agent不應被標記為 model_switch 異常（全程只使用單一 model tag，switch_date 永遠為 null）
3. 異常輸出必須攜帶具體證據，不可只回報布林值（switch_date/before_model_tag/after_model_tag/before_cost_per_trace/after_cost_per_trace/deviation_ratio/deviation_threshold 皆非 None）
4. 查詢窗口內若找不到 dominant tag 改變的日期（回報 is_anomalous=false，相關欄位皆為 null）

**範圍外**
- 不新增任何 Opik 後端 endpoint
- 不包含告警、通知或 UI 呈現
- 不處理同一天同一 agent 混用兩種以上 model tag 的情況
- 不做跨 agent 的規則
- 不做成本預測或趨勢預測，僅做歷史事實偵測
- 不回溯超過可查詢資料窗口（HISTORY_DAYS=30）之前的資料

**規模預估**
預估一個開發日內可完成

## SDLCCT-29 — Tool-retry-loop anomaly detection rule

**使用者故事**
身為負責異常偵測邏輯的開發者，我想要新增一個「同日錯誤率與 spans/trace 比值同步異常攀升」偵測規則，用 Opik 的 TRACE_ERROR_RATE 與 SPAN_COUNT/TRACE_COUNT 比值比對 Agent 自身基準，以便用 Demo 資料集中 quality_rca 的真實重試迴圈事件驗證規則能正確判定，且不誤報其餘八個 agent（包含僅單一訊號異常、未同步出現的情境）。

**驗收條件（Gherkin 情境名稱摘要）**
1. 偵測 quality_rca 的真實重試迴圈事件（avg spans/trace 偏離比約2.09，error_rate約0.03，co_occurred為true）
2. 其餘八個agent不被誤報（含僅單一訊號異常的情境，例如 procurement_rfq 的 night_batch_burst 事件日僅流量異常但 error_rate=0）
3. 輸出含具體證據（error_rate、comparison.deviation_ratio、co_occurred）
4. 門檻邊界（ratio恰為1.5且error_rate恰為0.01時視為異常）

**範圍外**
- 不含前端畫面呈現
- 不含自動處置（停用/通知/工單）
- 不含 AI 產生說明文字
- 不含跨 agent 關聯分析
- 不含即時串流或多日趨勢或嚴重度分級

**規模預估**
<= 1 開發日

## SDLCCT-30 — Nighttime batch burst anomaly detection rule

**使用者故事**
身為負責異常偵測邏輯的開發者，我想要新增一個「非營業時段流量暴增」偵測規則，用 Opik 的 TRACE_COUNT（HOURLY）比對 Agent 自身基準小時流量，並以 metadata.workflow 作為佐證，以便用 Demo 資料集中 procurement_rfq 的真實夜間批次重跑事件（d=4, UTC17:00-19:00, 600筆）驗證規則能正確判定，且不誤報其餘8個 agent。

**驗收條件（Gherkin 情境名稱摘要）**
1. 偵測 procurement_rfq 的真實夜間暴增（ratio約290-353，遠超門檻10）
2. 其餘8個agent不被誤報（最大比值約1，margin>=9）
3. 輸出含具體證據與佐證metadata（off_hours_trace_count=600、baseline_hourly_rate、ratio、corroborating_workflow="rfq_batch_rerun"）
4. project_ids為空時拋出例外（MissingProjectIdsError，不回傳猜測值）
5. 門檻邊界（ratio恰為10時視為異常）

**範圍外**
- 不含前端畫面呈現
- 不含自動處置（停用/通知/工單）
- 不含 AI 產生說明文字
- 不含 workflow metadata 佐證本身作為獨立判異門檻
- 不含離峰時段窗口本身的自動偵測/推斷

**規模預估**
<= 1 開發日

## SDLCCT-33 — UI visual design system finalization (docs/design-system.md)

**使用者故事**
身為之後所有 Portal UI Story 的開發者，我想要 docs/design-system.md 的骨架被填成一份可直接套用的具體規範（色彩、字體、字級階層、間距 scale、RWD 斷點、對齊、元件規則、無障礙基本要求、token 落地方式、套用範圍策略），以便後續每一張 UI Story 不需要重新決定視覺語言。

**驗收條件（Gherkin 情境名稱摘要）**
1. 色彩系統章節填妥且符合對比度要求
2. 字體與字級階層填妥
3. 間距、RWD 斷點、對齊、元件規則填妥
4. 無障礙基本要求為可機器檢查的具體條款
5. Token 技術落地方式與套用範圍策略填妥
6. 文件不再含任何 TODO 佔位

**範圍外**
- 任何畫面的實際程式碼實作
- 客戶品牌色/Logo
- 既有頁面的回溯套用

**依賴**
- 無其他 Story 依賴
- 本票是 SDLCCT-32 等後續所有 UI Story 的前置依賴

**規模預估**
<= 1 開發日

## SDLCCT-32 — Cost overview screen (Portal MVP, screen 1 of 6)

**使用者故事**
身為工廠主管，我想要打開 Portal 第一眼就看到本月成本 vs 預算總覽、預估月底超支金額、以及跨 Agent 期間比較誰漲最多，以便我能立刻判斷本月是否超預算、該優先關注哪個 Agent。

**驗收條件（Gherkin 情境名稱摘要）**
1. 本月成本 vs 預算總覽數字可追溯且不為假資料
2. 未登錄 Agent 的花費計入總花費但不計入預算消耗
3. 跨 Agent 期間比較顯示誰漲最多
4. 畫面「今天」依展示錨點日換算為台灣時間顯示
5. 後端查詢失敗時明確顯示錯誤，不得呈現 0 或空白
6. 介面語言與品牌限制
7. G1b 原型可獨立於瀏覽器開啟

**範圍外**
- 其他 5 個畫面
- 真實的告警建立、預算編輯等寫入流程
- 登入/權限/多租戶
- /projects/{id}/kpi-cards 或 metadata 篩選 trace 搜尋（SDLCCT-18、SDLCCT-20，無關）
- 客戶品牌色與 Logo
- bff/ 對外 HTTP 路由的通用架構設計

**依賴**
- 依賴 SDLCCT-33（視覺規範須先定稿才能實作）
- 依賴 SDLCCT-9、SDLCCT-10、SDLCCT-11、SDLCCT-12、SDLCCT-15（全部已 Done）
- 不依賴 SDLCCT-18、SDLCCT-20
- 架構備註：bff/ 目前僅有 Python 函式庫，尚無對外 HTTP 路由，本票設計階段需新增第一個對外介面

**規模預估**
<= 1 開發日（已拆出 SDLCCT-33 為獨立前置票）

## SDLCCT-34 — Portal shell: sidebar navigation (wraps Cost Dashboard)

**使用者故事**
身為工廠主管，我希望打開 Portal 時看到依 L1 觀測／L2 治理／L3 介入分層的專業側欄導覽（即使多數項目目前尚無功能），而不是目前只有單一畫面的頂部 navbar，這樣我能理解 Portal 未來的完整功能範圍，並能順暢使用目前唯一功能完整的成本儀表板。

**驗收條件（Gherkin 情境名稱摘要）**
1. 側欄結構與分組正確
2. Cost Dashboard 包裝後功能不變
3. 目前畫面在側欄中被標示
4. 七個無功能項目點擊不產生任何導向或互動
5. Settings System 為可導航的空白頁
6. 套用既定 design-system token 無新色彩或間距
7. 語言與品牌限制
8. G1b 原型可獨立開啟

**範圍外**
- 其餘 5 個畫面的實際內容
- Policy Engine／Approval Workflow／Pause Agent／Kill Switch 的任何真實業務邏輯
- Settings／System 頁面的實際設定功能
- 側欄收合展開等進階互動
- 登入／權限／多租戶
- 客戶品牌色與 Logo

**依賴**
- 依賴 SDLCCT-32（Done）、SDLCCT-33（Done）
- 架構備註：frontend/app/globals.css 的 --sidebar* 系列 CSS 變數目前仍是 shadcn 預設的獨立 oklch 值，未如 --background／--accent 一樣別名指向既有的 5 個 design-system token，此為 G1b 架構設計階段必須處理的具體決策

**規模預估**
中等，預估可於一個開發日內完成，不拆分（側欄元件加入、既有頁面重構進新外殼、新增空白路由三者高度耦合）。

## SDLCCT-36 — 側欄在 md 斷點以下無響應式行為

**使用者故事**
身為在手機或小尺寸平板（寬度小於 768px）上使用 Agent Control Tower 的使用者，我希望側欄導覽在窄螢幕下不要固定佔用版面寬度，並有明確的方式可以開關它，這樣我在窄螢幕上仍能看到完整的內容區域，且需要時仍能使用側欄導覽。

**驗收條件（Gherkin 情境名稱摘要）**
1. 窄螢幕（< 768px）下側欄預設不佔用固定版面寬度
2. 窄螢幕下有可用的觸發按鈕（SidebarTrigger）可開啟/收合側欄
3. 桌面寬度（>= 768px）下側欄維持現有固定展開樣式不變
4. 側欄分組、項目內容、7 個無功能項目行為不受本次修正影響

**範圍外**
- 側欄分組結構、9 個項目文字內容、7 個無 href 項目行為（SDLCCT-34 已核准範圍，不重新開放）
- 其他畫面（Cost Dashboard 以外）的響應式設計
- 收合模式選型（offcanvas vs icon）與觸發按鈕放置位置（留給 G1b 原型決定）
- 收合狀態是否持久化（localStorage 等，不預設需求）

**依賴**
- 關聯 SDLCCT-34（修正範圍是該票當時刻意排除的部分），不依賴其後續工單
- 與 SDLCCT-38、SDLCCT-39（改動 cost-overview-api.ts）無檔案層級衝突，可並行處理

**規模預估**
小，核心改動集中於 `frontend/components/layout/app-sidebar.tsx`（與可能的 `layout.tsx` 微調），shadcn 元件已內建大部分收合邏輯，可於一個開發日內完成，不拆分。

## SDLCCT-42 — 新增前端 lint/build CI job

**使用者故事**
身為維護此專案 CI 流程的工程師，我希望在 `.github/workflows/ci.yml` 新增一個與現有 `bff`/`quality` job 對稱的 `frontend` job，自動執行 `npm run lint` 與 `npm run build`，這樣前端程式碼的 lint/build 回歸能在每個 PR 被 CI 自動攔截，不再依賴人工重跑確認綠燈。

**驗收條件（Gherkin 情境名稱摘要）**
1. 新 frontend job 的結構（runs-on、working-directory、checkout、Node 設定）與現有 job 對稱
2. job 執行 `npm run lint` 與 `npm run build`，任一失敗即讓該步驟/job 回報失敗
3. job 在既有 PR 流程中正確觸發，並回報對應的綠燈/紅燈
4. 不含任何單元測試或 e2e 測試步驟（測試工具鏈屬 SDLCCT-40 範疇）
5. 不要求對已合併的 Story（SDLCCT-32、34、35、41）做任何回溯動作

**範圍外**
- 單元測試/e2e 測試導入與工具鏈選型（SDLCCT-40 範疇）
- 對已合併 PR 的回溯補做
- 修改既有 `quality`/`bff` job 行為（除對稱風格所需的最小調整外）

**依賴**
- 不依賴其他待辦票；與 SDLCCT-40 互補，非前置依賴

**架構備註**
- 本票 PR 必定修改 `.github/workflows/ci.yml`，屬 `config/gates.yaml` `protected_paths_untouched` 列出的保護路徑，依 CLAUDE.md 規則 10(b)，其 G2 將自動升級為 manual gate。

**規模預估**
很小，單一檔案新增一個對稱 job，可於一個開發日內完成，不拆分。

## SDLCCT-40 — 決定並建置前端測試工具鏈（單元 + e2e）

**使用者故事**
身為負責前端畫面 Story 的開發者與測試者，我希望有一套已選定、已設定好且有示範測試可運作的單元測試與 e2e 測試工具鏈（含 CI 整合與判斷準則文件），這樣未來需要真正互動邏輯的畫面（例如預算與節省模擬）可以直接寫自動化測試，而不必在那張畫面卡住時才臨時決定工具與規則。

**驗收條件（Gherkin 情境名稱摘要）**
1. 單元測試工具鏈可運作（示範測試針對 use-fetch-once.ts 或另一個既有簡單元件，斷言行為而非實作細節）
2. e2e 測試工具鏈可運作（示範測試驗證既有畫面的可觀察行為）
3. project-profile.yaml 新增 frontend 單元測試與 e2e 測試的 commands 項目
4. CI 執行新的前端測試指令，e2e 執行策略需於設計文件載明理由
5. frontend/AGENTS.md 記錄「何時必須寫測試／何時可宣告不需要 e2e」判斷準則
6. 既有 lint/build 檢查不因此回歸

**範圍外**
- 不為 SDLCCT-32/34 補寫測試
- 不要求達成覆蓋率門檻
- 不要求示範測試覆蓋任何未來畫面的具體功能
- 不決定 CI 之外其他環境的測試執行方式
- 不修改既有 frontend_lint/frontend_build 指令行為

**依賴**
- 依賴 SDLCCT-42（已 Done，提供 frontend CI job 基礎），不構成待辦依賴

**架構備註**
- 本票範圍必定修改 `project-profile.yaml` 與 `.github/workflows/ci.yml`，兩者皆為 G2 的保護路徑，G2 將依規則 10(b) 自動升級為人工核准。單元/e2e 測試框架最終選型、CI 觸發策略留給 G1b 架構師決定並記錄理由。

**規模預估**
小到中等，單一 story 不拆分，預估可於一個開發日內完成。
