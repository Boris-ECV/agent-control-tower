# 設計文件 — SDLCCT-26 把 preflight.py 定價對帳轉成 skip-if-no-backend 整合測試

## 對應需求規格
對應 G1 已核准的需求規格：把 `seed/preflight.py` 目前只能手動執行的定價
對帳腳本，轉成可重跑的 pytest 整合測試，風格與略過慣例沿用
`seed/tests/test_reconciliation.py`（SDLCCT-8）。涵蓋 5 條 Gherkin AC：
(1) 未設定 `OPIK_BASE_URL` 時乾淨略過（純字串檢查，不污染 SKIPPED）、
(2) 有定價模型成本與期望值一致（`abs(diff) < 1e-9`）時通過、(3) 不在定價表
的模型（`unknown-model-x`）成本為 `None`/`0` 時通過、(4) 容差外失敗時訊息
含模型名稱/provider/實際/期望成本、(5) 無論成功或失敗都清除 throwaway 專案
`preflight_pricing`。範圍外：是否保留 `preflight.py` 可獨立執行、是否需要
額外清理機制——兩者皆明確留給本設計決定，見下方「關鍵技術決策」。不修改
`generate.py`/情境內容，不重用 `verify.py` 的 metric/parse helper。

## 介面/API 契約
本 Story 不新增對外 HTTP 介面，也不新增、不變更任何既有端點的
request/response 格式；沿用 `seed/preflight.py` 原本就在打的三個既有端點
（`POST /v1/private/traces/batch`、`POST /v1/private/spans/batch`、
`GET /v1/private/spans`、`GET /v1/private/projects`、
`POST /v1/private/projects/delete`），呼叫方式與現狀逐字相同。

- 新增測試檔：`seed/tests/test_preflight_pricing.py`（確認採用規格自己建議
  的檔名；`seed/pyproject.toml` 的 `testpaths = ["tests"]` 與
  `pythonpath = ["."]` 已涵蓋，不需改設定）。
- 執行方式：`cd seed && uv run pytest -q`（既有指令，不新增）。
- 略過條件：模組最上層加一行，**逐字沿用** SDLCCT-8 的寫法：
  ```python
  pytestmark = pytest.mark.skipif(
      not os.environ.get("OPIK_BASE_URL", "").strip(),
      reason="OPIK_BASE_URL not set",
  )
  ```
  同理：純字串檢查、不呼叫 `client.base_url()`（會 `raise SystemExit`），
  確保未設定時一律 `SKIPPED` 不是 `ERROR`。

### `seed/preflight.py` 的抽取（新函式簽名）
把現有 `main()` 裡的邏輯拆成以下函式；拆分細節與理由見「關鍵技術決策」：

```python
PROJECT = "preflight_pricing"        # 不變
PROMPT, COMPLETION = 24000, 1500     # 不變

def pricing_cases() -> list[tuple[str, str]]:
    """純函式，無 I/O。回傳與現狀 main() 裡逐字相同的 case 清單
    （MODELS 全部 + gemini-2.5-pro/flash 的 "google_ai" 別名 provider +
    "unknown-model-x"）。"""

def seed_and_collect(
    c: httpx.Client, cases: list[tuple[str, str]],
    *, attempts: int = 20, delay: float = 3.0,
) -> dict[str, dict]:
    """寫入 traces/spans batch（寫入失敗直接 raise，不吞例外），輪詢
    `GET /v1/private/spans` 最多 attempts 次直到筆數湊齊或用盡，回傳
    {f"{model}@{provider}": span_dict}（找不到的 case 不會出現在回傳
    dict 裡）。邏輯與現狀 main() 的輪詢迴圈逐字相同，只是搬進獨立函式。"""

def evaluate_case(
    model: str, provider: str, got: dict[str, dict], prices: dict,
) -> tuple[float | None, float | None, bool]:
    """純函式，無 I/O。回傳 (cost, expected, ok)：
    - model 在 prices 裡：expected = p_in*PROMPT + p_out*COMPLETION，
      ok = cost is not None and abs(cost - expected) < 1e-9。
    - model 不在 prices 裡：expected = None，ok = cost in (None, 0)。
    邏輯與現狀 main() 的 ok/exp 計算逐字相同，只是搬進獨立函式方便測試
    直接斷言，不必重新實作一份比價邏輯。"""

def delete_project(c: httpx.Client, name: str) -> int | None:
    """依名稱查 project id，找不到就回傳 None（no-op，不 raise）；找到就
    呼叫 /v1/private/projects/delete 並回傳該次呼叫的 status_code。比現
    狀 main() 多了「找不到就安全跳過」，為支援 teardown 在任何失敗情境
    下都能呼叫而不炸掉。"""

def main() -> int:
    """瘦身後的 CLI 進入點：依序呼叫 api()/load_prices()/pricing_cases()
    /seed_and_collect()/逐 case 呼叫 evaluate_case() 印出結果，最後在
    try/finally 裡呼叫 delete_project() 保證清除，回傳 0/1。對外行為
    （print 格式、return code）與現狀完全相同，仍可
    `python preflight.py` 獨立執行。"""
```

