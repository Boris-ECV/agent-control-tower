# 設計文件 — SDLCCT-17 Opik read client: trace search endpoint (sort by cost)

## 對應需求規格

對應 G1 已核准的需求規格「Opik read client: trace search endpoint (sort by
cost)」。延續 SDLCCT-10/15 已建立的共用 Opik 唯讀客戶端慣例（明確參數
強制、型別化錯誤、`Comet-Workspace` 標頭、單頁不迴圈的先例），把
`seed/verify.py` 第 143-149 行已驗證過的 `/v1/private/traces` 查詢（依
`total_estimated_cost` 排序）封裝成一個函式庫層函式。

4 條 AC 對應範圍：依 `total_estimated_cost` 由高到低排序回傳 trace 清單
（AC1）、未帶 `project_name` 時提前拒絕、不送出 HTTP 請求（AC2）、後端
非 2xx/逾時時拋型別化例外、不回傳空清單掩蓋（AC3）、一律帶
`Comet-Workspace` 標頭（AC4）。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：trace 樹（span tree）
組裝；依 metadata 篩選的 trace 搜尋（SDLCCT-20）；`/v1/private/spans`
查詢；對 Opik 任何寫入；新增/變更 Portal 對外 HTTP 路由；快取
（SDLCCT-11 的 `TTLCache` 存在但本票不套用）；多頁分頁迴圈；
`/v1/private/projects/stats`、`/v1/private/workspaces/costs`（SDLCCT-15
已封裝）。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——沿用 SDLCCT-10/15/16 的定位，這是
純函式庫層的新增模組。它呼叫的是 Opik 後端既有端點，請求/回應形狀逐字
引用自 `seed/verify.py` 第 143-149 行（已在真實 Opik 實例上驗證過）：

```
GET /v1/private/traces?project_name=<str>&size=<int>&sorting=<JSON 字串>
Headers: Comet-Workspace: <workspace>

sorting 範例: [{"field": "total_estimated_cost", "direction": "DESC"}]
             (json.dumps 後以字串形式放進 query string)

Response 200: {"content": [{"id": "<id>", "metadata": {...} | null, ...}, ...]}
```

`metadata` 已驗證可能為 `null`（`seed/verify.py` 用
`(t.get("metadata") or {})` 處理），其餘欄位未被驗證過，不臆測欄位名稱
或型別。不帶 `sorting` 時回應為 `{"total": <int>}`（`seed/verify.py` 本
身沒有示範這個無 `sorting` 的呼叫，但需求規格文字明確提到此形狀作為
背景事實）——**本 Story 的函式不使用這個「取總數」形狀**：AC 只要求
「依成本排序的清單」，沒有任何 AC 要求回傳總數，為它建一個額外分支
會超出 4 條 AC 的範圍，因此不實作、不在函式簽名中出現。

### 新增模組位置：`bff/opik_traces.py`（新檔案，不放進既有模組）

沿用 SDLCCT-15/16 建立的先例（依端點家族分檔，讓依賴/測試範圍各自獨立，
見 SDLCCT-10 設計文件決策 #2）。`/v1/private/traces` 在請求/回應結構上
與既有兩個模組的端點都不同族：

- `bff/opik_metrics.py`（SDLCCT-10）圍繞單一 `project_id` 路徑參數與
  `metric_type`/`interval`/`breakdown` 概念，是「project metrics 端點
  家族」。
- `bff/opik_workspace.py`（SDLCCT-15）是「workspace/project 摘要端點
  家族」（`workspaces/costs`、`projects/stats`）。
- `/v1/private/traces` 是「單一 project 的 trace 清單查詢端點」，用
  `project_name`（不是 `project_id`）、`size`、`sorting` 這組概念，與
  上述兩族都不吻合。把它硬塞進任一既有檔案都會混淆該檔案目前單一的
  端點家族邊界，因此新開同層模組 `bff/opik_traces.py`，只放這一個
  端點。

**重用，不重複**：`base_url()`/`_client()`/例外類別
(`OpikConfigError`/`OpikClientError`/`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError`/`MissingProjectIdsError`) 全部直接從
`opik_metrics` import 使用（flat import，與 `bff/opik_workspace.py`
實際採用的匯入方式一致：`bff/` 內各模組彼此以 flat import 互相引用，
不是 `from bff.opik_metrics import ...`），不在新模組重新定義任何一份。
目錄結構：

```
bff/
  opik_metrics.py          # 既有(SDLCCT-10/11),不變動
  opik_workspace.py        # 既有(SDLCCT-15),不變動
  opik_traces.py           # 本 Story 的唯一程式碼產出
  tests/
    test_opik_traces.py    # developer 依 4 條 AC 撰寫
```

### 函式簽名與型別

