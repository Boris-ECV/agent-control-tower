# 設計文件 — SDLCCT-15 Opik read client: workspace/project summary endpoints

## 對應需求規格

對應 G1 已核准的需求規格「Opik read client: workspace/project summary
endpoints」。延續 SDLCCT-10 已建立的共用 Opik 唯讀客戶端慣例（明確
project id 強制、型別化錯誤、`Comet-Workspace` 標頭、SDLCCT-9 演示錨點
日），把兩個已在 `seed/verify.py` 驗證過的摘要端點封裝起來：

- `/v1/private/workspaces/costs`（POST，9 條 AC 中前 5 條）
- `/v1/private/projects/stats`（GET，後 5 條）

範圍外（已於 G1 核准,不可擴大）：不對 Opik 執行任何寫入;不新增或變更
Portal 對外的 HTTP 路由;`/projects/{id}/kpi-cards`（移出至 SDLCCT-18,
本文件完全不觸碰);`/spans/stats` 與 trace 搜尋端點(SDLCCT-16/17);快取
(SDLCCT-11 的 `TTLCache` 存在但本票不套用);BFF/API 層技術選型(已於
SDLCCT-10 G1b 決定)。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——沿用 SDLCCT-10/SDLCCT-11 的定位,這是
純函式庫層的新增模組。它呼叫的是 Opik 後端既有端點(已由 `seed/verify.py`
在真實後端驗證過的請求/回應形狀,引用如下)。

### 新增模組位置:`bff/opik_workspace.py`(新檔案,不放進 `bff/opik_metrics.py`)

`bff/opik_metrics.py`(SDLCCT-10)的既有定位是「單一 project 的
`/v1/private/projects/{project_id}/metrics` 端點家族」——`metric_type`/
`interval`/`breakdown` 都是圍繞這一個端點設計的概念,路徑帶 `project_id`。
本 Story 的兩個端點結構上是不同的家族:`/v1/private/workspaces/costs` 是
workspace 層級、body 帶 `project_ids` 清單(無 `metric_type`/`interval`/
`breakdown`);`/v1/private/projects/stats` 是分頁查詢、不帶路徑
`project_id`、也不支援 `metric_type`,甚至不支援後端原生的 project id
篩選。把這兩個端點硬塞進 `opik_metrics.py` 會讓該檔案的概念邊界(「project
metrics 家族」)變得模糊,且與 SDLCCT-10 設計文件決策 #2「依用途分檔,讓
依賴/測試/覆蓋率門檻各自獨立」的精神矛盾。因此新開一個同層模組
`bff/opik_workspace.py`,只放這兩個端點。

**重用,不重複**:`base_url()`/`_client()`/例外類別
(`OpikConfigError`/`OpikClientError`/`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError`/`MissingProjectIdsError`)與 `_iso()` 序列化
helper 全部直接從 `bff.opik_metrics` import 使用,不在新模組重新定義一份
`base_url()`/`_client()` 或任何例外類別。兩個模組在同一個 `bff/` 套件內,
`_client()`/`_iso()` 雖是底線前綴的模組內部慣例,但套件內互相 import 是
正常作法,不是跨套件依賴(與 SDLCCT-10 決策 #3「不跨套件 import
`seed.anchor`」是不同情境——那裡是避免綁住另一個獨立套件的全部依賴;這裡
`opik_metrics.py` 本來就是 `bff/` 自己的模組)。目錄結構:

```
bff/
  opik_metrics.py          # 既有(SDLCCT-10/11),不變動
  opik_workspace.py        # 本 Story 的唯一程式碼產出
  tests/
    test_opik_workspace.py # developer 依 10 條 AC 撰寫
```

### 已驗證過的後端請求/回應形狀(來自 `seed/verify.py`,已在真實 Opik
實例上跑通,逐字引用)

**`/v1/private/workspaces/costs`**(`seed/verify.py` 第 87-96 行):

```
POST /v1/private/workspaces/costs
Headers: Comet-Workspace: <workspace>
Body: {
  "project_ids": ["<id>", ...],
  "interval_start": "<ISO8601 Z>",
  "interval_end": "<ISO8601 Z>"
}
Response 200: {"results": [{"project_id": "<id>", "data": [{"time": "<ISO8601>", "value": <float|null>}, ...]}, ...]}
```

