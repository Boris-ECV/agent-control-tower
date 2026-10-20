# 設計文件 — SDLCCT-53 Opik read client: spans endpoint and trace tree assembly

## 對應需求規格

對應 G1 已核准的需求規格「Opik read client: spans endpoint and trace
tree assembly」(畫面 #4「執行詳情」的前置資料層，下一張票 SDLCCT-54
的依賴)。延續 SDLCCT-10/15/17 已建立的共用 Opik 唯讀客戶端慣例（明確
參數強制、型別化錯誤、`raw` 逃生艙、單頁不迴圈的先例），把
`seed/verify.py` 第 143-154 行已驗證過的 `/v1/private/spans` 查詢，以
及一個獨立的、不碰網路的樹狀組裝函式封裝起來。

7 條 AC 對應範圍：`project_name` 缺失時提前拒絕、不送出 HTTP 請求
（AC1）；`trace_id` 缺失時同樣提前拒絕（AC2，沿用 AC1 的例外類別）；
正常呼叫回傳不可變扁平 span 清單，長度 91，`id`/`parent_span_id` 型別化、
其餘欄位保留於 `raw`（AC3）；非 2xx 拋 `OpikHTTPError`（AC4）；逾時/
格式不符分別拋 `OpikTimeoutError`/`OpikResponseFormatError`（AC5）；
扁平清單組成樹狀結構，子節點順序與輸入清單出現順序一致（AC6）；孤兒
span（`parent_span_id` 指向清單中不存在的 id）被視為額外頂層節點而非
被丟棄或整體失敗（AC7）。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：畫面本身
（SDLCCT-54）；依 metadata 篩選的 trace 搜尋（SDLCCT-20）；span 層級
以外的聚合指標（`opik_metrics.py` 已處理）；HTTP API 端點設計；個別
span 物件除 `id`/`parent_span_id` 以外欄位的完整形狀核對——**這點明確
留給本文件處理，見下方「關鍵技術決策 #1」**。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——沿用 SDLCCT-10/15/17 的定位，這是
純函式庫層的新增模組。它呼叫的是 Opik 後端既有端點，請求/回應形狀逐字
引用自 `seed/verify.py` 第 151-154 行（已在真實 Opik 實例上驗證過，
含回應筆數 91）：

```
GET /v1/private/spans?project_name=<str>&trace_id=<str>&size=<int>
Headers: Comet-Workspace: <workspace>

Response 200: {"content": [{"id": "<id>", "parent_span_id": "<id>" | null, ...}, ...]}
```

`seed/generate.py` 第 139、167-171 行（write 側，已獨立核對）確認每個
寫入的 span dict 一定帶 `parent_span_id` 鍵（根節點為 `null`），以及
`id`/`project_name`/`trace_id`/`name`/`type`/`start_time`/`end_time`/
`input`/`output`，部分 span 另帶 `model`/`provider`/`usage`/
`error_info`。但這是寫入側證據，不是讀取回應本身的逐位元組驗證——見
下方決策 #1，本設計刻意只對 AC 要求的 `id`/`parent_span_id` 建立型別化
保證，其餘欄位一律經由 `raw` 逃生艙保留，不需要也不等待讀取側逐欄位
核對。

### 新增模組位置：`bff/opik_spans.py`（新檔案）

沿用 SDLCCT-17 建立的「依端點家族分檔」先例：`/v1/private/spans` 用
`project_name`/`trace_id`/`size` 這組概念，與 `opik_metrics.py`
（`project_id` 路徑參數 + metric_type 概念）、`opik_workspace.py`
（workspace/project 摘要）、`opik_traces.py`（`/v1/private/traces`，
`project_name`+`sorting`，無 `trace_id`、無樹狀結構）都不同構，因此
新開同層模組，只放這一個端點與樹狀組裝邏輯（樹狀組裝是純記憶體運算，
不發送請求，但概念上與「同一個 trace 的 span 清單」強耦合，放在同一
檔案比起分成兩檔更符合「依端點家族」的既有切分原則）。

**重用，不重複**：`_client()`/例外類別
(`MissingProjectIdsError`/`OpikHTTPError`/`OpikTimeoutError`/
`OpikResponseFormatError`) 全部直接從 `opik_metrics` flat import，
與 `opik_traces.py`/`opik_workspace.py` 一致，不在新模組重新定義。

