# 設計文件 — SDLCCT-25 用 httpx.MockTransport 補 ingest.py 的重試/退避單元測試

## 對應需求規格
對應 G1 已核准的需求規格：為 `seed/ingest.py` 的 `post_all()` 補單元測試，
使用 `httpx.MockTransport`（或等效 monkeypatch）在不呼叫真實 Opik 伺服器
的情況下驗證重試/退避邏輯。涵蓋 6 條 Gherkin AC：
(1) 前兩次 503 後第三次 200 成功、(2) 非可重試狀態碼（400）立即失敗、
(3) 連續 5 次 500 後放棄、(4) 第 5 次（最後一次嘗試）204 成功仍算數、
(5) 第一次就成功無延遲、(6) 連線層例外（`httpx.TransportError`）與 HTTP
狀態碼共用重試機制。範圍外：不修改資料產生器情境內容、不涉及 Portal/BFF/
Agent 清冊資料庫、不涉及伺服器或部署、不測試 size 參數的分批邏輯本身、
不測試 print 進度輸出。

### `post_all()` 現狀簽名（唯讀，本 Story 不修改 `ingest.py`）
```python
def post_all(c: httpx.Client, path: str, key: str, rows: list[dict],
              size: int = 500, label: str = "") -> None
```
重試迴圈（`seed/ingest.py:12-25`）：`for attempt in range(5)`，每個 chunk
最多嘗試 5 次。
- `httpx.TransportError` → `time.sleep(2 ** attempt)` 後 `continue`（重試）。
- `status_code in (200, 204)` → `break`（成功，跳出迴圈，不進 `else`）。
- `status_code in (429, 500, 502, 503, 504)` → `time.sleep(2 ** attempt)` 後
  `continue`（重試）。
- 其他狀態碼（如 400）→ 立即 `raise RuntimeError(f"{path} failed with
  {r.status_code}: {r.text[:300]}")`（訊息含 path 與狀態碼）。
- `for...else`：5 次嘗試全部耗盡仍未 `break` → `raise RuntimeError(f"{path}
  gave up after retries at row {i}")`（訊息含 "gave up after retries"）。

## 介面/API 契約
本 Story 不新增、不變更任何對外 HTTP 介面或既有函式簽名；純粹新增測試檔，
不修改 `seed/ingest.py`。

- 新增測試檔：`seed/tests/test_ingest.py`。
- 執行方式：`cd seed && uv run pytest -q`（既有指令，不新增；這份測試是
  純單元測試，不依賴 `OPIK_BASE_URL`，永遠執行，不會被 skip）。

### 既有慣例盤點（決定本 Story 的 mocking 慣例時的依據）
讀過 `seed/tests/test_reconciliation.py`（SDLCCT-8）與
`seed/tests/test_preflight_pricing.py`（SDLCCT-26）全文：兩者都是「打真實
Opik 後端」的整合測試（`pytestmark = pytest.mark.skipif(not
os.environ.get("OPIK_BASE_URL", ...))`），**都沒有使用
`httpx.MockTransport`，也沒有 mock 過 `httpx.Client`**——它們刻意要打真實
伺服器，不適用於本 Story。本 Story 是本專案第一個對 `httpx.Client` 做純
mock 的單元測試，因此在「關鍵技術決策」中自行訂定並說明理由，而非沿用
不存在的慣例。

### 測試輔助：`ScriptedTransport`（本 Story 新增，定義在 `test_ingest.py` 內）
```python
class ScriptedTransport(httpx.BaseTransport):
    """依序彈出一個 response-or-exception 腳本，每次 handle_request 呼叫
    彈出一項：若該項是 Exception 實例，raise 它；否則回傳它（httpx.Response）。
    紀錄呼叫次數於 self.calls，供每條 AC 斷言「transport 被呼叫幾次」。"""

    def __init__(self, script: list[httpx.Response | Exception]) -> None:
        self.script = list(script)
        self.calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
```

每條測試用一個固定輔助建立 client：
```python
def _client(transport: ScriptedTransport) -> httpx.Client:
    return httpx.Client(transport=transport, base_url="http://opik.test")
```

所有測試呼叫 `post_all()` 的共同引數（single-chunk，`size` 用預設值
500，`rows` 只放 1 筆，避免分批邏輯干擾——分批邏輯本身在範圍外）：
```python
post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
```
`label` 不帶（維持預設 `""`），因為 print 進度輸出在範圍外、不被斷言。

### `time.sleep` monkeypatch 與退避序列驗證
`ingest.py` 以 `import time` 後呼叫 `time.sleep(...)`，因此在 `ingest`
模組物件上 patch `time.sleep` 屬性（而非 patch 全域 `time` 模組），記錄每次
呼叫的引數，不真正休眠：
```python
@pytest.fixture
def fake_sleep(monkeypatch):
    calls: list[float] = []
    monkeypatch.setattr(ingest.time, "sleep", lambda s: calls.append(s))
    return calls
```
AC1（前兩次 503 後第三次成功）同時驗證退避序列：失敗發生在 `attempt=0`
與 `attempt=1`，故預期 `fake_sleep == [2 ** 0, 2 ** 1] == [1, 2]`——這是
本設計挑選來驗證 `2**attempt` 公式的那一條 AC（不必為此新增第 7 條測試）。

## 6 條 AC 對應的測試案例（逐一列出引數與斷言，developer 不用自行發明腳本內容）

