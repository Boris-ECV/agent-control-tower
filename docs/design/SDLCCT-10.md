# 設計文件 — SDLCCT-10 Opik read client: project metrics endpoints (explicit project ids, explicit error handling)

## 對應需求規格

對應 G1 已核准的需求規格「Opik read client: project metrics endpoints」。範圍：
建立一個可重用、唯讀的 Opik 查詢客戶端,涵蓋 project-metrics 端點家族
（`COST`、`TRACE_COUNT`、`TRACE_ERROR_RATE`、`SPAN_COUNT`、
`SPAN_TOKEN_USAGE`,可依 metadata key/tags/name 分拆）。每個查詢方法
必須要求明確的 project id(s)——沒有隱含的「查全部」;後端失敗（HTTP
錯誤、timeout、非預期格式)必須拋出帶 endpoint+status 的明確例外,絕不
靜默回傳 0/空值;一律送出 `Comet-Workspace` header（預設 `"default"`,
可用 `OPIK_WORKSPACE` 覆寫,沿用 `seed/client.py` 既有慣例）;時間窗查詢
必須用 SDLCCT-9 的錨點日(`seed/anchor.py::get_anchor_date()`),不可用
系統時鐘;cost 欄位缺失(provider/model/usage 缺)必須維持可區分的
「unknown」,不可強制轉成 0;`OPIK_BASE_URL` 必填,無預設值。範圍外
（已於 G1 核准,不可擴大）:不寫入 Opik、不做快取(SDLCCT-11)、其他三個
端點家族(SDLCCT-15/16/17,將重用本文件定義的客戶端基礎設施)、任何 UI。

**本 Story 同時是 Portal/BFF 技術棧的第一個決定點**（`project-profile.yaml`
目前標示 TBD,本工單帶 `needs-human-gate` 標籤,技術棧建議需經人類在
G1b 核准,非自動放行)——見下方「關鍵技術決策」第一項。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——它呼叫的是 Opik 後端既有的
`/v1/private/projects/{project_id}/metrics` 端點(已由 `seed/verify.py::
metric()` 在真實後端驗證過的請求/回應形狀,見下),本身不對外公開任何
新路由。未來 SDLCCT-15/16/17 若要把這個客戶端包成 Portal 自己的 HTTP
端點,是那些 Story 的範圍,非本文件決定。

本文件定義的是**一個 Python 函式庫模組的呼叫介面**:

### 新增模組位置:`bff/opik_metrics.py`

新建立於 repo 根目錄下的 `bff/`(與 `seed/` 同層的新頂層目錄,非
`seed/` 內部——`seed/` 的定位是「寫入示範資料的產生器」,`bff/` 是
「讀取 Opik 資料供 Portal 使用的服務層」,兩者用途不同、不應混在同一個
套件下。詳見下方技術決策)。目錄結構:

```
bff/
  pyproject.toml          # uv 管理,仿 seed/pyproject.toml(ruff + pytest + httpx 依賴)
  opik_metrics.py         # 本 Story 的唯一程式碼產出
  tests/
    test_opik_metrics.py  # developer 依 11 條 AC 撰寫
```

### 已驗證過的後端請求形狀(來自 `seed/verify.py::metric()`,已在真實
Opik 實例上跑通,本模組的請求 body 與此保持一致)：

```
POST /v1/private/projects/{project_id}/metrics
Headers: Comet-Workspace: <workspace>
Body: {
  "metric_type": "COST" | "TRACE_COUNT" | "TRACE_ERROR_RATE" | "SPAN_COUNT" | "SPAN_TOKEN_USAGE",
  "interval": "HOURLY" | "DAILY" | "TOTAL",
  "interval_start": "<ISO8601 Z>",
  "interval_end": "<ISO8601 Z>",
  "breakdown": {"field": "metadata", "metadata_key": "<key>"}   # optional
             | {"field": "tags"}                                 # optional
             | {"field": "name"}                                 # optional
}
Response 200: {"results": [{"name"|"project_id": <str>, "data": [{"time": <ISO8601>, "value": <float|null>}, ...]}, ...]}
```