(`seed/verify.py::by_day()` 解析時用 `res.get("project_id") or
res.get("name")`,但本端點實際驗證場景是逐 project_id 彙整,固定會帶
`"project_id"` 鍵——與 `opik_metrics.py` 的單專案端點不同,那裡 `"name"`
是 breakdown 情境下才出現的鍵。)

**`/v1/private/projects/stats`**(`seed/verify.py` 第 98-106 行):

```
GET /v1/private/projects/stats?size=<int>&from_time=<ISO8601 Z>&to_time=<ISO8601 Z>
Headers: Comet-Workspace: <workspace>
Response 200: {"content": [{"project_id": "<id>", "total_estimated_cost_sum": <float>, ...其他未驗證欄位}, ...]}
```

此端點**不提供 project id 篩選參數**——`size`/`from_time`/`to_time` 是
唯一驗證過的查詢參數,回應是該 workspace 分頁後的全部專案列表。因此「明確
project id」的強制必須在本模組的客戶端解析層實現(見函式簽名)。

### 函式簽名與型別

```python
"""Read-only Opik client for workspace/project summary endpoints
(SDLCCT-15): /v1/private/workspaces/costs and /v1/private/projects/stats.

Reuses bff.opik_metrics's base_url()/_client()/exception hierarchy/_iso()
directly -- this module does not redefine any of them.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from bff.opik_metrics import (
    MetricPoint,
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    _client,
    _iso,
)

DEFAULT_PROJECTS_STATS_PAGE_SIZE = 100  # see decision below


@dataclass(frozen=True)
class ProjectStats:
    project_id: str
    total_estimated_cost_sum: float | None  # verified field; None if backend omits it
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /projects/stats entry as returned by the backend,
    # so fields seed/verify.py has not exercised (and this module therefore
    # does not type) are not silently discarded -- see decision below.


def get_workspace_daily_costs(
    project_ids: Sequence[str],
    *,
    interval_start: datetime,
    interval_end: datetime,
) -> dict[str, tuple[MetricPoint, ...]]:
    """POST /v1/private/workspaces/costs for the given project_ids.

    - project_ids must be non-empty -> MissingProjectIdsError otherwise;
      no request is sent in that case.
    - interval_start/interval_end are required (no default): callers pass
      SDLCCT-9's anchor date themselves (see bff.anchor.get_anchor_date()),
      this function never reads the system clock.
    - Backend scopes the response to the requested project_ids itself
      (verified in seed/verify.py); the returned dict's keys are exactly
      the project_ids the backend actually returned data for.
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns 0/empty
      on failure.
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    endpoint = "/v1/private/workspaces/costs"
    body = {
        "project_ids": list(project_ids),
        "interval_start": _iso(interval_start),
        "interval_end": _iso(interval_end),
    }
    with _client() as c:
        try:
            r = c.post(endpoint, json=body)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        return _parse_workspace_costs_response(r, endpoint)


def _parse_workspace_costs_response(
    r: httpx.Response, endpoint: str
) -> dict[str, tuple[MetricPoint, ...]]:
    try:
        payload = r.json()
        out: dict[str, tuple[MetricPoint, ...]] = {}
        for res in payload["results"]:
            pid = res["project_id"]
            points = tuple(
                MetricPoint(
                    time=datetime.fromisoformat(p["time"].replace("Z", "+00:00")),
                    value=p["value"],
                )
                for p in res["data"]
            )
            out[pid] = points
        return out
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def get_project_stats(
    project_ids: Sequence[str],
    *,
    from_time: datetime,
    to_time: datetime,
    page_size: int = DEFAULT_PROJECTS_STATS_PAGE_SIZE,
) -> dict[str, ProjectStats]:
    """GET /v1/private/projects/stats, then filter to the given project_ids
    on the client side (the backend has no project-id filter parameter).

    - project_ids must be non-empty -> MissingProjectIdsError otherwise;
      no request is sent in that case.
    - from_time/to_time are required (no default): same anchor-date
      contract as get_workspace_daily_costs().
    - Single page, page_size=100 by default (see decision below): the
      response is NOT looped over multiple pages.
    - The returned dict contains ONLY entries whose project_id is in
      project_ids -- any other project present in the single fetched page
      is dropped, never leaked into the result (AC: client-side filtering).
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status.
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    endpoint = "/v1/private/projects/stats"
    params = {
        "size": page_size,
        "from_time": _iso(from_time),
        "to_time": _iso(to_time),
    }
    with _client() as c:
        try:
            r = c.get(endpoint, params=params)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        all_stats = _parse_projects_stats_response(r, endpoint)

    wanted = set(project_ids)
    return {pid: s for pid, s in all_stats.items() if pid in wanted}


def _parse_projects_stats_response(r: httpx.Response, endpoint: str) -> dict[str, ProjectStats]:
    try:
        payload = r.json()
        out: dict[str, ProjectStats] = {}
        for item in payload["content"]:
            pid = item["project_id"]
            out[pid] = ProjectStats(
                project_id=pid,
                total_estimated_cost_sum=item.get("total_estimated_cost_sum"),
                raw=item,
            )
        return out
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc
```

