# 設計文件 — SDLCCT-29 Tool-retry-loop anomaly detection rule

## 對應需求規格

對應 G1 已核准的需求規格「Tool-retry-loop anomaly detection rule」。身為
負責異常偵測邏輯的開發者，需要新增一個「同日錯誤率與 spans/trace 比值
同步異常攀升」偵測規則 `tool_retry_loop`：用 Opik 的 `TRACE_ERROR_RATE`
與 `SPAN_COUNT`/`TRACE_COUNT` 比值比對 Agent 自身基準，用 Demo 資料集中
`quality_rca` 的真實重試迴圈事件驗證規則正確判定，且不誤報其餘 8 個
agent（包含僅單一訊號異常、未同步出現的情境）。

已核准的具體參數（Jira 規格，不可更動）：

- `quality_rca` 真實重試迴圈事件：avg spans/trace 偏離比
  （`comparison.deviation_ratio`）≈ 2.09，`error_rate` ≈ 0.03，兩訊號
  同日同步出現 → `co_occurred=true`。
- `ratio_threshold=1.5`、`error_rate_threshold=0.01`，兩者皆用 `>=`
  （門檻邊界：`ratio` 恰為 1.5 且 `error_rate` 恰為 0.01 時視為異常，
  AC4）。
- 其餘 8 個 agent 不誤報，包含僅單一訊號異常、未同步出現的情境——例如
  `procurement_rfq` 的 `night_batch_burst` 事件日僅流量（spans/trace
  比值）異常，當日 `error_rate=0`，因 AND 邏輯不成立而不判定異常。
- 輸出須含具體證據：`error_rate`、`comparison.deviation_ratio`、
  `co_occurred`。

4 條 Gherkin AC：(1) 正確偵測 `quality_rca` 的重試迴圈事件、(2) 其餘 8
個不誤報（含僅單一訊號異常情境）、(3) 輸出含具體證據、(4) 門檻邊界
（`ratio==1.5` 且 `error_rate==0.01`）視為異常。

`baseline_window_days`：規格未另外指定覆蓋值，延續 SDLCCT-27 已核准的
21 天基準窗預設（`CONTEXT_BLOAT_BASELINE_WINDOW_DAYS=21`）——這不是本
故事另立的產品決策，而是沿用既有規則家族的既定預設，呼叫端仍可在呼叫
時覆蓋。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：畫面呈現；自動處置
（停用/通知/工單）；AI 生成文字說明；跨 agent 關聯分析；即時串流、多日
趨勢或嚴重度分級。

依賴：SDLCCT-27（已 Done，`bff/baseline.py` 的 `compare_to_baseline()`）；
`bff/opik_metrics.py` 既有 `get_project_metrics_cached()`
（SDLCCT-10/11）。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——延續 SDLCCT-10/15/17/27 的定位，純
函式庫層新增模組，供未來的 Portal/BFF 路由層或排程任務呼叫。

### 新增模組位置

延續 SDLCCT-27 決策 #1 建立的慣例（`bff/anomaly_<rule_name>.py`，每條
規則一個檔案，只重用 `baseline.py` 這一個通用元件，規則自身的查詢/對齊
邏輯一律不跨規則重用）：

```
bff/
  baseline.py                   # 既有(SDLCCT-27),不變動
  anomaly_context_bloat.py      # 既有(SDLCCT-27),不變動
  anomaly_tool_retry_loop.py    # 本 Story 新增:tool_retry_loop 規則
  tests/
    test_anomaly_tool_retry_loop.py  # developer 依 AC1-4 撰寫(Demo 資料集)
```