這是單一 project 的端點(`project_id` 在路徑裡),Opik 並未提供這五個
metric type 共通的多專案端點(`/v1/private/workspaces/costs` 只覆蓋
`COST`,涵蓋不了其餘四種)。因此「明確多專案」的語意由本模組在客戶端
迴圈逐一呼叫、以 `project_id` 為 key 彙整結果來實現(見下方函式簽名),
不是後端原生支援多專案的單一請求。

### 函式簽名與型別

```python
"""Read-only Opik client for project metrics (SDLCCT-10).

Request shape (endpoint, Comet-Workspace header, base-url handling) is
consistent with seed/client.py's proven patterns, but this module is
reimplemented independently in bff/: it is read-only, long-running-process
safe (raises typed exceptions instead of seed/client.py's SystemExit), and
has no dependency on seed/.
"""

import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

import httpx

from bff.anchor import get_anchor_date  # vendored copy of seed/anchor.py; see decision below

BASE_URL_ENV_VAR = "OPIK_BASE_URL"
WORKSPACE_ENV_VAR = "OPIK_WORKSPACE"
DEFAULT_WORKSPACE = "default"


class MetricType(str, Enum):
    COST = "COST"
    TRACE_COUNT = "TRACE_COUNT"
    TRACE_ERROR_RATE = "TRACE_ERROR_RATE"
    SPAN_COUNT = "SPAN_COUNT"
    SPAN_TOKEN_USAGE = "SPAN_TOKEN_USAGE"


class Interval(str, Enum):
    HOURLY = "HOURLY"
    DAILY = "DAILY"
    TOTAL = "TOTAL"


class BreakdownField(str, Enum):
    METADATA = "metadata"
    TAGS = "tags"
    NAME = "name"


@dataclass(frozen=True)
class Breakdown:
    field: BreakdownField
    metadata_key: str | None = None  # required iff field is METADATA

    def __post_init__(self):
        if self.field is BreakdownField.METADATA and not self.metadata_key:
            raise ValueError("Breakdown(field=METADATA) requires metadata_key")


@dataclass(frozen=True)
class MetricPoint:
    time: datetime
    value: float | None  # None = "unknown" (missing provider/model/usage); NEVER coerced to 0.0


@dataclass(frozen=True)
class MetricSeries:
    key: str  # breakdown value (metadata value / tag / name), or the project_id itself when no breakdown
    points: tuple[MetricPoint, ...]


class MissingProjectIdsError(ValueError):
    """Raised when project_ids is empty. A caller-side contract violation,
    not a backend failure -- there is deliberately no "query all projects"
    fallback (AC: explicit project id(s) required)."""


class OpikConfigError(Exception):
    """Raised for configuration problems detected before any backend call
    is attempted (e.g. OPIK_BASE_URL unset). Distinct from OpikClientError:
    no endpoint was ever reached, so there is no endpoint/status to report."""


class OpikClientError(Exception):
    """Base class for an explicit failure of a specific backend call.
    Always carries the endpoint path and (when known) the HTTP status
    code, so a caller/log never has to guess which request failed."""

    def __init__(self, message: str, *, endpoint: str, status_code: int | None = None):
        super().__init__(f"{message} (endpoint={endpoint}, status={status_code})")
        self.endpoint = endpoint
        self.status_code = status_code


class OpikHTTPError(OpikClientError):
    """Non-2xx response from the backend."""


class OpikTimeoutError(OpikClientError):
    """Request timed out (status_code is always None)."""


class OpikResponseFormatError(OpikClientError):
    """2xx response but the JSON body did not match the expected shape
    (missing "results" key, "data" not a list, etc.)."""


def base_url() -> str:
    """The Opik backend address. Required: there is deliberately no default."""
    value = os.environ.get(BASE_URL_ENV_VAR, "").strip()
    if not value:
        raise OpikConfigError(f"{BASE_URL_ENV_VAR} is not set (example: https://<host>/api)")
    return value.rstrip("/")


def _client() -> httpx.Client:
    workspace = os.environ.get(WORKSPACE_ENV_VAR, "").strip() or DEFAULT_WORKSPACE
    return httpx.Client(base_url=base_url(), headers={"Comet-Workspace": workspace}, timeout=120.0)


def get_project_metrics(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None = None,
) -> dict[str, tuple[MetricSeries, ...]]:
    """Query one project's metrics endpoint for each id in `project_ids`,
    explicitly, and return {project_id: (MetricSeries, ...)}.

    - project_ids must be non-empty -> MissingProjectIdsError otherwise.
    - interval_start/interval_end are required (no default): callers that
      want "today" pass seed.anchor.get_anchor_date() themselves -- this
      module never reads the system clock and never guesses a window.
    - Any backend failure for any one project_id raises immediately
      (OpikHTTPError / OpikTimeoutError / OpikResponseFormatError) with
      that project's endpoint+status; partial results are not returned.
    - Null "value" entries in the response are preserved as Python None
      in MetricPoint.value (never replaced with 0.0).
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    body_base = {
        "metric_type": metric_type.value,
        "interval": interval.value,
        "interval_start": _iso(interval_start),
        "interval_end": _iso(interval_end),
    }
    if breakdown is not None:
        body_base["breakdown"] = (
            {"field": breakdown.field.value, "metadata_key": breakdown.metadata_key}
            if breakdown.field is BreakdownField.METADATA
            else {"field": breakdown.field.value}
        )

    out: dict[str, tuple[MetricSeries, ...]] = {}
    with _client() as c:
        for pid in project_ids:
            endpoint = f"/v1/private/projects/{pid}/metrics"
            try:
                r = c.post(endpoint, json=body_base)
            except httpx.TimeoutException as exc:
                raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
            except httpx.HTTPError as exc:
                raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
            if r.status_code != 200:
                raise OpikHTTPError(
                    "non-2xx response", endpoint=endpoint, status_code=r.status_code
                )
            out[pid] = _parse_metric_response(r, endpoint)
    return out


def _parse_metric_response(r: httpx.Response, endpoint: str) -> tuple[MetricSeries, ...]:
    try:
        payload = r.json()
        results = payload["results"]
        series = []
        for res in results:
            key = res.get("name") or res["project_id"]
            points = tuple(
                MetricPoint(time=datetime.fromisoformat(p["time"].replace("Z", "+00:00")), value=p["value"])
                for p in res["data"]
            )
            series.append(MetricSeries(key=key, points=points))
        return tuple(series)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def _iso(ts: datetime) -> str:
    from datetime import UTC

    return ts.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
```

