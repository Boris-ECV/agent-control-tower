# 設計文件 — SDLCCT-11 Caching layer for Opik queries

## 對應需求規格

對應 G1 已核准的需求規格「Caching layer for Opik queries」。範圍：在
`bff/opik_metrics.py::get_project_metrics()`（SDLCCT-10 已完成、目前唯一
存在的 Opik read client 函式）外層加一層快取——對完全相同的查詢參數組合
（`project_ids`、`metric_type`、`interval`、`interval_start`、
`interval_end`、`breakdown`）命中快取時直接回傳快取結果，不重新呼叫後端；
快取需有明確的失效/更新機制；快取層本身的讀寫失敗必須被明確隔離，絕不
能讓查詢改變結果或被吞掉——backend 原有的成功/失敗行為（
`OpikHTTPError`/`OpikTimeoutError`/`OpikResponseFormatError`/
`OpikConfigError`/`MissingProjectIdsError`）在快取失敗時必須原樣發生。
範圍外（已於 G1 核准，不可擴大）：不解決主機效能問題、不做分散式/跨行程
快取、不處理即時告警情境、不快取尚未存在的端點（只快取
`get_project_metrics()`）。

## 介面/API 契約

本 Story 不新增對外 HTTP 介面——沿用 SDLCCT-10 的定位，這是純函式庫層的
快取包裝。

### 新增模組：`bff/cache.py`

一個與 Opik 無關、可重用的通用「in-process TTL 快取」工具模組（讓日後
SDLCCT-15/16/17 若要替它們自己的端點加快取時可以重用同一套機制，而不是
把快取邏輯寫死在 `opik_metrics.py` 裡面——但本 Story 本身只把它套用在
`get_project_metrics()` 上，不預先替未排程的端點接線）。

```python
"""Generic in-process TTL cache (SDLCCT-11).

Thread-safe, single-process cache keyed by an arbitrary hashable key.
Read/write failures are isolated inside this module's own methods: a
caller using _cache.get()/_cache.set() never has an exception raised
from cache bookkeeping itself propagate past the try/except the caller
wraps around them (see bff/opik_metrics.py for the usage pattern).
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Generic, Hashable, TypeVar

T = TypeVar("T")


@dataclass
class _Entry(Generic[T]):
    value: T
    expires_at: float  # time.monotonic() timestamp


class TTLCache:
    """Module-level-friendly, lock-protected dict with per-entry TTL.

    Not a decorator: callers build their own cache key (so key
    construction policy stays visible at the call site, see
    opik_metrics.py) and call get()/set()/invalidate_all() explicitly.
    """

    def __init__(self, ttl_seconds: float):
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._entries: dict[Hashable, _Entry[Any]] = {}

    def get(self, key: Hashable) -> tuple[bool, Any]:
        """Returns (hit, value). hit=False on miss OR on expiry."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return False, None
            if time.monotonic() >= entry.expires_at:
                del self._entries[key]
                return False, None
            return True, entry.value

    def set(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._entries[key] = _Entry(value=value, expires_at=time.monotonic() + self._ttl_seconds)

    def invalidate(self, key: Hashable) -> None:
        with self._lock:
            self._entries.pop(key, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._entries.clear()
```

### 變更：`bff/opik_metrics.py`（新增函式，既有 `get_project_metrics()`
完全不變動——SDLCCT-10 已 Done，本 Story 只在它外層加一層，不碰其內部）

