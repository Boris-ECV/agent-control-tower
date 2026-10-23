# 設計文件 — SDLCCT-63 bff/opik_metrics.py: /metrics endpoint called with project name instead of real Opik project id, returns 404 against a live backend（Bug）

## 對應需求規格

對應 G1 已核准的需求規格。根因已核實：`bff/opik_metrics.py::get_project_metrics()`
把呼叫端傳入的 `project_ids`（實際上永遠是 `seed/registry.py` 的 `key` 字串，
如 `"maintenance_copilot"`）原樣接到 `/v1/private/projects/{pid}/metrics`
路徑上，從未解析成 Opik 真實配發的 project UUID。已用真實 curl 證據驗證：
`POST /v1/private/projects/maintenance_copilot/metrics` → 404；
`POST /v1/private/projects/<真實UUID>/metrics` → 200
（UUID 來自 `GET /v1/private/projects?size=200` 清單中對應 `name` 的 `id`）。

同一模式也存在於 `bff/opik_workspace.py::get_workspace_daily_costs()`
（body 的 `project_ids`）與 `get_project_stats()`（client 端用
`pid in wanted` 比對真實 UUID）。`bff/opik_spans.py`、`bff/opik_traces.py`
已確認不受影響（查詢參數是 `project_name` 字面值，不是 path/body 中的
id），本次不修改。

範圍：

1. 新增 name→id 解析機制，沿用 `seed/client.py::project_ids()` 已驗證過的
   `GET /v1/private/projects?size=200` 清單方式。
2. 修正 `get_project_metrics()`／`get_project_metrics_cached()`：送出
   `/v1/private/projects/{pid}/metrics` 前，`pid` 必須先經過解析機制轉換
   成真實 Opik project id；函式對外的輸入參數（呼叫端傳入 registry key
   字串）維持不變。
3. 同樣修正 `get_workspace_daily_costs()`（body 的 `project_ids`）與
   `get_project_stats()`（client 端比對邏輯）。
4. 新增測試、更新 `test_opik_metrics.py`、`test_opik_metrics_cache.py`、
   `test_opik_workspace.py` 既有斷言。
5. 不修改 9 個下游模組（`cost_overview.py`／`agents.py`／
   `agent_detail.py`／`budget_simulation.py`／5 個
   `anomaly_*.py`）與其測試、`anomalies.py` ——它們的既有測試在模組
   namespace 直接 monkeypatch 整個函式、不碰 HTTP 層，呼叫簽名不變則無需
   改動，已逐一讀過原始碼確認（`cost_overview.py`、
   `anomaly_governance_gap.py` 等）。
6. `bff/opik_spans.py`、`bff/opik_traces.py` 維持現狀不變。

範圍外（G1 已核准，不可擴大）：不連線任何真實伺服器；不修改下游 9 個模組；
不改變 `seed/` 既有腳本。

## 介面/API 契約

本 Story 不新增對外 HTTP 路由——純內部函式庫層修正。對外函式簽名
（`get_project_metrics()`／`get_project_metrics_cached()`／
`get_workspace_daily_costs()`／`get_project_stats()`）完全不變：輸入仍是
呼叫端的 registry key 字串序列，回傳 dict 仍以呼叫端傳入的原始字串為
key（見決策 4，這是維持下游 9 個模組零修改的前提）。

### 新增：`bff/opik_metrics.py` 內的解析函式（不開新模組，見決策 1）