這個簽名與例外涵蓋 11 條 AC 的對應關係:

| AC 主題 | 對應設計 |
|---|---|
| 明確 project id(s),禁止隱含查全部 | `project_ids: Sequence[str]` 必填且非空,空值拋 `MissingProjectIdsError`(而非悄悄查全部或回空清單) |
| 5 種 metric type | `MetricType` enum,逐一對應 Gherkin 列出的五個值 |
| 依 metadata key/tags/name 分拆 | `Breakdown` dataclass,`__post_init__` 強制 metadata 分拆必帶 `metadata_key` |
| HTTP 錯誤明確報錯(含 endpoint+status) | `OpikHTTPError(endpoint=..., status_code=...)` |
| timeout 明確報錯 | `OpikTimeoutError(endpoint=...)`(`status_code=None`) |
| 非預期格式明確報錯 | `OpikResponseFormatError`,`_parse_metric_response` 捕捉解析過程中的 `KeyError`/`TypeError`/`ValueError`/`AttributeError` |
| 絕不靜默回傳 0/空 | 以上三種例外都是 raise,不是 return 空 dict/0 |
| Comet-Workspace header,預設 `"default"`,`OPIK_WORKSPACE` 可覆寫 | `_client()` 每次呼叫即時讀取 env var,沿用 `seed/client.py` 慣例 |
| 時間窗用錨點日,非系統時鐘 | `interval_start`/`interval_end` 為必填參數,模組本身不讀系統時鐘;呼叫端用 `seed.anchor.get_anchor_date()`(或其 `bff/anchor.py` 對應複本,見技術決策)取得錨點日後自行傳入 |
| null cost 維持「unknown」,不可轉 0 | `MetricPoint.value: float \| None`,解析時直接保留 `p["value"]` 原值,不做 `or 0` |
| `OPIK_BASE_URL` 必填無預設 | `base_url()` 空值拋 `OpikConfigError`,無 fallback |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引、不產生需要持久化的
欄位。`MetricPoint`/`MetricSeries` 是記憶體內的回應型別(dataclass),
不是資料庫實體,生命週期僅限於一次查詢呼叫。