`anomaly_tool_retry_loop.py` 直接 `from baseline import BaselineComparison,
compare_to_baseline`（重用比值訊號的基準比較），並 import
`bff/opik_metrics.py` 的 `get_project_metrics_cached`/`MetricType`/
`Interval`/`MetricSeries`。內部的 `_single_series`/`_series_to_date_map`/
對齊函式**不**從 `anomaly_context_bloat.py` import，而是在本檔案內各自
複製一份等價邏輯（命名改為 spans 語意）——這是延續 SDLCCT-27 決策 #1
「只有 `baseline.py` 是主動留給未來規則的可重用面，規則自身的查詢/對齊
細節不預先為其他規則抽象」的既定邊界，不是本故事新發明的決策。

### `bff/anomaly_tool_retry_loop.py`：tool_retry_loop 規則

```python
"""tool_retry_loop anomaly rule (SDLCCT-29): error_rate rising together
with avg spans/trace on the same day, for a single project. Reuses
bff.baseline's compare_to_baseline() for the spans/trace ratio signal
(same two-series-by-date alignment pattern anomaly_context_bloat.py
(SDLCCT-27) established for SPAN_TOKEN_USAGE/TRACE_COUNT, here with
SPAN_COUNT replacing SPAN_TOKEN_USAGE) and queries TRACE_ERROR_RATE
directly for target_date as an absolute single-day signal, not a
baseline comparison (baseline error_rate is structurally always 0 in
the validated Demo dataset, so a ratio against it is undefined -- see
docs/design/SDLCCT-29.md decision #2).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime

from baseline import BaselineComparison, compare_to_baseline
from opik_metrics import Interval, MetricSeries, MetricType, get_project_metrics_cached

TOOL_RETRY_LOOP_BASELINE_WINDOW_DAYS = 21
TOOL_RETRY_LOOP_RATIO_THRESHOLD = 1.5
TOOL_RETRY_LOOP_ERROR_RATE_THRESHOLD = 0.01


class MissingErrorRateDataError(ValueError):
    """Raised when TRACE_ERROR_RATE has no usable (non-None) value for
    target_date. error_rate is an absolute single-day signal, never run
    through compare_to_baseline(), so this failure mode is never covered
    by InsufficientBaselineDataError -- it needs its own explicit class.
    Never silently treated as error_rate=0: that would make "we don't
    know the error rate that day" indistinguishable from "verified zero
    errors," which is exactly the kind of guessed number this rule
    family refuses to produce (same contract as InsufficientBaselineDataError)."""


@dataclass(frozen=True)
class ToolRetryLoopFinding:
    project_id: str
    is_anomalous: bool  # == co_occurred (see decision #4); kept as its own field for the same "explain yourself" output contract as ContextBloatFinding
    co_occurred: bool
    ratio_threshold: float
    error_rate_threshold: float
    error_rate: float  # actual TRACE_ERROR_RATE value on target_date
    comparison: BaselineComparison  # spans/trace ratio signal: baseline/actual/ratio/pct


def detect_tool_retry_loop(
    project_id: str,
    *,
    target_date: date,
    interval_start: datetime,
    interval_end: datetime,
    baseline_window_days: int = TOOL_RETRY_LOOP_BASELINE_WINDOW_DAYS,
    ratio_threshold: float = TOOL_RETRY_LOOP_RATIO_THRESHOLD,
    error_rate_threshold: float = TOOL_RETRY_LOOP_ERROR_RATE_THRESHOLD,
) -> ToolRetryLoopFinding:
    """Always returns a ToolRetryLoopFinding (never None) -- same
    rationale as detect_context_bloat() (SDLCCT-27 decision #6): callers
    need the evidence numbers for non-anomalous agents too (AC2/AC3).

    - Queries SPAN_COUNT and TRACE_COUNT (both DAILY, [project_id] only,
      [interval_start, interval_end]), aligns them by date with the same
      "both non-None AND trace_count != 0, else excluded" rule
      anomaly_context_bloat.py uses, to build a per-day "avg
      spans/trace" series, then feeds it to compare_to_baseline() for
      the ratio signal.
    - Queries TRACE_ERROR_RATE over the SAME [interval_start,
      interval_end] window (identical call shape to the other two
      metrics -- no separate narrower single-day query), builds a date
      map the same way, and reads error_rate = date_map[target_date].
      Missing/None -> MissingErrorRateDataError.
    - BOTH queries and BOTH signal computations always run,
      unconditionally, in this order: ratio comparison first, then
      error_rate lookup. Neither short-circuits the other:
      InsufficientBaselineDataError from compare_to_baseline() 
      propagates unchanged even on a day where error_rate alone would
      already be below error_rate_threshold (and symmetrically,
      MissingErrorRateDataError propagates even if the ratio alone is
      already below ratio_threshold) -- "always compute and propagate
      real exceptions, never catch-and-guess" (same contract as
      SDLCCT-27/31). A caller never receives a guessed/partial finding.
    - co_occurred = (comparison.deviation_ratio >= ratio_threshold) AND
      (error_rate >= error_rate_threshold) -- both >=, so the exact
      boundary (ratio==1.5 AND error_rate==0.01) counts as anomalous
      (AC4). is_anomalous mirrors co_occurred.
    """
    span_map = _series_to_date_map(_single_series(
        get_project_metrics_cached(
            [project_id], MetricType.SPAN_COUNT,
            interval=Interval.DAILY, interval_start=interval_start, interval_end=interval_end,
        ).get(project_id, ())
    ))
    trace_map = _series_to_date_map(_single_series(
        get_project_metrics_cached(
            [project_id], MetricType.TRACE_COUNT,
            interval=Interval.DAILY, interval_start=interval_start, interval_end=interval_end,
        ).get(project_id, ())
    ))
    daily_avg = _avg_spans_per_trace_by_date(span_map, trace_map)
    # Always computed, never short-circuited by the error_rate lookup below
    # (see decision #4): InsufficientBaselineDataError propagates unchanged.
    comparison = compare_to_baseline(daily_avg, target_date, baseline_window_days)

    error_rate_map = _series_to_date_map(_single_series(
        get_project_metrics_cached(
            [project_id], MetricType.TRACE_ERROR_RATE,
            interval=Interval.DAILY, interval_start=interval_start, interval_end=interval_end,
        ).get(project_id, ())
    ))
    error_rate = error_rate_map.get(target_date)
    if error_rate is None:
        raise MissingErrorRateDataError(
            f"no usable TRACE_ERROR_RATE value for target_date={target_date} (missing or null)"
        )

    co_occurred = (
        comparison.deviation_ratio >= ratio_threshold
        and error_rate >= error_rate_threshold
    )
    return ToolRetryLoopFinding(
        project_id=project_id,
        is_anomalous=co_occurred,
        co_occurred=co_occurred,
        ratio_threshold=ratio_threshold,
        error_rate_threshold=error_rate_threshold,
        error_rate=error_rate,
        comparison=comparison,
    )


def _single_series(series: tuple[MetricSeries, ...]) -> MetricSeries | None:
    """Identical logic to anomaly_context_bloat.py's helper of the same
    name (SDLCCT-27 decision #1: not imported across rule files, each
    rule keeps its own copy). No breakdown is requested, so at most one
    series is expected per project_id."""
    return series[0] if series else None


def _series_to_date_map(series: MetricSeries | None) -> Mapping[date, float | None]:
    if series is None:
        return {}
    return {p.time.date(): p.value for p in series.points}


def _avg_spans_per_trace_by_date(
    span_map: Mapping[date, float | None],
    trace_map: Mapping[date, float | None],
) -> dict[date, float]:
    """Same exclusion rule as anomaly_context_bloat.py's
    _avg_tokens_per_trace_by_date(): a date counts only if BOTH series
    have it with a non-None value AND trace_count != 0; otherwise that
    date contributes nothing (never coerced to 0 spans or 0 traces)."""
    out: dict[date, float] = {}
    for d, spans in span_map.items():
        traces = trace_map.get(d)
        if spans is None or traces is None or traces == 0:
            continue
        out[d] = spans / traces
    return out
```