這個簽名與 10 條 AC 的對應關係:

| AC 主題 | 對應設計 |
|---|---|
| `/workspaces/costs` 1. 未傳 project id 拒絕查詢、不送出 HTTP 請求 | `get_workspace_daily_costs()` 在組 body/呼叫 `_client()` 之前先檢查 `project_ids`,空清單直接 `raise MissingProjectIdsError`,函式提前 return,從未進入 `with _client()` 區塊 |
| `/workspaces/costs` 2. 傳明確 project id 成功取得每日成本,回應只含這些 id | 後端本身依請求 body 的 `project_ids` 範圍回應(已於 `seed/verify.py` 驗證);`_parse_workspace_costs_response()` 原樣回傳後端給的鍵,不額外擴充 |
| `/workspaces/costs` 3. 後端失敗明確拋型別化錯誤,不回傳 0/空 | `OpikTimeoutError`/`OpikHTTPError`/`OpikResponseFormatError`,三者皆 raise,無任何 fallback return |
| `/workspaces/costs` 4. 一律帶 Comet-Workspace 標頭 | 重用 `bff.opik_metrics._client()`,每次呼叫即時讀取 env var 建立帶標頭的 client |
| `/workspaces/costs` 5. 時間窗用演示錨點日,非系統時鐘 | `interval_start`/`interval_end` 必填參數,函式本身不讀系統時鐘,呼叫端自行傳入 `anchor.get_anchor_date()` 算出的窗口 |
| `/projects/stats` 1. 未傳 project id 拒絕查詢、不送出 HTTP 請求 | `get_project_stats()` 同樣在呼叫 `_client()` 之前檢查並 `raise MissingProjectIdsError` |
| `/projects/stats` 2. 傳明確 project id 只回傳對應專案,不混入其他專案 | 取得單頁 `all_stats` 後用 `wanted = set(project_ids)` 做字典推導式過濾,回傳值保證只含 `project_ids` 子集 |
| `/projects/stats` 3. 後端失敗明確拋型別化錯誤 | 同上三種例外,`_parse_projects_stats_response()` 捕捉解析期間的 `KeyError`/`TypeError`/`ValueError`/`AttributeError` |
| `/projects/stats` 4. 一律帶 Comet-Workspace 標頭 | 同樣重用 `_client()` |
| `/projects/stats` 5. 時間窗用演示錨點日,非系統時鐘 | `from_time`/`to_time` 必填參數,無預設值,無系統時鐘讀取 |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`ProjectStats` 與重用
的 `MetricPoint` 都是記憶體內的回應型別(dataclass),生命週期僅限於一次
查詢呼叫,與 SDLCCT-10/SDLCCT-11 的資料模型決策一致。

## 關鍵技術決策

### 1. 新開 `bff/opik_workspace.py`,不加進 `bff/opik_metrics.py`

見上方「介面/API 契約」的詳細說明:兩個端點家族的請求結構(workspace 層
`project_ids` 清單 vs. 分頁列表,都不像 `opik_metrics.py` 那樣路徑帶單一
`project_id`)與 `opik_metrics.py` 既有的「project metrics 家族」邊界不同,
分檔維持每個檔案的概念單一、測試範圍獨立。

### 2. 重用 `bff.opik_metrics` 的 `base_url()`/`_client()`/例外類別/`_iso()`,不重新定義

同一個 `bff/` 套件內部 import 不是跨套件依賴問題(與 SDLCCT-10 決策 #3
不同情境);重複定義一份 `_client()`/例外類別只會製造兩份需要同步維護的
「Comet-Workspace 標頭怎麼讀」「什麼算 timeout」邏輯,違反 DRY 且會讓
`bff/` 內的錯誤處理契約出現兩套,增加呼叫端（未來的 Portal 路由層）判斷
`except` 時的心智負擔。