## 關鍵技術決策

### 1. Portal/BFF 技術棧建議(本決策需人類於 G1b 核准,非自動放行)

**建議:Python 3.12,以 `uv` 管理,新建頂層目錄 `bff/`(httpx 作為 HTTP
client 依賴;日後若此 Story 以外的故事要新增對外 HTTP 端點,屆時建議採用
FastAPI,但本 Story 本身不產生任何新端點,FastAPI 依賴不在本 Story 範圍
內新增)。**

比較:

| 選項 | 優點 | 缺點 |
|---|---|---|
| **Python 3.12（建議）** | 與 `seed/` 同一語言,可直接重用已在真實後端驗證過的請求模式(`seed/client.py`/`seed/verify.py`);repo 只需維護一套 toolchain(`uv`、`ruff`、`pytest`)、一套 CI job;agent 子代理已熟悉的慣例(命名、例外設計、per-call env 讀取)直接延續,不需要重新建立一套平行慣例;v1 部署是「人工部署到單一主機」(project-profile.yaml),Python 的部署複雜度最低 | Portal 若之後做成豐富互動的 SPA 前端,前端那一側無論如何都需要 JS/TS 工具鏈——BFF 選 Python 並不能避免 repo 最終變成雙語言;Python 一般不是「專為服務前端而設計」的 BFF 首選(業界常見作法是 Node/TS BFF 貼近前端團隊) |
| Node.js/TypeScript BFF | 與未來前端(若選 React/Vue 等)共用語言與型別,前後端可共用 DTO 型別定義;瀏覽器導向的生態(SSR 框架、BFF 慣例)更成熟 | 替 repo 新增第二套完全獨立的工具鏈(npm/pnpm、tsconfig、lint、CI job),現階段沒有任何既有 TS 程式碼可重用;`seed/client.py` 的請求模式需要重新用另一語言驗證一次,增加本 Story 的風險面;團隊/agent 現有慣例(ruff、pytest)不適用,需要重新建立一套平行慣例 |
| 其他(如 Go、純靜態前端 + 直連後端) | 未評估——spec 與現有 repo 脈絡都沒有提示需要 Go 的效能特性;「前端直連 Opik」違反 CONSTITUTION.md「backend 不可從公網直接暴露」與本 Story「明確 project id 強制」要求(直連會讓前端自行組裝查詢,繞過本模組的強制檢查) | 同上 |

**取捨重點**:選 Python 消除的是「現在立刻新增一個工具鏈」的成本與風險,
不是「永遠只用一種語言」的承諾——若未來 Portal UI 故事選擇一個需要 JS/TS
的前端框架(例如 React SPA),那條分界線會落在「前端框架」那個決策點
上,而不是這裡的「BFF 語言」決策點上;兩者是可以獨立決定的兩層。本
Story 只決定「讀 Opik、服務 Portal 的服務層」這一層要用什麼語言,不預先
替未排程的 Portal UI 故事做前端框架選型(範圍外,留給那個故事的 G1b)。

### 2. 新建 `bff/` 頂層目錄,不放進 `seed/`

`seed/` 的既有定位(project-profile.yaml、CONSTITUTION 皆以此描述)是
「產生示範資料的 generator」,寫入 Opik;本模組是唯讀,服務未來 Portal
畫面,用途完全不同。混在一起會讓 `seed/pyproject.toml` 的依賴、測試範圍
（coverage threshold 目前只量測 `catalog.py`/`generate.py`）被迫擴大去
涵蓋一個無關的查詢客戶端,不符合 CONSTITUTION「實作只做 spec 要求的
範圍」精神。獨立頂層目錄讓兩者的依賴、測試、覆蓋率門檻各自獨立。

### 3. 不直接 `import seed.anchor`,改在 `bff/anchor.py` 放一份複本

`bff/` 與 `seed/` 是兩個獨立套件(各自有自己的 `pyproject.toml`),跨套件
直接 import 會讓 `bff/` 的依賴圖意外綁住 `seed/` 的所有依賴(價格表、
httpx 版本等與本 Story 無關的東西),且 SDLCCT-9 設計文件本身已明確說明
`get_anchor_date()` 的契約是「語言無關的一條規則」(env var 名稱、預設值
2026-10-15、解析規則),刻意不綁定 Python 執行期本身——重新在 `bff/`
下以同一契約獨立實作一份是該設計文件自己預期的用法,不是重複勞動的
壞味道。`bff/anchor.py` 的內容與 `seed/anchor.py` 逐字相同(同一份契約
的兩份獨立實作),developer 可直接複製後调整 import 路徑。