### AC 對應關係

| AC | 對應設計 |
|---|---|
| 1. 偵測 `quality_rca` 的真實重試迴圈事件 | `detect_tool_retry_loop()` 用 `ratio_threshold=1.5`、`error_rate_threshold=0.01`，`quality_rca` 當日 `comparison.deviation_ratio≈2.09 >= 1.5` 且 `error_rate≈0.03 >= 0.01` → `co_occurred=True` |
| 2. 其餘 8 個不誤報（含僅單一訊號異常） | 同一函式對其餘 8 個 project_id 呼叫；`procurement_rfq` 的 `night_batch_burst` 事件日 `error_rate=0 < 0.01`，即使 spans/trace 比值異常，AND 邏輯仍判定 `co_occurred=False` |
| 3. 輸出含具體證據 | `ToolRetryLoopFinding` 直接攜帶 `error_rate`、`comparison.deviation_ratio`（經 `comparison` 欄位）、`co_occurred`，呼叫端不需重新計算 |
| 4. 門檻邊界（`ratio==1.5` 且 `error_rate==0.01`）視為異常 | `co_occurred` 的兩個子條件都用 `>=`，恰好等於門檻時仍判定異常 |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`ToolRetryLoopFinding`
是記憶體內的回應型別（frozen dataclass），生命週期僅限於一次規則判定
呼叫，與 SDLCCT-10/15/17/27 的資料模型決策一致。