目錄結構：

```
bff/
  opik_metrics.py          # 既有(SDLCCT-10/11),不變動
  opik_workspace.py        # 既有(SDLCCT-15),不變動
  opik_traces.py           # 既有(SDLCCT-17),不變動
  opik_spans.py            # 本 Story 的唯一程式碼產出
  tests/
    test_opik_spans.py     # developer 依 7 條 AC 撰寫
```

### 函式簽名與型別

```python
"""Read-only Opik client for the spans endpoint (SDLCCT-53):
/v1/private/spans, plus a network-free function to assemble a flat span
list into a tree (root + orphan top-level nodes).

Reuses opik_metrics's _client()/exception hierarchy directly -- this
module does not redefine any of them. Field-shape note: only `id` and
`parent_span_id` are given typed attributes (verified on the read side
by seed/verify.py's count assertion and on the write side by
seed/generate.py's _span() helper); every other field is preserved
verbatim via `raw` -- see docs/design/SDLCCT-53.md decision #1.
"""

from collections.abc import Sequence
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

DEFAULT_TRACE_SPANS_SIZE = 200  # matches the validated seed/verify.py call shape


@dataclass(frozen=True)
class SpanSummary:
    id: str
    parent_span_id: str | None  # verified field; None marks the trace's root span
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /spans content entry as returned by the backend,
    # so fields this Story's AC does not pin (name, start_time/end_time,
    # type, model/provider/usage, error_info, ...) are never silently
    # discarded -- same escape-hatch pattern as opik_traces.TraceSummary.


@dataclass(frozen=True)
class SpanNode:
    span: SpanSummary
    children: tuple["SpanNode", ...]
    # Child order == order of first appearance in the input sequence to
    # build_span_tree() (AC6); orphan spans are returned as additional
    # top-level SpanNode entries, same level as the root (AC7) -- see
    # decision #2.


def get_trace_spans(
    project_name: str,
    trace_id: str,
    *,
    size: int = DEFAULT_TRACE_SPANS_SIZE,
) -> tuple[SpanSummary, ...]:
    """GET /v1/private/spans for a single (project_name, trace_id) pair.

    - project_name and trace_id must both be non-empty strings ->
      MissingProjectIdsError otherwise (reusing the existing exception
      class, not a new one -- see decision #3); no request is sent in
      that case (AC1, AC2).
    - size caps the number of returned spans (passed straight through to
      the backend's size param); no multi-page loop, same precedent as
      opik_traces.get_top_traces_by_cost (SDLCCT-17 decision #4).
    - Returned tuple order is exactly the backend's response order; this
      function does not reorder.
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns an
      empty tuple on failure (AC4, AC5).
    """
    if not project_name or not trace_id:
        raise MissingProjectIdsError(
            "project_name and trace_id must both be non-empty: "
            "explicit identifiers are required"
        )
    endpoint = "/v1/private/spans"
    params = {"project_name": project_name, "trace_id": trace_id, "size": size}
    with _client() as c:
        try:
            r = c.get(endpoint, params=params)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        return _parse_spans_response(r, endpoint)


def _parse_spans_response(r: httpx.Response, endpoint: str) -> tuple[SpanSummary, ...]:
    try:
        payload = r.json()
        return tuple(
            SpanSummary(id=item["id"], parent_span_id=item.get("parent_span_id"), raw=item)
            for item in payload["content"]
        )
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def build_span_tree(spans: Sequence[SpanSummary]) -> tuple[SpanNode, ...]:
    """Assemble a flat span list (same trace_id) into a tree.

    Pure, network-free, no backend errors possible. Returns one SpanNode
    per top-level span: the single root (parent_span_id is None) plus,
    at the same level, any orphan span whose parent_span_id does not
    match any id present in `spans` (AC7) -- e.g. because a size-capped
    get_trace_spans() call truncated the parent out of the list. Within
    every node, children are ordered by first appearance in `spans`
    (AC6). Does not assume there is exactly one root-like span; if
    `spans` is empty, returns an empty tuple.
    """
    by_id = {s.id: s for s in spans}
    children_of: dict[str | None, list[SpanSummary]] = {}
    for s in spans:
        parent_key = s.parent_span_id if s.parent_span_id in by_id else None
        children_of.setdefault(parent_key, []).append(s)

    def make_node(s: SpanSummary) -> SpanNode:
        return SpanNode(
            span=s,
            children=tuple(make_node(c) for c in children_of.get(s.id, [])),
        )

    return tuple(make_node(s) for s in children_of.get(None, []))
```