## 資料模型
無新增資料模型。不修改 `catalog.py`／`generate.py`，不碰 Portal/BFF/Agent
清冊資料庫；本 Story 只在 Opik 後端寫入/刪除一個名為 `preflight_pricing`
的 throwaway 專案（既有行為，未變更其資料形狀：trace/span 欄位與現狀
`main()` 逐字相同）。

## 關鍵技術決策

- **抽取方式：把 `main()` 拆成 4 個小函式（`pricing_cases`／
  `seed_and_collect`／`evaluate_case`／`delete_project`），`main()` 變成
  瘦身後的組裝層，CLI 進入點原樣保留**——規格明確把「`preflight.py`
  是否保留可獨立執行」留給本設計決定：決定保留，理由是零風險（純粹把
  現有程式碼搬進函式，不改邏輯、不改輸出格式）且仍是有用的手動除錯工具
  （例如要在沒有 pytest 的情況下快速跑一次定價檢查）。純邏輯函式
  （`pricing_cases`、`evaluate_case`）不做任何 I/O，讓測試可以直接斷言
  而不必重新實作一份比價算式；I/O 函式（`seed_and_collect`、
  `delete_project`）維持現狀對後端的呼叫方式不變。`seed/pyproject.toml`
  的 `coverage.run.omit` 本就把 `preflight.py`（連同 `verify.py`、
  `client.py`）列為「talks to a live backend, exercised by hand」不計覆
  蓋率的檔案——這個抽取不改變那個分類，沿用既有慣例，不修改
  `pyproject.toml`。

- **清理機制：fixture 內用 `try/...yield.../finally` 包住整個「寫入 +
  輪詢」過程，不是現狀 `main()` 那種「照順序執行到最後一行才刪除」的寫
  法**——規格明確把「是否需要額外清理機制」留給本設計決定。重讀過
  `test_reconciliation.py`（SDLCCT-8）全文後確認：SDLCCT-8 是純讀取的對
  帳測試，從未對後端寫入或建立 throwaway 專案，因此**它本身沒有「建立
  +清除」的既有 teardown 慣例可供逐字沿用**（只有 skip 慣例可逐字沿
  用，已在上方「介面/API 契約」沿用）。本 Story 是本專案第一個會寫入/
  刪除資料的 pytest 測試，教訓是：現狀 `preflight.py main()` 若在寫入
  批次之後、輪詢或刪除之前的任何一步丟例外（例如輪詢迴圈外的其他程式
  碼），throwaway 專案就不會被刪除——這正是 AC5「無論成功或失敗都要清
  除」要防的情況。因此 fixture 設計為：
  ```python
  @pytest.fixture(scope="module")
  def seeded(opik_client):
      cases = pricing_cases()
      try:
          got = seed_and_collect(opik_client, cases)
          yield cases, got
      finally:
          delete_project(opik_client, PROJECT)
  ```
  把「寫入+輪詢」也包進 try，才能保證就算寫入階段本身丟例外，`finally`
  仍會嘗試刪除（`delete_project` 找不到專案時安全 no-op，不會因為專案
  根本沒建成而再拋一次例外）。測試函式本身的 assert 失敗則發生在
  `yield` 之後（fixture 已經回傳），屬於 pytest fixture teardown的標準
  保證範圍：無論消費該 fixture 的測試函式通過或失敗，`finally` 一定會
  在該 module 所有測試跑完後執行一次。`main()` 也同步套用相同的
  try/finally 包法（對應上方「抽取方式」的決策），讓手動執行腳本時也有
  一致的保證，屬於零風險的附帶強化。