### 4. 例外分兩層:`OpikConfigError` 與 `OpikClientError` 家族分開

`OpikConfigError`(缺少 `OPIK_BASE_URL`)發生在任何請求送出之前,沒有
endpoint/status 可報;`OpikClientError` 家族(`OpikHTTPError`/
`OpikTimeoutError`/`OpikResponseFormatError`)則都對應「對某個已知
endpoint 的某次呼叫失敗」,必帶 endpoint,status 則在已知時才帶。把兩者
分成不同基底類別,讓呼叫端可以用 `except OpikClientError` 單獨攔截「後端
呼叫失敗」而不誤攔「設定錯誤」(兩者的補救方式完全不同:前者是程式
bug/環境問題,後者是當次查詢失敗可重試)。

### 5. 不沿用 `seed/client.py::base_url()` 的 `SystemExit`,改用自訂例外

`seed/client.py` 是一次性 CLI 腳本,`SystemExit` 直接結束整個行程是可
接受的;`bff/` 的客戶端會被未來長駐的 Portal/BFF 服務行程呼叫,一次
設定錯誤不該讓整個服務直接結束(例如:服務啟動時先接受連線,個別請求
處理到這段邏輯才發現環境變數沒設,應該回應一個錯誤而不是讓整個進程
死掉)。改用 `OpikConfigError(Exception)`,呼叫端(未來的路由處理函式)
自行決定要不要轉成 500。此分歧沿用的是本工單 spec 本身對「backend 失敗
須為明確例外」的要求,只是把 `SystemExit` 換成一般例外以適配長駐服務
情境,維持同一個「明確報錯、不吞例外」的精神。

### 6. 多專案語意:客戶端迴圈逐一呼叫單專案端點,不試圖拼出一個多專案
   請求

Opik 後端的 `/v1/private/projects/{id}/metrics` 端點本身只接受單一
`project_id`(已在 `seed/verify.py::metric()` 對真實後端驗證過),沒有
涵蓋全部五種 metric type 的多專案版本(`/v1/private/workspaces/costs`
只覆蓋 `COST`)。因此「明確多專案」的語意只能在客戶端層實現:對
`project_ids` 逐一呼叫、以 project_id 為 key 彙整,任何一個失敗就整體
拋出(不回傳部分結果掩蓋失敗),對應 spec「絕不靜默回傳 0/空」的要求——
部分成功、部分吞錯會製造「看起來有資料但其實一個專案查詢失敗了」的
假象,與 cost 欄位缺失同一類風險。

### 7. `interval_start`/`interval_end` 設為必填參數,不給預設時間窗

Spec 只要求「時間窗查詢要用錨點日,不可用系統時鐘」,沒有規定預設時間
窗的長度(一天?七天?卡在 demo 的 30 天歷史?)。若由本模組自行決定一個
預設長度,等於是在 spec 沒問過的地方偷做一個產品決策。改為不設預設值、
強制呼叫端用 `get_anchor_date()` 自行算出想要的窗口,把「查詢窗口多長」
這個決策完全留給呼叫端(未來的 Portal 畫面邏輯),模組本身只保證「不讀
系統時鐘」這一條 spec 明文要求的事。

## UI 原型

無,本 Story 不涉及前端 UI——這是服務層的 Python 查詢客戶端,沒有新增
或變更任何畫面、元件或樣式。Portal 六個畫面(E3)本身尚未存在,其 UI
技術選型是未排程的未來故事的範圍,非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style(repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄,`seed/tests/` 下也沒有任何樣式一致性
測試)。確認:`Glob("**/portal*/**")`、`Glob("**/frontend*/**")`、
`Grep("BFF|Portal|Node|TypeScript|frontend", docs/02-sdlc-workflow.md)`
均無結果,repo 內尚無任何前端 scaffold 可供比對。不適用。

## 開放設計問題(定稿時必須為空)

(無)