AC 對應關係：

| AC | 對應設計 |
|---|---|
| 1. `project_name` 缺失時不送請求、拋 `MissingProjectIdsError` | `get_trace_spans()` 在組 `params`/呼叫 `_client()` 之前先檢查，空值直接 `raise`，從未進入 `with _client()` |
| 2. `trace_id` 缺失時同樣不送請求、拋同一例外類別 | 同一個 `if not project_name or not trace_id` 判斷涵蓋兩者，沿用 `MissingProjectIdsError` |
| 3. 正常呼叫回傳不可變扁平清單，長度 91，`id`/`parent_span_id` 可讀、`raw` 保留原始物件 | `tuple[SpanSummary, ...]`（tuple 本身不可變）；`SpanSummary.id`/`parent_span_id` 型別化；`raw=item` 保留完整原始字典；呼叫形狀（`size=200`）對應 `DEFAULT_TRACE_SPANS_SIZE` |
| 4. 非 2xx 拋 `OpikHTTPError`（帶 endpoint/status），絕不回傳空序列 | `r.status_code != 200` 時 raise，無任何 fallback return |
| 5. 逾時/格式不符分別拋 `OpikTimeoutError`/`OpikResponseFormatError`（帶 endpoint） | `httpx.TimeoutException` → `OpikTimeoutError`；`_parse_spans_response()` 解析失敗（`"content"`/`"id"` 缺失等）→ `OpikResponseFormatError` |
| 6. 扁平清單組成樹，子節點順序與輸入清單出現順序一致 | `children_of` 用 `list.append` 依 `spans` 原始順序累積，`make_node()` 遞迴建樹時 `tuple(make_node(c) for c in children_of.get(s.id, []))` 保留該順序 |
| 7. 孤兒 span 被視為額外頂層節點，不被丟棄或導致整體失敗 | `parent_key = s.parent_span_id if s.parent_span_id in by_id else None`——`parent_span_id` 指向清單中不存在的 id 時，視同根節點歸入 `children_of[None]`，與真正的根節點同層級回傳 |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`SpanSummary`/
`SpanNode` 都是記憶體內的回應型別（dataclass），生命週期僅限於一次
查詢/一次樹狀組裝呼叫，與 SDLCCT-10/15/17 的資料模型決策一致。

## 關鍵技術決策

### 1. 個別 span 物件除 `id`/`parent_span_id` 以外欄位的完整形狀，刻意不
   逐位元組核對讀取側回應——只對 AC 實際要求的兩個欄位建立型別化保證

G1 明確把這個問題留給本次 G1b 處理，不可再往後推。結論：**可以、也
應該只用 AC 實際要求的欄位設計出一個規格完整的模組**，不需要（事實上
也沒有 Bash/真實後端存取可以做到）逐位元組核對讀取側回應。理由：

- 7 條 AC 逐條核對後，唯一被斷言「必須可讀出」的欄位只有 `id` 與
  `parent_span_id`（AC3「其中至少可讀出 id、parent_span_id 兩個已驗證
  欄位」）；樹狀組裝（AC6、AC7）同樣只依賴這兩個欄位的值與彼此的
  指向關係，不涉及 `name`/`start_time` 等欄位的型別或是否存在。
- `name`/`start_time`/`end_time`/`type`/`model`/`provider`/`usage`/
  `error_info` 等欄位在 `seed/generate.py` 第 167-171 行（write 側）
  確實存在，且與 `opik_traces.TraceSummary`（SDLCCT-17）對「未驗證
  欄位」的既有取捨完全一致：讀取側回應的逐欄位真實型別從未被
  `seed/verify.py` 斷言過，為它們掛上型別化屬性等於臆測未驗證的回應
  形狀，違反本 repo 既有的「不可臆測後端形狀」原則。
- 因此唯一能同時滿足「規格完整」與「不臆測」的設計就是：`id`/
  `parent_span_id` 型別化，其餘欄位整包保留在 `raw: dict[str, Any]`
  逃生艙——這正是 AC3 本身的措辭所暗示的形狀（「保留原始回應物件」+
  「至少可讀出兩個已驗證欄位」），不是本文件自行放寬範圍。