## 關鍵技術決策

### 1. 比值訊號重用 `baseline.py` 的 `compare_to_baseline()`，日期對齊邏輯重用 SDLCCT-27 已驗證的模式

`SPAN_COUNT`/`TRACE_COUNT` 兩次獨立查詢沒有保證回傳的日期集合完全相同，
與 SDLCCT-27 解決的 `SPAN_TOKEN_USAGE`/`TRACE_COUNT` 對齊問題是同一類
問題，因此直接套用相同規則：只有兩序列同一天都有非 `None` 值、且
`trace_count != 0`，才算該天有效，否則整天從 `avg_spans_per_trace`
序列中排除，交給 `compare_to_baseline()` 既有的「缺失日期 = 無資料」
語意處理。本 Story 僅把「分子指標」換成 `SPAN_COUNT`（原為
`SPAN_TOKEN_USAGE`），對齊/排除規則本身不變。

### 2. `error_rate` 不透過 `compare_to_baseline()` 比對基準，改用絕對門檻

規格明確指出 `quality_rca` 之外的多數 agent 基準期 `error_rate` 恆為
0——若用 `compare_to_baseline()` 計算偏離比，`baseline_value=0` 會讓每一
個 `error_rate>0` 的天都觸發 `InsufficientBaselineDataError`（除以 0 的
既有保護機制），而不是把「錯誤率從 0 升到某個非 0 值」正確地判定為訊號
本身就該觸發異常的情境。因此 `error_rate` 訊號刻意不經過
`compare_to_baseline()`，直接用固定絕對門檻 `error_rate_threshold=0.01`
比對當日的絕對值——這是規格直接要求的設計（基準 `error_rate` 恆為 0
這件事本身就排除了比值比對的可行性），不是本文件自行發明的簡化。

### 3. 查詢 `TRACE_ERROR_RATE` 時沿用與另兩個指標相同的查詢窗口（`interval_start`/`interval_end`），不另開一次「只查 `target_date` 當天」的窄查詢

三個指標（`SPAN_COUNT`、`TRACE_COUNT`、`TRACE_ERROR_RATE`）都用同一組
`interval_start`/`interval_end`、同一個 `_series_to_date_map()` 輔助
函式查詢並整理成「日期→值」的 map，只是 `TRACE_ERROR_RATE` 最後只取
`target_date` 這一天的值（`error_rate_map.get(target_date)`），其餘日期
的資料點直接忽略不用。好處是三個查詢的呼叫形狀完全一致，不需要為
「只要一天」另外計算一組更窄的 `interval_start`/`interval_end`，也不會
因為窄窗口而影響 `get_project_metrics_cached()` 既有的快取 key（同一個
`project_id`/`interval`/窗口組合的查詢可以在同一次規則判定中被其他需要
同窗口資料的程式碼重用快取結果）。

