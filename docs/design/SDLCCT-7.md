# 設計文件 — SDLCCT-7 資料產生器的決定性測試

## 對應需求規格
對應 G1 已核准的需求規格「SDLCCT-7 資料產生器的決定性測試」。範圍：在固定
`anchor`、固定 `scale`（沿用 `catalog.SCALE`）下，對 `seed/generate.py` 的
`generate(anchor, scale)` 執行兩次乾跑並比較回傳的 manifest，驗證：
(1) 整個 manifest 深度相等、(2) 每個 Agent 每日 traces/spans 計數相等、
(3) 每個 Agent 每日成本字串相等、(4) 依 `registry` 的 `budget_usd` 算出的
「30 天總成本 vs 預算」比較結果（含已登錄/未登錄艦隊總和）相等。不連線後端、
不需任何環境變數、不修改 `catalog.py` 情境內容。

## 介面/API 契約
本 Story 不新增對外 HTTP 介面，測試純粹呼叫既有的 Python 函式：

- 待測函式：`seed/generate.py::generate(anchor: datetime, scale: int) -> tuple[Collector, dict]`
  - 測試只需要回傳 tuple 的第二個元素（`manifest: dict`），`Collector` 物件
    （含 `traces`/`spans` 完整列表）不是本 Story 的比較對象——manifest 本身
    就不包含逐筆 trace/span 內容，只包含 `totals.traces`/`totals.spans`
    兩個計數，所以「不對個別 trace/span 做跨執行相等性斷言」（範圍外）與
    「manifest 完全相等」兩者天然相容，不需額外過濾欄位。
  - manifest 的既有欄位（供測試斷言用，沿用 `generate()` 目前的實作，不新增
    欄位）：`anchor`（str, ISO8601）、`scale`（int）、`seed`（str）、
    `history_days`（int）、`totals.{traces,spans}`（int）、`incidents`
    （list[dict]，逐字複製 `catalog.INCIDENTS`）、`registry`（list[dict]，
    每個 Agent 一筆，含 `project`/`budget_usd`/`registered` 等欄位）、
    `projects.<agent_key>.daily.<YYYY-MM-DD>`（dict，含
    `cost`/`traces`/`spans`/`calls`/`prompt_tokens`/`completion_tokens`，
    其中 `cost` 是 `str(Decimal)`）、以及 `projects.<agent_key>.by_model` /
    `by_version` / `by_plant` / `hourly_cost`（本 Story 驗收條件未要求逐項
    斷言，但隨「manifest 完全相等」的整體比較一併覆蓋）。
- 測試檔案位置：`seed/tests/test_generate_determinism.py`（符合
  project-profile 的 `test_layout: seed/tests/`，且 `seed/pyproject.toml` 的
  `[tool.pytest.ini_options]` 已將 `testpaths` 指向 `tests`，不需改動設定）。
- 測試用固定參數：
  - `anchor = datetime.fromisoformat("2026-01-01T00:00:00+00:00")`
    （沿用規格範例時間點；用 `+00:00` 而非 `Z` 尾碼純粹是避開寫法差異，
    時間值不變）。
  - `scale = SCALE`（從 `catalog` 匯入，不自行硬編另一個數字，對應規格
    「沿用 catalog.SCALE」）。
- 執行方式：`cd seed && uv run pytest -q`（沿用 project-profile 既有指令，
  不新增指令）。

## 資料模型
無新增資料模型。`generate()` 回傳的 manifest 結構維持現狀，本 Story 不修改
`catalog.py`／`generate.py` 的任何資料欄位或計算邏輯，只新增測試檔案。

## 關鍵技術決策
- **manifest 深度相等直接用 Python `==` 比較，不寫自訂 deep-equal helper**：
  manifest 在 `_stats()` 裡已把 `Decimal` 轉成 `str`，其餘欄位皆為
  dict/list/str/int 等可雜湊基本型別，`dict.__eq__` 本身即遞迴比較，足以
  滿足「深度比較」要求，不需額外抽象。
- **每日 traces/spans 計數、每日成本、總成本 vs 預算三個情境各自獨立成一個
  test function，而不是只寫一個「manifest == manifest」的測試**：對應
  CONSTITUTION「Every acceptance criterion maps to at least one automated
  test」——雖然它們在資料上是整體 manifest 相等的子集，但分開斷言能讓之後
  若只有某個子集被破壞時，失敗訊息直接指向對應的驗收條件，不用從一個大
  diff 裡反推。
- **「總成本 vs 預算」比較結果由測試自行從 `manifest["projects"][*]["daily"]`
  加總、對照 `manifest["registry"][*]["budget_usd"]` 算出，不去呼叫
  `generate.py` 的 `summarize()`**：`summarize()` 目前只把比較結果印到
  stdout，沒有回傳結構化資料可供斷言；而規格這一條本身就是「比較兩次執行
  各自算出的結果是否一致」，不是「驗證比較結果等於某個預先寫死的數字」，
  因此在測試裡用純函式重新計算、對兩次 manifest 各算一次再比較，不需要改動
  `generate.py` 來外露新的回傳值（避免 Story 範圍外的生產程式碼變更）。
- **測試直接呼叫 `generate(anchor, scale)`，不經過 `main()`/CLI
  (`argparse`)/`save()`**：決定性要驗證的是純計算（`day_count`、
  `cohorts`、`Collector.emit` 等），走 CLI 只會多引入檔案 I/O 與參數解析的
  不確定性面，對應 CONSTITUTION「Deterministic generators are tested by
  running them twice and comparing results」——兩次呼叫同一個純函式，不透過
  進程邊界。
- **不需要重設任何全域亂數狀態**：`generate()` 內的 `random.Random(f"{SEED}
  |{a.key}|{d}")` 是每次呼叫都用相同字串重新建構的區域 RNG 實例，不依賴
  Python 全域 `random` 模組的狀態，所以同一個測試行程裡呼叫兩次
  `generate()` 本身就是獨立、可重現的，不用在測試裡做任何重置動作。
- **`uuid7_at()` 內部使用 `os.urandom`（非決定性）不影響本 Story**：
  trace/span 的 `id` 確實每次執行都不同，但這些 id 只存在於
  `Collector.traces`/`Collector.spans`（tuple 的第一個回傳值），從未寫入
  manifest dict；manifest 裡的 `totals.traces`/`totals.spans` 只是數量，因此
  manifest 相等不受 `uuid7_at()` 的隨機性影響，不需要在測試裡 mock/patch
  `os.urandom` 或 `uuid7_at`。

## UI 原型
無，本 Story 不涉及前端 UI（純粹新增 `seed/` 底下的 pytest 測試，不涉及任何
畫面、元件或樣式變更）。

## 開放設計問題(定稿時必須為空)
（無）