- **已知模型 vs 未知模型用同一個 `evaluate_case` 走兩條斷言，而不是分開
  重寫比價邏輯**——`evaluate_case` 回傳的 `ok` 布林值在「容差內」
  （AC2）與「容差外」（AC4）兩種情境下，由同一行 `assert ok, <message>`
  處理：通過就是 AC2，失敗就是 AC4，訊息格式固定帶
  `f"{model}@{provider}: cost={cost} expected={expected}"`，同時滿足
  AC4「失敗訊息含模型名稱/provider/實際/期望成本」。未知模型（AC3）用
  同一個函式但斷言訊息改為 `expected=None/0`，因為未知模型本來就沒有
  單一期望值。

- **`unknown-model-x` 的種子來源：沿用 `preflight.py` 現狀 `main()` 裡
  已經寫好的 case 清單，不新增、不更動**——該清單本就包含
  `("unknown-model-x", "openai")`（不在 `MODELS`/定價表裡）以及
  `gemini-2.5-pro`/`gemini-2.5-flash` 用另一個 provider 別名
  `"google_ai"`（`catalog.MODELS` 裡是 `"google_vertexai"`）重覆測一次
  ——這是現狀腳本本就刻意覆蓋的「同一模型、不同 provider 標籤」案例，屬
  於既有行為，`pricing_cases()` 只是把這段逐字搬進函式，不是本 Story 新
  增的測試資料設計。

- **已知/未知 case 的分類（供 `pytest.mark.parametrize`）在模組匯入時
  就計算好，而不是放進 fixture**——`pricing_cases()` 與
  `load_prices(MODELS)` 都是純函式／只讀本地 JSON 檔
  （`model_prices.snapshot.json`），不發出任何網路請求，因此在模組最
  上層（`pytestmark` 之後）呼叫它們來分出 `KNOWN_CASES`/`UNKNOWN_CASES`
  不會違反「`OPIK_BASE_URL` 未設定時不嘗試任何 HTTP 請求」的不變量——這
  與 SDLCCT-8 的 `test_reconciliation.py` 模組最上層就
  `from verify import TOL_DAY, ...` 等純常數是同一類安全操作。這樣兩類
  測試可以各自用 `@pytest.mark.parametrize("model,provider", KNOWN_CASES)`
  / `UNKNOWN_CASES`，id 清楚標出是哪個 `model@provider` 失敗。

- **輪詢次數/間隔沿用現狀常數（20 次、3 秒），不因為是測試就縮短**——
  縮短輪詢會讓測試在後端處理較慢時變得不穩定（flaky），而這是對真實後
  端跑的整合測試，不是單元測試；沿用現狀腳本已驗證過的經驗值，不額外
  發明新的逾時策略。

## UI 原型
無，本 Story 不涉及前端 UI（純粹是 `seed/` 底下 Python 腳本與 pytest
測試檔的重構，不涉及任何畫面、元件或樣式；也不存在任何跨元素樣式耦合測
試需要檢查，本 repo 目前沒有前端畫面可比對）。

## 開放設計問題(定稿時必須為空)
（無）