```python
class UnknownProjectKeyError(OpikClientError):
    """Raised by resolve_project_ids() when a name in project_ids has no
    matching entry in Opik's GET /v1/private/projects listing. The list
    request itself succeeded (status 200) -- this is a data mismatch
    (caller passed a name Opik doesn't know), not a transport failure,
    so it is kept distinct from OpikHTTPError/OpikResponseFormatError."""

    def __init__(self, message: str, *, endpoint: str, missing_key: str):
        super().__init__(message, endpoint=endpoint, status_code=200)
        self.missing_key = missing_key


_PROJECT_IDS_LIST_PAGE_SIZE = 200  # matches seed/client.py::project_ids(), verified by seed/verify.py
_PROJECT_IDS_CACHE_TTL_SECONDS = 60.0  # same TTL/rationale as _metrics_cache (decision 3)
_project_ids_cache = TTLCache(ttl_seconds=_PROJECT_IDS_CACHE_TTL_SECONDS)
_PROJECT_IDS_CACHE_KEY = "name_to_id"  # single entry: one GET returns the whole list, not scoped per name


def _fetch_project_name_to_id() -> dict[str, str]:
    """GET /v1/private/projects?size=200 -> {name: id}. Same request shape
    and same {"content": [{"name", "id", ...}]} response shape as
    seed/client.py::project_ids() (not imported from seed/ -- bff/ has no
    dependency on seed/, same vendoring stance as anchor.py, see
    docs/design/SDLCCT-10.md decision #3)."""
    endpoint = "/v1/private/projects"
    with _client() as c:
        try:
            r = c.get(endpoint, params={"size": _PROJECT_IDS_LIST_PAGE_SIZE})
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        try:
            payload = r.json()
            return {p["name"]: p["id"] for p in payload["content"]}
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise OpikResponseFormatError(
                f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
            ) from exc


def resolve_project_ids(keys: Sequence[str]) -> dict[str, str]:
    """Resolve each name in `keys` (registry key strings, e.g.
    "maintenance_copilot") to its real Opik project UUID, via the cached
    GET /v1/private/projects listing. Returns {name: id} -- not a parallel
    list -- so a caller can both look up by original name and build the
    reverse {id: name} map in one line.

    - Backed by a 60s TTL cache of the FULL listing (see decision 3);
      cache read/write failures are isolated exactly like
      get_project_metrics_cached() (decision 3 in docs/design/SDLCCT-11.md):
      read failure -> treated as miss; write failure -> swallowed; the
      actual GET call itself is never inside a try/except, so
      OpikHTTPError/OpikTimeoutError/OpikResponseFormatError from it
      propagate unchanged.
    - Does NOT check for empty `keys` -- every call site already checks
      `project_ids` non-empty (-> MissingProjectIdsError) before calling
      this, per existing convention; this function assumes that contract.
    - Raises UnknownProjectKeyError (carrying the offending name in
      .missing_key) the first time a key has no match. Never silently
      drops the key, and never falls back to treating the name as if it
      were already a valid id.
    """
    try:
        hit, cached = _project_ids_cache.get(_PROJECT_IDS_CACHE_KEY)
    except Exception:
        hit, cached = False, None

    name_to_id = cached if hit else _fetch_project_name_to_id()

    if not hit:
        try:
            _project_ids_cache.set(_PROJECT_IDS_CACHE_KEY, name_to_id)
        except Exception:
            pass

    resolved: dict[str, str] = {}
    for key in keys:
        if key not in name_to_id:
            raise UnknownProjectKeyError(
                f"no Opik project found with name '{key}'",
                endpoint="/v1/private/projects",
                missing_key=key,
            )
        resolved[key] = name_to_id[key]
    return resolved


def invalidate_project_ids_cache() -> None:
    """Manual invalidation hook, mirrors invalidate_project_metrics_cache()."""
    _project_ids_cache.invalidate_all()
```

### 變更：`get_project_metrics()`（`bff/opik_metrics.py`）

```python
def get_project_metrics(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
    if not project_ids:
        raise MissingProjectIdsError(...)   # unchanged
    body_base = {...}                        # unchanged

    name_to_id = resolve_project_ids(project_ids)  # NEW -- may raise UnknownProjectKeyError
                                                     # or any OpikClientError from the listing GET

    out: dict[str, tuple[MetricSeries, ...]] = {}
    with _client() as c:
        for name in project_ids:
            pid = name_to_id[name]                       # CHANGED: resolved id, not the raw name
            endpoint = f"/v1/private/projects/{pid}/metrics"
            r = c.post(endpoint, json=body_base)          # unchanged error handling below
            ...
            out[name] = _parse_metric_response(r, endpoint)  # CHANGED key: original name, not pid
    return out
```

`get_project_metrics_cached()` and its `_metrics_cache_key()` are
**unchanged** — the cache key is still built from the caller's original
`project_ids` (names); resolution happens inside `get_project_metrics()`
on a cache miss, same as today. `UnknownProjectKeyError` propagates
through the cached wrapper exactly like the other `OpikClientError`
subclasses already do (not inside any try/except there).

### 變更：`bff/opik_workspace.py::get_workspace_daily_costs()`

```python
from opik_metrics import resolve_project_ids  # NEW import

def get_workspace_daily_costs(project_ids, *, interval_start, interval_end):
    if not project_ids:
        raise MissingProjectIdsError(...)  # unchanged

    name_to_id = resolve_project_ids(project_ids)           # NEW
    id_to_name = {v: k for k, v in name_to_id.items()}       # NEW

    endpoint = "/v1/private/workspaces/costs"
    body = {
        "project_ids": list(name_to_id.values()),   # CHANGED: real ids, not names
        "interval_start": _iso(interval_start),
        "interval_end": _iso(interval_end),
    }
    ... # POST unchanged
    return _parse_workspace_costs_response(r, endpoint, id_to_name)  # CHANGED: extra arg
```