| # | 測試函式名 | script | 斷言 |
|---|---|---|---|
| AC1 | `test_retries_on_503_then_succeeds` | `[Response(503), Response(503), Response(200)]` | 不丟例外；`transport.calls == 3`；`fake_sleep == [1, 2]` |
| AC2 | `test_non_retryable_status_fails_immediately` | `[Response(400, text="bad request")]` | `pytest.raises(RuntimeError, match="400")`，訊息含 path；`transport.calls == 1` |
| AC3 | `test_gives_up_after_five_failures` | `[Response(500)] * 5` | `pytest.raises(RuntimeError, match="gave up after retries")`；`transport.calls == 5` |
| AC4 | `test_last_attempt_success_counts` | `[Response(429)] * 4 + [Response(204)]` | 不丟例外；`transport.calls == 5` |
| AC5 | `test_first_try_success_no_delay` | `[Response(200)]` | 不丟例外；`transport.calls == 1`；`fake_sleep == []` |
| AC6 | `test_transport_error_shares_retry_with_status_codes` | `[httpx.TransportError("boom"), Response(200)]` | 不丟例外；`transport.calls == 2`；`len(fake_sleep) == 1` |

`Response` 在測試檔頂部以 `from httpx import Response` 或
`httpx.Response` 直接取用；`Response(400, text="bad request")` 等於
`httpx.Response(400, text="bad request")`。

## 資料模型
無新增資料模型。本 Story 純粹新增一支單元測試檔，不碰任何資料表、欄位或
Opik 後端資料；`ScriptedTransport` 只在記憶體中運作，不發出任何真實網路
請求。

## 關鍵技術決策

- **選用 `httpx.MockTransport`/自訂 `httpx.BaseTransport` 子類（而非
  monkeypatch `c.post` 本身）**——理由：`post_all()` 的簽名已經接受
  `c: httpx.Client`，用 `httpx.Client(transport=...)` 建構一個「真的
  httpx.Client，只是底層 transport 被替換」的物件，完全不用改動
  `ingest.py` 任何一行；相較於 `monkeypatch.setattr(c, "post", ...)`，
  transport 層替換更貼近 httpx 官方建議的測試方式，且能自然地讓
  `httpx.TransportError`（AC6）在呼叫鏈路的正確位置丟出（`c.post()` 內部
  呼叫 transport 時才拋，而不是在 mock 函式裡手動模擬一層不存在的例外
  路徑）。

- **用自訂 `ScriptedTransport` 類別而非 `httpx.MockTransport(handler)`
  的單一 handler 函式**——`httpx.MockTransport` 需要一個
  `handler(request) -> Response` 函式；若要讓同一個 handler 在「第 N 次
  呼叫回傳不同結果」，仍需要某種外部狀態（counter + list）才能做到逐次
  腳本化。本設計直接繼承 `httpx.BaseTransport` 自己維護
  `script`/`calls`，等價於「帶狀態的 handler」，但型態更明確（`calls`
  可直接讀取斷言、`script.pop(0)` 自然在腳本用盡時丟
  `IndexError`——若某條測試腳本長度抓錯，會立刻在測試階段爆炸而不是
  安靜地回傳 `None`），比在閉包裡手刻 `nonlocal counter` 更不容易寫錯。
  `httpx.MockTransport` 仍相容於這個設計（`ScriptedTransport` 一樣是
  `httpx.BaseTransport` 的合法子類，可直接傳進
  `httpx.Client(transport=...)`），只是不透過 `MockTransport` 這一層
  包裝，直接用更簡單的子類別。

- **`time.sleep` 的 patch 目標是 `ingest.time.sleep`，不是全域
  `time.sleep`**——`ingest.py` 用 `import time` 後呼叫 `time.sleep(...)`，
  因此只需要、也只應該 patch `ingest` 模組物件底下看到的 `time` 參照，
  範圍精準收斂在被測模組，不影響 pytest 自身或其他測試檔可能用到的真實
  `time.sleep`（例如若未來有別的測試檔真的需要短暫 sleep）。

- **AC1 兼任退避序列（`2**attempt`）驗證，不另開第 7 條測試**——AC1 的
  腳本（503, 503, 200）剛好在 `attempt=0` 與 `attempt=1` 兩次失敗，是
  6 條 AC 中唯一天然會呼叫兩次不同 `attempt` 值的 sleep 的情境，拿來
  斷言 `fake_sleep == [1, 2]` 不需要新增額外測試情境，維持測試數量貼著
  AC 數量（一條 AC 一個測試函式，不多不少），也避免「規格沒要求但設計
  自己加測試」造成的範圍模糊。

- **每條測試都用同樣的 `rows=[{"id": 1}]`、`size` 用預設值、不帶
  `label`**——分批邏輯（`size` 參數）與 print 進度輸出都在規格明確排除
  的範圍外；固定用單一 chunk 的最小輸入，讓每條測試只運動到重試迴圈本身
  這一段邏輯，不會不小心同時斷言到範圍外的行為。

## UI 原型
無，本 Story 不涉及前端 UI（純粹是 `seed/` 底下新增一支 pytest 單元測試
檔，不涉及任何畫面、元件或樣式；也不存在任何跨元素樣式耦合測試需要檢查，
本 repo 目前沒有前端畫面可比對）。

## 開放設計問題(定稿時必須為空)
（無）