### 3. `/projects/stats` 不做多頁迴圈,固定單頁 `size=100`

`seed/verify.py` 驗證過的唯一呼叫形狀正是 `size=100`,對應 demo 資料集的
9 個 agent project(`project-profile.yaml` 描述的 demo 規模),單頁已足夠
涵蓋全部專案。該端點回應只確認了 `"content"` 這個鍵,分頁中繼資料(例如
是否存在 `"total_pages"`/`"page"` 等欄位、欄位名稱)**未被 `seed/verify.py`
驗證過**——若自行假設一套分頁迴圈邏輯,等於在沒有真實驗證證據的情況下
臆測後端分頁契約的欄位名稱,與「不可臆測後端形狀」的原則衝突。因此做出
明確取捨:`page_size` 保留為可覆寫參數(呼叫端如知道專案數超過預設值可
自行調大),但本模組本身不實作多頁迴圈;若demo 規模之外需要迴圈分頁,
留給未來一個先對後端分頁欄位做過驗證的 Story 處理。

### 4. `/workspaces/costs` 不做額外的用戶端過濾;`/projects/stats` 做

`/workspaces/costs` 的請求 body 本身就帶 `project_ids`,後端依此範圍回應
(已驗證),用戶端再過濾一次是多餘的防禦性程式碼,且若後端真的回了範圍外
的資料而本模組又靜默丟棄,反而製造一個「看起來過濾正確但其實在掩蓋後端
異常」的假象。`/projects/stats` 的後端完全沒有 project id 篩選參數(已在
需求規格明確指出),因此過濾的責任只能落在用戶端——這條過濾邏輯本身就是
AC 要求的行為,不是防禦性冗餘。

### 5. `ProjectStats` 只對已驗證欄位(`project_id`、
`total_estimated_cost_sum`)提供型別化屬性,其餘欄位保留在 `raw: dict`

`seed/verify.py` 只驗證過這兩個欄位(第 101-106 行);為這兩個欄位之外的
任何屬性(例如後端可能也回傳的 trace 數、平均延遲等)建立具名屬性,等於
臆測一個未經驗證的回應形狀,違反「不可臆測後端形狀」原則。但後端 2xx
回應本身很可能攜帶這些額外欄位,若完全丟棄,會讓未來需要用到它們的
Story(例如本故事明確排除在範圍外的 SDLCCT-18 kpi-cards)必須重新呼叫
後端才能拿到同一筆資料。保留 `raw: dict` 讓資料不被無理由丟棄,同時不替
未驗證欄位掛上型別化保證(呼叫端若要用 `raw` 裡的欄位,自己承擔「這欄位
尚未被本模組驗證過」的風險)。這不是替 SDLCCT-18 預先設計介面——`raw` 是
本故事為了「不丟資料」這個單純目的做的被動保留,SDLCCT-18 自己的設計
仍需獨立決定它要怎麼用這份資料。

### 6. 例外處理完全重用 `bff.opik_metrics` 既有型別,不新增任何例外類別

`MissingProjectIdsError`/`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError` 在語意上與本故事兩個端點的失敗模式完全對應
(缺少明確 project id、非 2xx、timeout、格式不符),沒有理由發明新的例外
類別。維持 `bff/` 內所有 Opik 模組對外拋出同一組例外型別,讓未來任何呼叫
端(Portal 路由層)只需要寫一套 `except` 區塊即可覆蓋全部 Opik 查詢模組,
不需要因為呼叫的是哪個子模組而切換不同的例外處理邏輯。

## UI 原型

無,本 Story 不涉及前端 UI——這是服務層的 Python 查詢客戶端,沒有新增或
變更任何畫面、元件或樣式。Portal 畫面本身尚未存在,其 UI 技術選型是未
排程的未來故事的範圍,非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄,與 SDLCCT-9/10/11 設計文件記錄的狀況
相同,此後未變。確認:`Glob("**/portal*/**")`、`Glob("**/frontend*/**")`、
`Grep("toEqual|一致|consistent", path="tests")` 均無結果或無相關測試目錄
存在。不適用。

## 開放設計問題(定稿時必須為空)

（無）