```python
def _parse_workspace_costs_response(r, endpoint, id_to_name):
    try:
        payload = r.json()
        out = {}
        for res in payload["results"]:
            pid = res["project_id"]              # this is now a real UUID from the backend
            if pid not in id_to_name:
                raise OpikResponseFormatError(
                    f"backend returned project_id '{pid}' not among the requested ids",
                    endpoint=endpoint, status_code=r.status_code,
                )
            name = id_to_name[pid]                # CHANGED: map back to the caller's original name
            points = tuple(...)
            out[name] = points                    # CHANGED key: name, not pid
        return out
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(...) from exc
```

外部契約維持：回傳 dict 的 key 仍是呼叫端傳入 `project_ids` 裡的原始
字串（registry key），只是現在內部先轉成真實 id 送出 request、收到真實
id 的回應後再映射回原始字串——下游（`anomaly_governance_gap.py` 等）
用 `costs_map.get(record["key"], ())` 查找的行為不需任何改動。

### 變更：`bff/opik_workspace.py::get_project_stats()`

```python
def get_project_stats(project_ids, *, from_time, to_time, page_size=DEFAULT_PROJECTS_STATS_PAGE_SIZE):
    if not project_ids:
        raise MissingProjectIdsError(...)  # unchanged

    name_to_id = resolve_project_ids(project_ids)            # NEW
    id_to_name = {v: k for k, v in name_to_id.items()}        # NEW
    wanted_ids = set(name_to_id.values())                     # CHANGED: real ids, not raw project_ids

    ... # GET /v1/private/projects/stats unchanged (no filter param on this endpoint)
    all_stats = _parse_projects_stats_response(r, endpoint)   # unchanged, still keyed by real project_id

    return {id_to_name[pid]: s for pid, s in all_stats.items() if pid in wanted_ids}  # CHANGED
```

`ProjectStats.project_id` 欄位本身**不變**——它本來就該是後端真實
UUID（本來就是正確的，bug 只在外層比對/輸出 key 用錯了字串），這裡只
改外層回傳 dict 的 key 從「原始輸入字串直接比對」改成「解析後的真實 id
比對、再映射回原始字串」。

## 資料模型

無新增持久化資料模型。`resolve_project_ids()` 的快取是另一個純記憶體內
`TTLCache` 實例（與 SDLCCT-11 的 `_metrics_cache` 同一種機制、不同實例），
行程重啟即清空，不建表、不加索引。

## 關鍵技術決策

1. **解析函式 `resolve_project_ids()` 放在 `bff/opik_metrics.py`，不開新
   模組**——`bff/opik_workspace.py` 已經直接 import `opik_metrics` 的私有
   輔助函式（`_client`、`_iso`）與整組例外類別，模組標頭本身寫明
   「Reuses opik_metrics's base_url()/_client()/exception hierarchy/_iso()
   directly」，這個跨模組重用的慣例已經存在；再開一個只有兩個消費者的
   第三個模組是不必要的模組切割，不符合這個 repo 目前「兩個 Opik client
   模組」的規模。

2. **解析函式回傳 `dict[str, str]`（name→id），不回傳 parallel list 或
   單一 id**——三個呼叫點（`get_project_metrics()`／
   `get_workspace_daily_costs()`／`get_project_stats()`）都同時需要
   「原始名字 → id」（組 request）與「id → 原始名字」（還原 response 的
   key）兩個方向，回傳 dict 讓呼叫端用一行 `{v: k for k, v in ...}`
   就能拿到反向映射，比回傳 parallel list 或強迫呼叫端自己 zip 更不容易
   出錯。

3. **用 60 秒 TTL 快取整份 name→id 清單（`GET /v1/private/projects?size=200`
   只呼叫一次、快取住，而不是每次呼叫 `resolve_project_ids()` 都重新發
   HTTP request）**——理由與 `docs/design/SDLCCT-11.md` 決策 3 完全相同：
   demo 資料集相對靜態，但 spec 範圍外沒有排除之後重新執行
   `seed/generate.py` 建立新專案的情境，所以仍需要一個會過期的快取而非
   永久快取；60 秒與既有 `_metrics_cache`（SDLCCT-11）一致，讓這個 repo
   只有一種「TTL 多久」的心智模型，不需要工程師記兩個不同數字背後兩套
   不同理由。快取讀寫失敗的隔離手法（讀失敗視為 miss、寫失敗吞掉、真正
   的 GET 呼叫本身完全不包在 try/except 內）原樣複製
   `get_project_metrics_cached()` 已驗證過的寫法，不重新發明。

4. **三個修正後的函式，對外回傳 dict 的 key 仍是呼叫端傳入的原始字串
   （registry key），不是解析後的真實 Opik project id**——這是維持
   「下游 9 個模組與其測試不需修改」這個已核實範圍限制的必要條件：這些
   模組目前全部用呼叫時的原始 key 字串去查結果 dict（例如
   `anomaly_governance_gap.py` 的
   `costs_map.get(record["key"], ())`、`cost_overview.py` 的
   `metrics_map.get(key, ())`）。若讓回傳 dict 改成以真實 UUID 為 key，
   這 9 個模組全部會查不到資料、必須逐一改寫，直接違反 spec 明文的範圍
   限制。因此修正集中在「送出 request 前解析、收到 response 後映射回
   原始字串」這個夾在中間的內部實作細節，兩端的外部契約（輸入字串、輸出
   字串 key）完全不動。