### 4. 新增 `MissingErrorRateDataError(ValueError)`，不重用 `InsufficientBaselineDataError`

`InsufficientBaselineDataError` 的語意明確綁定「基準比較算不出來」
（`compare_to_baseline()` 的三種觸發情境），而 `error_rate` 訊號完全不
經過 `compare_to_baseline()`（見決策 #2），硬套會讓呼叫端誤以為這個
例外一定來自基準計算。因此新增一個語意對應「目標日期本身缺資料」的
專用類別，繼承 `ValueError`（延續 `MissingProjectIdsError`/
`InsufficientBaselineDataError` 的「呼叫端資料契約違反用 `ValueError`
子類別」慣例）。

### 5. 兩個訊號永遠都計算，任何一個的例外都原樣往外拋，不互相短路、不猜測

`compare_to_baseline()`（比值訊號）與 `error_rate` 查詢（絕對值訊號）
的執行順序固定、互不依賴對方的結果：即使 `error_rate` 已知會讓
`co_occurred` 不可能成立（例如規格給的 `procurement_rfq` 情境），比值
訊號的計算與其可能拋出的 `InsufficientBaselineDataError` 仍然原樣執行、
原樣往外拋，絕不因為「反正另一個訊號已經會讓結果是 False」而跳過計算
或悄悄把缺資料的那一側當作「安全」結果。這延續 SDLCCT-27/31 已建立的
「永遠真實計算、真實往外拋例外，絕不 catch-and-guess」慣例。

### 6. `co_occurred` 的 AND 邏輯：兩個子條件都用 `>=`

規格 AC4 明確要求「`ratio` 恰為 1.5 且 `error_rate` 恰為 0.01 時視為
異常」，因此 `comparison.deviation_ratio >= ratio_threshold` 與
`error_rate >= error_rate_threshold` 都用 `>=` 而非 `>`，與 SDLCCT-27
決策 #AC6（`deviation_ratio >= deviation_threshold`）用的運算子一致。

### 7. `ToolRetryLoopFinding` 同時提供 `co_occurred` 與 `is_anomalous` 兩個欄位（值永遠相同）

規格的輸出要求（AC3）明確點名 `co_occurred` 這個欄位名稱（規則本身的
語意是「兩訊號同步出現」），而 `ContextBloatFinding` 已建立
`is_anomalous: bool` 作為這個規則家族「是否判定異常」的慣例欄位名稱。
為了同時滿足規格明確要求的欄位名與既有規則家族的慣例欄位名，兩者都保留
（`is_anomalous` 直接等於 `co_occurred`），而不是只留其中一個、犧牲另一
邊的可讀性或慣例一致性。

### 8. `baseline_window_days` 預設沿用 SDLCCT-27 的 21 天

規格沒有為本規則另外指定基準窗天數，因此直接沿用
`CONTEXT_BLOAT_BASELINE_WINDOW_DAYS=21` 的既定預設值（獨立命名為
`TOOL_RETRY_LOOP_BASELINE_WINDOW_DAYS`，與 `anomaly_context_bloat.py`
的命名慣例一致，但不是跨檔案 import 共用常數，延續決策 #1 的「規則自身
細節不跨規則重用」邊界）。呼叫端仍可在呼叫時覆蓋。

## UI 原型

無，本 Story 不涉及前端 UI——純粹是服務層的 Python 規則判定函式，沒有
新增或變更任何畫面、元件或樣式。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/17/27 設計文件
記錄的狀況相同，此後未變。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題(定稿時必須為空)

(無)