- 若真的出現一條 AC 需要依賴某個未驗證欄位的確切名稱/型別才能實作
  （例如要求依 `name` 分類節點），那會是本文件無法獨立解決的開放設計
  問題；逐條檢查後，7 條 AC 都不需要任何 `raw` 以外的欄位，因此沒有
  這樣的問題，不開放設計問題、不升級 HUMAN-INPUT。

### 2. 孤兒 span 的「頂層」判定：依「`parent_span_id` 是否存在於同一批
   輸入清單」而非「是否等於 `None`」

AC7 明確要求孤兒 span（`parent_span_id` 指向清單中不存在的 id）被視為
「額外的頂層節點」，與真正的根節點（`parent_span_id is None`）同層級
回傳，而不是被丟棄或讓整體組裝拋例外。`build_span_tree()` 用
`children_of` 字典、以「`parent_span_id in by_id`」作為唯一判斷式：
成立則掛在對應父節點下，不成立（包含 `parent_span_id is None` 的根
節點，以及指向清單外 id 的孤兒）一律歸入 `children_of[None]` 這個
頂層桶。這個單一判斷式同時滿足 AC6 的根節點情境與 AC7 的孤兒情境，不
需要為孤兒另開特殊分支，降低邏輯分岔造成的測試遺漏風險。

### 3. 例外處理完全重用 `opik_metrics` 既有型別，不新增任何例外類別；
   `project_name`/`trace_id` 共用同一個 `MissingProjectIdsError`

與 SDLCCT-17 決策 #3/#7 同一取捨：`MissingProjectIdsError` 既有語意
（「必要的識別參數未提供，呼叫端契約違反，沒有查詢全部的 fallback」）
對 `project_name`、`trace_id` 兩者完全對應，AC1/AC2 本身也明文指定
「沿用既有例外類別」，不新增 `MissingTraceIdError`。延續「`bff/` 內
所有 Opik 模組對外拋同一組例外型別」的既有原則（SDLCCT-15 決策 #6）。

### 4. 不做多頁迴圈，`size` 為可覆寫參數，預設值取自 `seed/verify.py`
   驗證過的呼叫形狀（`200`）

`seed/verify.py` 唯一驗證過的呼叫是 `size=200`（回傳 91 筆，低於上限，
不觸及分頁邊界）；回應分頁中繼資料是否存在完全未被驗證過。與
SDLCCT-15 決策 #3、SDLCCT-17 決策 #4 同一取捨：不臆測未驗證的分頁
契約，`size` 保留為可覆寫參數，不在本模組內實作多頁迴圈。這也與 AC7
的情境描述一致（「例如因查詢 size 截斷導致父節點未被取回」本身就預期
呼叫端可能傳入一個會造成截斷的 `size`，而不是由本模組自動迴圈到拿齊
為止）。

### 5. 樹狀組裝函式 `build_span_tree()` 與 HTTP 呼叫函式
   `get_trace_spans()` 放在同一模組，但彼此完全不互相呼叫

`build_span_tree()` 是純函式（輸入 `Sequence[SpanSummary]`，輸出
`tuple[SpanNode, ...]`，不接受 `project_name`/`trace_id`、不發送任何
請求），刻意不在內部呼叫 `get_trace_spans()`。這讓 AC6/AC7（樹狀組裝
正確性）可以用手造的 `SpanSummary` 清單測試，完全不需要 mock HTTP
client；也讓下游呼叫端（SDLCCT-54）可以自由選擇「先查詢再組樹」或
「對同一份已查詢結果重新組樹」，不被綁死成單一組合函式。兩者放同一
檔案只是因為屬於同一個端點家族（見上方模組位置決策），不是耦合實作。

## UI 原型

無，本 Story 不涉及前端 UI——這是服務層的 Python 查詢客戶端與一個
純記憶體樹狀組裝函式，沒有新增或變更任何畫面、元件或樣式。畫面本身
（「執行詳情」）是下一張票 SDLCCT-54 的範圍，其 UI 技術選型非本 Story
決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/16/17/48 設計
文件記錄的狀況相同，此後未變（SDLCCT-48 的前端畫面與本 Story 的
後端資料層無任何 selector 重疊）。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無相關結果。不適用。

## 開放設計問題（定稿時必須為空）

（無）