```python
"""Read-only Opik client for the trace search endpoint, sorted by cost
(SDLCCT-17): /v1/private/traces.

Reuses opik_metrics's base_url()/_client()/exception hierarchy directly --
this module does not redefine any of them. Trace-tree (span) assembly is
explicitly out of scope -- see decision below; this module returns only a
flat, cost-sorted list.
"""

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from opik_metrics import (
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    _client,
)

DEFAULT_TOP_TRACES_SIZE = 10  # matches the validated seed/verify.py call shape


@dataclass(frozen=True)
class TraceSummary:
    id: str
    metadata: dict[str, Any] | None  # verified field; backend may return null
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /traces content entry as returned by the backend,
    # so fields seed/verify.py has not exercised are not silently discarded
    # -- same escape-hatch pattern as SDLCCT-15's ProjectStats.raw.


def get_top_traces_by_cost(
    project_name: str,
    *,
    size: int = DEFAULT_TOP_TRACES_SIZE,
) -> tuple[TraceSummary, ...]:
    """GET /v1/private/traces, sorted by total_estimated_cost DESC, for a
    single project_name.

    - project_name must be a non-empty string -> MissingProjectIdsError
      otherwise; no request is sent in that case (AC2). Reusing
      MissingProjectIdsError here (not a new exception class) because its
      existing semantics -- "a required identifying parameter was not
      supplied, caller-side contract violation, no query-all fallback" --
      apply identically to a missing project_name; see decision below.
    - size caps the number of returned traces (passed straight through to
      the backend's size param); no multi-page loop (see decision below).
    - Returned tuple order is exactly the backend's response order (backend
      already sorts DESC by total_estimated_cost per the validated request;
      this function does not re-sort client-side).
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns an empty
      tuple on failure (AC3).
    """
    if not project_name:
        raise MissingProjectIdsError(
            "project_name must be non-empty: an explicit project name is required"
        )
    endpoint = "/v1/private/traces"
    params = {
        "project_name": project_name,
        "size": size,
        "sorting": json.dumps([{"field": "total_estimated_cost", "direction": "DESC"}]),
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
        return _parse_traces_response(r, endpoint)


def _parse_traces_response(r: httpx.Response, endpoint: str) -> tuple[TraceSummary, ...]:
    try:
        payload = r.json()
        return tuple(
            TraceSummary(id=item["id"], metadata=item.get("metadata"), raw=item)
            for item in payload["content"]
        )
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc
```

AC 對應關係：

| AC | 對應設計 |
|---|---|
| 1. 依 `total_estimated_cost` 由高到低排序,每筆至少含 `id`/`metadata` | `params["sorting"]` 固定帶 `[{"field": "total_estimated_cost", "direction": "DESC"}]`（`json.dumps` 序列化,與 `seed/verify.py` 第 144 行逐字一致）；`TraceSummary.id`/`metadata` 型別化,其餘欄位保留於 `raw` |
| 2. 未指定 `project_name` 時拒絕查詢、不送出 HTTP 請求 | `get_top_traces_by_cost()` 在組 `params`/呼叫 `_client()` 之前先檢查 `project_name`,空字串直接 `raise MissingProjectIdsError`,函式提前 return,從未進入 `with _client()` 區塊 |
| 3. 後端非 2xx/逾時時明確拋型別化錯誤,不回傳空清單掩蓋 | `OpikTimeoutError`/`OpikHTTPError`/`OpikResponseFormatError` 三者皆 raise,無任何 fallback return；解析失敗（如 `"content"` 缺失、`"id"` 缺失）同樣經由 `_parse_traces_response()` 轉為 `OpikResponseFormatError`,而不是回傳 `()` |
| 4. 一律帶 `Comet-Workspace` 標頭 | 重用 `opik_metrics._client()`,每次呼叫即時讀取 env var 建立帶標頭的 client |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`TraceSummary` 是
記憶體內的回應型別（dataclass），生命週期僅限於一次查詢呼叫，與
SDLCCT-10/15 的資料模型決策一致。

## 關鍵技術決策

### 1. 新開 `bff/opik_traces.py`，不加進 `opik_metrics.py` 或 `opik_workspace.py`

見上方「介面/API 契約」說明：`/v1/private/traces` 用 `project_name`/
`size`/`sorting` 這組概念，與既有兩個模組圍繞的端點家族（單一
`project_id` 路徑參數的 metrics 端點；workspace/project 摘要端點）都不
同構，分檔維持每個檔案概念單一、測試範圍獨立，延續 SDLCCT-15/16 的
先例。

### 2. Trace 樹（span tree）組裝邏輯完全不放在本模組——留給未來一個
   已單獨驗證 `/v1/private/spans` 形狀的 Story