```python
from bff.cache import TTLCache

_METRICS_CACHE_TTL_SECONDS = 60.0
_metrics_cache = TTLCache(ttl_seconds=_METRICS_CACHE_TTL_SECONDS)


def _metrics_cache_key(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None,
) -> tuple:
    breakdown_key = (
        (breakdown.field.value, breakdown.metadata_key) if breakdown is not None else None
    )
    return (
        tuple(sorted(project_ids)),  # order-insensitive; see decision below
        metric_type.value,
        interval.value,
        _iso(interval_start),
        _iso(interval_end),
        breakdown_key,
    )


def get_project_metrics_cached(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None = None,
) -> dict[str, tuple[MetricSeries, ...]]:
    """Cached wrapper around get_project_metrics() (SDLCCT-11).

    Same signature, same return type, same exceptions as
    get_project_metrics() -- a caller can swap between the two freely.
    Cache read/write failures never change the result or swallow a
    backend exception: see "快取失敗隔離" decision below.
    """
    key = _metrics_cache_key(
        project_ids,
        metric_type,
        interval=interval,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=breakdown,
    )

    try:
        hit, cached_value = _metrics_cache.get(key)
    except Exception:
        hit, cached_value = False, None  # treat read failure as a miss (AC6)

    if hit:
        return cached_value

    # NOT inside a try/except: any OpikHTTPError / OpikTimeoutError /
    # OpikResponseFormatError / OpikConfigError / MissingProjectIdsError
    # raised here must propagate to the caller completely unchanged.
    result = get_project_metrics(
        project_ids,
        metric_type,
        interval=interval,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=breakdown,
    )

    try:
        _metrics_cache.set(key, result)
    except Exception:
        pass  # write failure must not affect the result just obtained (AC5)

    return result


def invalidate_project_metrics_cache() -> None:
    """Manual invalidation hook (clears all cached entries). Exposed for
    tests and for any future admin/debug entry point; not wired to any
    HTTP route in this Story (no such route exists yet)."""
    _metrics_cache.invalidate_all()
```

這個設計與 6 條 AC 的對應關係：

| AC | 對應設計 |
|---|---|
| 1. 未命中照常呼叫後端並寫入快取 | `hit=False` → 呼叫 `get_project_metrics()` → `_metrics_cache.set(key, result)` |
| 2. 完全相同參數命中不重新呼叫後端 | `_metrics_cache_key(...)` 六個欄位全部入 key，`hit=True` 時直接 `return cached_value`，不呼叫 `get_project_metrics()` |
| 3. 任一欄位不同不互相命中 | key 是六個欄位的 tuple，任一欄位值不同則 tuple 不相等、查無快取 |
| 4. TTL 到期或 invalidate 後重新呼叫 | `TTLCache.get()` 在 `time.monotonic() >= expires_at` 時回報 miss 並自行刪除該項；`invalidate_project_metrics_cache()` 可手動清空 |
| 5. 快取寫入失敗不影響本次結果 | `_metrics_cache.set(...)` 包在 `try/except Exception: pass`，而 `result` 已在此之前算好並會被 `return` |
| 6. 快取讀取失敗視為未命中；backend 例外原樣拋出 | `_metrics_cache.get(...)` 包在 `try/except Exception` 轉成 `hit=False`；呼叫 `get_project_metrics()` 的那一行刻意**不**包在任何 try/except 內 |

## 資料模型

無新增持久化資料模型。`TTLCache` 的 `_entries` 是純記憶體內字典，行程
重啟即清空；本 Story 不建表、不加索引，與 SDLCCT-10 的資料模型決策一致。

## 關鍵技術決策

1. **快取包裝函式 `get_project_metrics_cached()` 另外新增，不修改
   `get_project_metrics()` 本體，也不用裝飾器語法直接覆寫原函式名稱**——
   spec 明文要求「在...外層加一層」而非「取代」；保留原函式讓未加快取的
   呼叫路徑（例如未來某個需要保證即時性的呼叫端）仍可直接呼叫
   `get_project_metrics()`，兩者並存、呼叫端自行選擇，不強迫全面套用
   快取。SDLCCT-10 的程式碼因此完全不需變動，降低對已 Done 工單的回歸
   風險。

2. **快取後端：模組層級的 in-process `dict`（`TTLCache` 包一層
   `threading.Lock`），不用外部快取服務（Redis 等）**——spec 範圍外明文
   排除分散式/跨行程快取，且 `project-profile.yaml` 的部署模式是「人工
   部署到單一主機」，沒有多實例/多行程共享狀態的需求；引入外部快取服務
   會新增一個需要維運的元件，與 demo 規模不成比例。

