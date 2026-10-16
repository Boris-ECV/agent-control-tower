# 設計文件 — SDLCCT-8 針對後端的對帳整合測試

## 對應需求規格
對應 G1 已核准的需求規格「Reconciliation integration test against the backend」。
範圍：新增一份可重跑的 pytest 測試檔，在 `OPIK_BASE_URL` 已設定時，比對
Opik 後端實際回傳的數字與 `seed/generate.py::generate()` 乾跑重新產生的
manifest，涵蓋六個情境：(1) 未設定 `OPIK_BASE_URL` 時乾淨略過且不發出任何
HTTP 請求、(2) 各專案每日成本對帳、(3) 依版本與依廠區成本對帳、(4) 依模型
成本對帳、(5) 夜間批次時段分布對帳（`procurement_rfq`）、(6) 錯誤率型態
對帳（`quality_rca`），以及延遲判定與正確性判定分屬獨立 test function、互不
影響結果。對後端的寫入/刪除、產生器情境內容、CI 執行、`preflight.py`、
trace 總數/最貴 trace/span tree 核對（verify.py 現有但本工單未列入範疇）均
為範圍外，不在本設計中處理。

## 介面/API 契約
本 Story 不新增對外 HTTP 介面；新增的是 pytest 測試呼叫既有的
`seed/client.py`、`seed/verify.py`、`seed/generate.py` 函式去呼叫既有的
Opik 後端私有 API（沿用 `verify.py` 現有呼叫方式，不新增、不變更任何端點
或 request/response 格式）：

- 測試檔案位置：`seed/tests/test_reconciliation.py`（符合
  project-profile 的 `test_layout: seed/tests/`，沿用 SDLCCT-7 的目錄慣例，
  `seed/pyproject.toml` 的 `testpaths` 已指向 `tests`，不需改動設定）。
- 執行方式：`cd seed && uv run pytest -q`（project-profile 既有指令，不新增
  指令）。
- 略過條件：模組最上層加一行
  `pytestmark = pytest.mark.skipif(not os.environ.get("OPIK_BASE_URL", "").strip(), reason="OPIK_BASE_URL not set")`。
  細節見「關鍵技術決策」。
- 重用 `seed/verify.py` 既有的查詢建構函式與常數，不重寫查詢邏輯：
  `TOL_DAY`（`1e-7`）、`TOL_TOTAL`（`1e-5`）、`SLOW_MS`（`3000`）、
  `timed(label, fn)`、`parse(s)`、`by_day(resp_json)`、
  `series_totals(resp_json)`、`metric(c, pid, mt, start, end, interval, breakdown)`。
  這些都是純函式／純常數，`import verify` 本身不會發出任何網路請求
  （`verify.py` 的 `main()` 只在 `if __name__ == "__main__"` 底下執行）。
- 使用到的既有後端端點（原樣沿用，不新增欄位、不變更 method/path）：
  - `POST /v1/private/workspaces/costs`（每日成本，帶 `project_ids` 清單）
  - `GET /v1/private/projects`（`project_ids()`，取得 project name → id）
  - `POST /v1/private/projects/{project_id}/metrics`
    （`metric_type=COST`, `interval=TOTAL`,
    `breakdown={"field":"metadata","metadata_key":"deployed_version"}` /
    `"plant"` / `breakdown={"field":"tags"}`；以及
    `metric_type=COST, interval=HOURLY` 給夜間批次情境）
  - `POST /v1/private/projects/{project_id}/metrics`
    （`metric_type=TRACE_ERROR_RATE, interval=DAILY`，給 `quality_rca`）
- 挑選受測專案：規格的 Gherkin 用字是「某個 agent 專案」（單數），不要求
  對 manifest 裡所有 9 個 agent 專案都跑一輪（那是 verify.py 現有行為，但
  本工單驗收條件未要求，逐一跑超出本故事範圍）。設計選定：
  - 每日成本／依版本／依廠區／依模型四個情境固定用同一個代表專案
    `PROCUREMENT_PROJECT = "procurement_rfq"`（剛好與夜間批次情境共用，
    減少額外的 project id 查詢與認知負擔，且該專案在 manifest 裡的
    `by_version`/`by_plant`/`by_model`/`daily` 欄位都是 `generate()`
    對每個 agent 一致計算出的通用欄位，不是只有特定情境才有）。
  - 夜間批次情境固定用 `procurement_rfq`、錯誤率情境固定用
    `quality_rca`——這兩個是規格原文明確點名的專案，不做選擇。
- Request/response 形狀：與 `verify.py` 現有呼叫完全相同，不重新定義。

## 資料模型
無新增資料模型。本 Story 不修改 `catalog.py`／`generate.py`／後端資料；
`generate()` 回傳的 manifest 結構維持 SDLCCT-7 設計文件所述現狀，新測試
只讀取既有欄位（`anchor`、`projects.<key>.daily.<date>.cost`、
`by_version`、`by_plant`、`by_model`、`hourly_cost`）。

## 關鍵技術決策