這是 G1 明確列為範圍外、留給本設計決定的 HOW 決策。本故事的 4 條 AC
只要求「依成本排序的 flat 清單」，沒有任何 AC 提到 span、root/child
關係或樹狀結構。`seed/verify.py` 第 150-154 行確實示範了「取得最貴
trace 後再查其 span 樹」的使用情境，但那是**呼叫端（未來的 BFF/Portal
層或另一張票）組合兩次查詢的範例**，不是本端點本身回應的一部分
——`/v1/private/traces` 的回應裡完全沒有 span 資料。若在本模組內
「順便」加一個組 span 樹的函式，等於：(a) 把 G1 已核准排除在範圍外的
`/v1/private/spans` 查詢塞進本票的實作範圍，產品/驗收範圍被悄悄擴大；
(b) 替一張尚未存在、範圍未定的未來 Story（HOW 要不要分頁、要不要快取
spans、怎麼定義「樹」的資料結構）預先做設計決策，違反「不要往前設計
未來故事」的原則。因此明確決定：本模組只回傳 `get_top_traces_by_cost()`
這一個 flat-list 函式；trace 樹組裝邏輯是否放在客戶端層或 BFF 更上層,
由需要它的未來 Story 自己決定並設計，本文件不預判。

### 3. 重用 `MissingProjectIdsError`，不新增 `MissingProjectNameError`

`MissingProjectIdsError` 現有語意（「必要的識別參數未提供，呼叫端
契約違反，沒有查詢全部的 fallback」）與「未提供 `project_name`」的
失敗模式完全對應，只是識別參數的名稱從 `project_id(s)` 換成
`project_name`。新增一個幾乎同語意的例外類別只會讓呼叫端
（未來的 Portal 路由層）的 `except` 區塊需要多列一個分支去處理本質
相同的錯誤，增加不必要的認知負擔，且違反 SDLCCT-15 決策 #6 確立的
「`bff/` 內所有 Opik 模組對外拋同一組例外型別」原則。

### 4. 不做多頁迴圈，`size` 為可覆寫參數，預設值取自 `seed/verify.py`
   驗證過的呼叫形狀（`10`）

`seed/verify.py` 唯一驗證過的呼叫是 `size=10`；回應分頁中繼資料（是否
有 `"total_pages"`/下一頁游標等）完全未被驗證過。與 SDLCCT-15 決策 #3
（`/projects/stats` 不做分頁迴圈）同一取捨：不臆測未驗證的分頁契約。
`size` 保留為可覆寫參數，呼叫端如需要更大/更小的上限可自行指定，但
本模組本身不實作多頁迴圈；需要迴圈分頁留給未來一個先對後端分頁欄位
做過驗證的 Story。

### 5. `TraceSummary` 只對已驗證欄位（`id`、`metadata`）提供型別化屬性，
   其餘欄位保留在 `raw: dict`

`seed/verify.py` 只驗證過 `content[]` 底下的 `"id"` 與 `"metadata"`
（第 147-149 行）；回應極可能攜帶其他欄位（例如
`total_estimated_cost` 本身，排序用的那個欄位），但本故事沒有驗證過
它們在回應裡的確切鍵名/型別，不替未驗證欄位掛上型別化保證（違反
「不可臆測後端形狀」原則）。保留 `raw: dict` 讓資料不被無理由丟棄，
延續 SDLCCT-15 的 `ProjectStats.raw` 先例——這不是替任何未來故事
（例如依 metadata 篩選的 SDLCCT-20）預先設計介面，`raw` 純粹是本故事
「不丟資料」這個單純目的的被動保留。

### 6. 回應順序原樣信任後端排序，不在客戶端二次排序

需求規格與 `seed/verify.py` 都把排序責任放在後端（`sorting` query
參數驅動）。客戶端若再做一次 `sorted(...)`，等於臆測
`total_estimated_cost` 一定存在於每筆回應項目中並可比較——但決策 #5
已說明這個欄位本身未被型別化（只在 `raw` 裡）；若該假設有誤，二次
排序反而可能比對到 `None`/缺失鍵而拋出與「後端排序失敗」無關的
`TypeError`，混淆錯誤訊息的真正原因。因此信任後端回應順序即最終順序，
不做客戶端二次排序。

### 7. 例外處理完全重用 `opik_metrics` 既有型別，不新增任何例外類別

`MissingProjectIdsError`/`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError` 在語意上與本故事唯一端點的失敗模式完全對應
（缺少必要識別參數、非 2xx、timeout、格式不符），沒有理由發明新的
例外類別，延續 SDLCCT-15 決策 #6 的理由：維持 `bff/` 內所有 Opik 模組
對外拋出同一組例外型別。

## UI 原型

無，本 Story 不涉及前端 UI——這是服務層的 Python 查詢客戶端，沒有新增
或變更任何畫面、元件或樣式。Portal 畫面本身尚未存在，其 UI 技術選型是
未排程的未來故事的範圍，非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/16 設計文件
記錄的狀況相同，此後未變。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題（定稿時必須為空）

（無）