5. **`UnknownProjectKeyError` 新增為 `OpikClientError` 的子類別（而非
   `OpikResponseFormatError` 或直接用 `ValueError`）**——沿用這個模組既有
   的例外分類原則：`OpikClientError` 家族代表「呼叫 Opik 時發生的、帶
   endpoint/status 資訊的明確失敗」。`GET /v1/private/projects` 本身是
   200 成功回應，資料格式也正確（不是 `OpikResponseFormatError` 要處理的
   「2xx 但 shape 不對」），問題是呼叫端給的名字在這份清單裡找不到——這是
   一個介於「設定錯誤」（`OpikConfigError`，根本沒打到後端）與「後端回應
   格式錯誤」之間、目前沒有既有類別涵蓋的狀況，需要新增一個精確描述
   語意的子類別，而不是借用語意不準的既有類別（例如誤用
   `MissingProjectIdsError`——那個專屬於「輸入清單整體是空的」這個完全
   不同的呼叫端契約違反，混用會讓呼叫端無法區分這兩種完全不同的失敗
   原因）。附帶 `missing_key` 屬性，讓呼叫端或日誌能直接看到是哪個名字
   查不到，不需要自己從訊息字串裡解析。

6. **GET 清單固定 `size=200`，不處理分頁**——與 `seed/client.py::project_ids()`
   已被 `seed/verify.py` 驗證過的作法完全一致（直接沿用同一個已驗證的
   request 形狀，見 spec 範圍：「沿用 seed/client.py::project_ids() 已
   驗證過的 GET /v1/private/projects 列表方式」），不在本次 bug 修正中
   另外設計分頁邏輯；這個 demo 規模的專案數遠低於 200，與
   `get_project_stats()` 既有的 `DEFAULT_PROJECTS_STATS_PAGE_SIZE = 100`
   單頁限制（已有決策記錄在 SDLCCT-15 設計文件）屬於同一類「demo 規模
   夠用、不做分頁」的既有取捨，保持一致。

7. **`get_workspace_daily_costs()`／`get_project_stats()` 不新增 import
   `seed/client.py::project_ids()`，而是在 `opik_metrics.py` 內重新實作
   等價邏輯**——`bff/` 目前對 `seed/` 沒有任何 import 依賴（見
   `opik_metrics.py` 模組頭的既有說明：「this module is reimplemented
   independently in bff/ ... has no dependency on seed/」），直接 import
   `seed/client.py` 會建立一個新的跨套件依賴，且 `seed/client.py` 的
   `project_ids()` 在找不到目標名字時的行為（回傳不含該名字的 dict，由
   `seed/verify.py` 自行判斷）與這裡需要的「找不到就明確拋出型別化例外」
   語意不同，複製一份語意正確的小函式比硬是重用並改變既有 `seed/`
   腳本的行為更安全、風險更低。

## UI 原型

無，本 Story 不涉及前端 UI——純後端 bug 修正（HTTP client 層的
name→id 解析），沒有新增或變更任何畫面、元件或樣式。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄（與 SDLCCT-10/11/15 設計文件記錄的
狀況相同，此後未變）。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無相關結果。不適用。

## 測試影響摘要（給開發者參考，非規格）

- `test_opik_metrics.py`／`test_opik_metrics_cache.py`：`FakeClient` 需
  新增支援 `get()`（目前只有 `post()`），模擬 `GET /v1/private/projects`
  回傳 `{"content": [{"name": "maintenance_copilot", "id": "<uuid>"}]}`；
  既有直接斷言 `endpoint == f"/v1/private/projects/{name}/metrics"` 的
  斷言要改成斷言 `f"/v1/private/projects/{uuid}/metrics"`；新增至少一組
  對照 Jira 票上真實 curl 證據形狀的測試（`maintenance_copilot` →
  `<真實UUID>`）；新增 `UnknownProjectKeyError` 的測試案例（清單中沒有
  該名字）。
- `test_opik_workspace.py`：同樣需要 `FakeClient.get()`；
  `get_workspace_daily_costs()` 的既有斷言（body 的 `project_ids` 具體
  值、回傳 dict 的 key）要改成先解析成 uuid 再斷言 body、回傳 dict 的
  key 仍斷言為原始名字；`get_project_stats()` 同理，`all_stats`/`wanted`
  比對改用 uuid，回傳 dict key 仍斷言為原始名字。

## 開放設計問題(定稿時必須為空)

（無）