- **略過機制：模組層級 `pytest.mark.skipif`，不用 fixture 或
  `conftest.py` 的 collection hook**——`skipif` 的判定（pytest 的
  skipping 外掛在 `pytest_runtest_setup` 階段以 hookwrapper + tryfirst
  搶先執行）發生在任何 fixture（含 autouse、session-scoped）真正被
  呼叫之前；一旦條件為真，該模組底下所有 test item 直接標記
  `SKIPPED`，fixture 完全不會被實例化。因此即使之後的 fixture 內部會
  建立 `httpx.Client` 並打 API，只要判定式只讀
  `os.environ.get("OPIK_BASE_URL")`（純字串檢查、不呼叫
  `client.base_url()`，因為 `base_url()` 在未設定時會
  `raise SystemExit`，若在判定式裡呼叫就會讓 collection 階段直接噴
  `SystemExit`，變成 `ERROR` 而非 `SKIPPED`，違反驗收條件），就能保證
  「不嘗試對外發出任何 HTTP 請求」且回報一律是 `SKIPPED`，不是
  `FAIL`/`ERROR`。模組最上層以外也不呼叫 `client.api()`／`verify.main()`
  ——只 `import` 函式與常數，兩者皆為無副作用的純定義，`import verify`
  同理安全。
- **延遲判定與正確性判定的獨立性：靠「查詢只做一次、結果快取在
  module-scope fixture、兩類測試各自只讀自己關心的欄位」達成，不是靠
  try/except 吞掉失敗**——新增一個 module-scoped fixture
  （例如 `backend_queries`），在第一次被任何測試函式請求時，依序對
  每個情境執行一次查詢，用 `verify.timed()` 包起來，把結果存成
  `{label: TimedResult(response, elapsed_ms, error)}`（`TimedResult`
  為簡單 dataclass；`error` 只在真正的連線層例外——如
  `httpx.ConnectError`/`httpx.TimeoutException`——才會非 None，HTTP
  200/非200 一律視為「查詢成功、拿到一個 response」，不特別攔截，沿用
  `verify.py` 現有「用 `status_code==200` 搭配手動檢查」的風格）。
  pytest fixture 在同一 scope 內只會被呼叫一次並快取結果給所有消費它
  的測試函式，所以同一次查詢的 HTTP 往返只發生一次。對帳測試函式
  （例如 `test_daily_cost_reconciles_with_manifest`）只讀
  `backend_queries["workspace_costs_daily"].response` 來比對數字；延遲
  測試函式（`test_query_latency_is_under_threshold`，對每個 label
  各自一個 `assert`，用 `pytest.mark.parametrize` 展開或迴圈 + 子
  assert 皆可，由 developer 依既有慣例決定）只讀同一份快取裡的
  `elapsed_ms` 欄位。兩類測試函式之間沒有共享的 assert、沒有互相呼叫，
  pytest 本身每個 test function 的 PASS/FAIL 彼此獨立記錄，因此「正確性
  失敗」與「延遲過高」天然不會互相牽動對方的結果；唯一的共享狀態是
  fixture 回傳的只讀資料結構，fixture 本身不做任何
  `assert`/`pytest.fail`。
- **manifest 的重新產生：直接呼叫 `generate.generate(anchor, scale)`
  做乾跑，不經過 CLI／`out/manifest_dryrun.json`／`out/manifest.json`**
  ——沿用 SDLCCT-7 設計文件已定案的慣例（純函式呼叫、不透過進程邊界、
  不依賴磁碟檔案是否存在），對應本 Story 驗收條件「不依賴 `seed/out/`
  是否存在」。
- **`anchor`／`scale` 參數來源：新增兩個可選環境變數
  `OPIK_SEED_ANCHOR`（ISO 日期，預設為執行當下 UTC 當日 0 時 0 分，與
  `generate.py` 的 `--anchor` 未提供時的預設邏輯一致）與
  `OPIK_SEED_SCALE`（int，預設 `catalog.SCALE`），而不是固定寫死一個
  常數、也不去讀 `seed/out/manifest.json`**——理由：真正餵進 Opik 後端
  的資料，其 `anchor`/`scale` 取決於當初執行
  `uv run python generate.py --write` 時用的參數（`README.md` 範例未帶
  `--anchor`，預設即「執行當下的 UTC 當日」），而驗收條件明確排除依賴
  `seed/out/` 檔案是否存在去讀回那組參數；因此對帳測試需要一個不依賴
  檔案系統、操作者仍可控的輸入管道。沿用 `OPIK_BASE_URL` 已有的「用環境
  變數描述『這次要對的是哪個環境』」慣例，是風險最低、改動最少的做法；
  預設值對齊 `generate.py` 自身的預設行為，使「同一天內先 `--write`
  再立刻跑這個對帳測試」這個最常見操作流程在不設任何額外環境變數的情況
  下就能直接吃到正確參數，只有當 `--write` 與測試執行不在同一個 UTC
  日期（例如隔夜才跑測試）時，操作者才需要明確帶
  `OPIK_SEED_ANCHOR=<--write 當時用的日期>`。這是測試參數化的工程決策
  （類比 `OPIK_BASE_URL`），不是新的產品行為，故列於此而非開放設計問題。
- **容忍誤差與逾時常數直接 `from verify import TOL_DAY, TOL_TOTAL,
  SLOW_MS`，不在新測試檔重新定義同名常數**——驗收條件明文要求「沿用
  verify.py 的 TOL_DAY/TOL_TOTAL/SLOW_MS」，import 既有常數可避免兩份
  定義日後漂移不同步。

## UI 原型
無，本 Story 不涉及前端 UI（純粹在 `seed/tests/` 新增一個 pytest 測試檔，
不涉及任何畫面、元件或樣式變更；Portal/API 層本身尚未存在，見
project-profile.yaml）。

## 開放設計問題(定稿時必須為空)
（無）