3. **TTL 預設 60 秒，搭配手動 `invalidate_all()`（兩種機制並存，spec
   允許任選其一或皆可）**——demo 資料集本身是靜態的 seed 資料，理論上可以
   快取很久，但 spec 明確把「cache forever 不設任何失效機制」列為應避免
   的風險（AC4 要求有失效路徑可測）。60 秒的取捨：夠長以消除本故事要解決
   的主機延遲問題（cost trace ~10s、projects/stats ~6s 的單次查詢延遲在
   60 秒窗口內只需付一次），又夠短以確保重新執行 `seed/generate.py`
   更新 demo 資料後，使用者在同一次操作 session 內最多等 60 秒就能看到
   新資料，不需要重啟服務；`invalidate_project_metrics_cache()` 則提供
   需要立即生效時的手動退路（例如 demo 操作者剛重新灌資料、不想等
   TTL）。

4. **快取 key 包含六個參數的完整值，`project_ids` 用 `tuple(sorted(...))`
   做排序正規化（視為集合、順序不影響命中）**——`get_project_metrics()`
   的回傳型別是 `dict[str, tuple[MetricSeries, ...]]`，以 `project_id`
   為 key 聚合，其值本身**不**依賴輸入 `project_ids` 的順序（逐一呼叫、
   逐一寫入同一個 dict，`['a','b']` 與 `['b','a']` 兩次呼叫得到的
   dict 內容必然相同）。既然排序不影響正確性，把 `project_ids` 正規化
   排序後再組 key 可以提高命中率而不犧牲正確性；AC3「不同參數組合不會
   互相命中」談的是**不同的** project_ids 集合（新增/刪除/替換某個 id），
   排序正規化不違反這一條——集合不同時 `tuple(sorted(...))` 仍然不同。
   `interval_start`/`interval_end` 則用與 `get_project_metrics()` 內部
   送出後端請求相同的 `_iso()` 序列化，確保「同一個時間窗」必然算出
   相同 key（避免兩個等價但 `datetime` 物件本身因 tzinfo/精度表示不同
   而被誤判為不同 key 的邊界情況）。

5. **快取讀寫失敗的隔離：讀取包在 `try/except Exception` 轉成 miss，
   寫入包在 `try/except Exception` 直接吞掉；對 `get_project_metrics()`
   本身的呼叫刻意完全不包在任何 try/except 內**——這是 AC5/AC6 的核心
   實作手段。把真正的後端呼叫放在兩段快取相關 try/except 之間、自己完全
   不被任何 except 包住，是唯一能同時保證「快取失敗不影響查詢結果」與
   「backend 例外原樣拋出、不被快取層吞掉或轉換」兩條要求都成立的寫法——
   若圖方便把整個「讀快取 → 查後端 → 寫快取」包在同一個 try/except 裡，
   後端拋出的 `OpikHTTPError` 等例外會被誤攔截，違反 spec 明文「backend
   原有的成功/失敗行為在快取失敗時必須原樣發生」。

6. **執行緒安全：`TTLCache` 用 `threading.Lock` 保護內部 dict 的讀寫**——
   `project-profile.yaml` 目前 `frameworks: []`（Portal/API 層框架尚未
   選定），無法確定未來的 BFF 服務是單執行緒、多執行緒（如同步 WSGI
   worker）還是 async（如 FastAPI/uvicorn，單執行緒事件迴圈但仍可能多
   worker process）。由於本 Story 範圍不含選定服務框架，這裡採保守假設：
   不排除未來同一行程內有多個執行緒同時呼叫
   `get_project_metrics_cached()`。幫 `dict` 的讀寫加一個輕量
   `threading.Lock` 的成本極低（純記憶體操作，持鎖時間微秒級），卻能
   避免「兩個執行緒同時 miss 後各自寫入、或一個執行緒讀取時另一個正在
   刪除過期項」的 race，是不需要等框架選型就能先做對的部分；若未來確定
   是純 async 單執行緒模型，這個鎖也不會造成任何問題（asyncio 的
   coroutine 之間本身不會被鎖搶占，`Lock.acquire()`/`release()` 在無
   爭用時幾乎零成本）。多行程（multi-process）層級的共享則明確不在範圍
   內（見 G1 範圍外「不做分散式或跨行程共享快取」）。

## UI 原型

無，本 Story 不涉及前端 UI——這是服務層的快取包裝，沒有新增或變更任何
畫面、元件或樣式。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄（與 SDLCCT-10/SDLCCT-9 設計文件記錄的
狀況相同，此後未變）。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題(定稿時必須為空)

（無）
