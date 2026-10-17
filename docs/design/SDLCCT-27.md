# 設計文件 — SDLCCT-27 Day-over-day baseline comparison helper + context-bloat detection rule

## 對應需求規格

對應 G1 已核准的需求規格「Day-over-day baseline comparison helper +
context-bloat detection rule」。身為負責異常偵測邏輯的開發者，需要一個
可重用的「近N日基準比較」純函式元件，並用它實作第一條具體異常規則
`context_bloat`（avg prompt token/trace 持續攀升），用 Demo 資料集中
`maintenance_copilot` 的真實攀升模式驗證規則正確判定。

已核准的具體參數（真實資料驗證過，不可更動）：

- `maintenance_copilot` 的 context_bloat 公式：
  `prompt_per_call = round(12000 × (1 + 2×(14-d)/13))`，`d` = 「幾天前」，
  `d ≤ 14` 才有異常攀升；`d=14`（最早）→ 1.0x（12000），`d=1`（最新一天）
  → 3.0x（36000）。
- 用 21 天基準窗、`target_date` = 最新生成日時，`maintenance_copilot`
  偏離比（`deviation_ratio`）≈ 1.91；其餘 8 個 agent 均 < 1.30（即
  < 30% 偏離）。
- `baseline_window_days=21`、`deviation_threshold=1.30`（≥ 即判定異常）。

6 條 Gherkin AC：(1) 純函式正確計算、(2) Demo 資料集 `context_bloat`
正確偵測 `maintenance_copilot`、(3) 其餘 8 個不誤報、(4) 輸出含具體基準/
實際/偏離數字、(5) 資料不足/零資料時的明確行為（不回傳 0、不悄悄猜測）、
(6) 門檻邊界（deviation_ratio == 1.30）視為異常。

範圍外（已於 G1 核准，不可擴大，本文件不觸碰）：畫面呈現；自動處置；
AI 生成文字說明；`SPAN_TOKEN_USAGE`/`TRACE_COUNT` 以外的指標拆解；其他
異常規則（除 `context_bloat` 外，任何未來規則的設計都留給各自的 Story）。

依賴：E2（已 Done）；`bff/opik_metrics.py` 既有
`get_project_metrics_cached()`（SDLCCT-10/11）。

## 介面/API 契約

本 Story **不新增對外 HTTP 介面**——沿用 SDLCCT-10/15/17 的定位，這是
純函式庫層的新增模組，供未來的 Portal/BFF 路由層或排程任務呼叫。

### 新增模組位置與分檔理由

延續 SDLCCT-10 決策 #2「依用途分檔」與 SDLCCT-15/17 已建立的先例（每個
端點家族/概念獨立一個檔案），本故事開兩個新檔案，而不是把兩種職責（純
比較演算法 vs. 查詢+對齊+規則判定）塞進同一個檔案：

```
bff/
  opik_metrics.py              # 既有(SDLCCT-10/11),不變動
  opik_workspace.py            # 既有(SDLCCT-15),不變動
  opik_traces.py                # 既有(SDLCCT-17),不變動
  baseline.py                   # 本 Story 新增:純函式基準比較元件(無 I/O)
  anomaly_context_bloat.py      # 本 Story 新增:context_bloat 規則(有 I/O)
  tests/
    test_baseline.py             # developer 依 AC1/AC5/AC6 撰寫
    test_anomaly_context_bloat.py # developer 依 AC2/AC3/AC4 撰寫(Demo 資料集)
```

理由：`baseline.py` 是「近N日基準比較」這個與 Opik、與任何特定異常規則
完全無關的通用數學元件——純函式、無 I/O、無任何 Opik 概念（`MetricType`/
`project_id`）——未來任何其他異常規則（本故事明確排除在範圍外）都應該
直接 import 它重用，如果把它和 `context_bloat` 規則本身的查詢/對齊邏輯
混在同一個檔案，會讓「這個模組到底是通用元件還是某個特定規則」的邊界
變模糊，違反 SDLCCT-15 決策 #1 建立的「依端點/概念家族分檔」慣例的精神
（這裡的「家族」換成「通用演算法 vs. 特定規則」）。`anomaly_context_bloat.py`
則是本故事唯一的具體規則實作，直接 `from baseline import compare_to_baseline,
BaselineComparison, InsufficientBaselineDataError`（套件內 flat import，
與 `opik_workspace.py`/`opik_traces.py` 重用 `opik_metrics` 的既有慣例
一致），並 import `bff/opik_metrics.py` 的 `get_project_metrics_cached`/
`MetricType`/`Interval`/`MetricSeries`/`MetricPoint`。未來若新增第二條
規則（例如 cost spike），依同一慣例新開 `bff/anomaly_<rule_name>.py`，
重用 `baseline.py`，不重用 `anomaly_context_bloat.py` 內部任何東西——這
是本故事主動留給未來規則的唯一可重用面（`baseline.py`），其餘（查詢哪些
`MetricType`、怎麼對齊、門檻多少）都是 `context_bloat` 規則自己的細節，
不預先為其他規則抽象。

### `bff/baseline.py`：純函式基準比較元件

```python
"""Day-over-day baseline comparison helper (SDLCCT-27): a pure function,
no I/O, no Opik-specific concepts -- reusable by any future anomaly rule
that needs to compare an actual value against a trailing N-day baseline.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta


class InsufficientBaselineDataError(ValueError):
    """Raised by compare_to_baseline() when there is no usable data to
    compute a meaningful comparison:
    - the target_date itself has no value (missing key or None), or
    - zero days in the baseline window have a non-None value
      (baseline_days_used == 0), or
    - the baseline average is exactly 0 (deviation ratio undefined --
      division by zero).
    compare_to_baseline() never performs I/O, so this is always a
    caller-side/data-contract issue, never a backend failure -- there is
    deliberately no fallback to 0 or a guessed ratio (see decision below
    for why this is a new class, not a reused bff.opik_metrics exception).
    """


@dataclass(frozen=True)
class BaselineComparison:
    target_date: date
    baseline_window_days: int
    baseline_days_used: int
    baseline_value: float
    actual_value: float
    deviation_ratio: float
    deviation_pct: float


def compare_to_baseline(
    daily_values: Mapping[date, float | None],
    target_date: date,
    baseline_window_days: int,
) -> BaselineComparison:
    """Compare daily_values[target_date] against the average of the
    baseline_window_days calendar dates immediately BEFORE target_date
    (target_date itself is never part of its own baseline).

    - A date missing from daily_values, or present with value None, is
      treated as "no data for that date" -- never coerced to 0.
    - baseline_days_used counts only the baseline-window dates that have
      a non-None value; baseline_value is their average.
    - Raises InsufficientBaselineDataError if: target_date has no usable
      value, baseline_days_used == 0, or baseline_value == 0. Never
      returns a BaselineComparison with a 0/guessed baseline_value or
      deviation_ratio in these cases.
    - deviation_ratio = actual_value / baseline_value;
      deviation_pct = (deviation_ratio - 1.0) * 100.0.
    """
    if baseline_window_days <= 0:
        raise ValueError("baseline_window_days must be positive")

    actual_value = daily_values.get(target_date)
    if actual_value is None:
        raise InsufficientBaselineDataError(
            f"no usable value for target_date={target_date} (missing or null)"
        )

    baseline_dates = [target_date - timedelta(days=d) for d in range(1, baseline_window_days + 1)]
    baseline_points = [
        v for d in baseline_dates if (v := daily_values.get(d)) is not None
    ]
    baseline_days_used = len(baseline_points)
    if baseline_days_used == 0:
        raise InsufficientBaselineDataError(
            f"no usable baseline data in the {baseline_window_days}-day "
            f"window before {target_date}"
        )

    baseline_value = sum(baseline_points) / baseline_days_used
    if baseline_value == 0:
        raise InsufficientBaselineDataError(
            f"baseline_value is 0 over {baseline_days_used} day(s): "
            "deviation ratio is undefined"
        )

    deviation_ratio = actual_value / baseline_value
    return BaselineComparison(
        target_date=target_date,
        baseline_window_days=baseline_window_days,
        baseline_days_used=baseline_days_used,
        baseline_value=baseline_value,
        actual_value=actual_value,
        deviation_ratio=deviation_ratio,
        deviation_pct=(deviation_ratio - 1.0) * 100.0,
    )
```

### `bff/anomaly_context_bloat.py`：context_bloat 規則

```python
"""context_bloat anomaly rule (SDLCCT-27): avg prompt tokens/trace rising
beyond baseline for a single project. Built on bff.baseline's generic
compare_to_baseline(); queries bff.opik_metrics.get_project_metrics_cached()
twice (SPAN_TOKEN_USAGE, TRACE_COUNT) and aligns the two daily series by
date before comparing. See docs/design/SDLCCT-27.md for the alignment and
exception-propagation decisions.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime

from baseline import BaselineComparison, compare_to_baseline
from opik_metrics import Interval, MetricSeries, MetricType, get_project_metrics_cached

CONTEXT_BLOAT_BASELINE_WINDOW_DAYS = 21
CONTEXT_BLOAT_DEVIATION_THRESHOLD = 1.30


@dataclass(frozen=True)
class ContextBloatFinding:
    project_id: str
    is_anomalous: bool
    deviation_threshold: float
    comparison: BaselineComparison  # explain-your-reasoning: baseline/actual/ratio/pct


def detect_context_bloat(
    project_id: str,
    *,
    target_date: date,
    interval_start: datetime,
    interval_end: datetime,
    baseline_window_days: int = CONTEXT_BLOAT_BASELINE_WINDOW_DAYS,
    deviation_threshold: float = CONTEXT_BLOAT_DEVIATION_THRESHOLD,
) -> ContextBloatFinding:
    """Always returns a ContextBloatFinding (never None) -- see decision
    below on why "not anomalous" is a field, not an absent return value.

    - Queries SPAN_TOKEN_USAGE and TRACE_COUNT, both DAILY, both for
      [project_id] only, over [interval_start, interval_end]. Any
      OpikConfigError/OpikHTTPError/OpikTimeoutError/
      OpikResponseFormatError/MissingProjectIdsError from either call
      propagates unchanged -- not caught here.
    - Builds a per-day "avg tokens/trace" series by aligning the two
      daily series by date (see decision below); feeds it into
      compare_to_baseline(). InsufficientBaselineDataError propagates
      unchanged (same "explicit failure, never a guessed number"
      contract as compare_to_baseline() itself).
    - is_anomalous = comparison.deviation_ratio >= deviation_threshold
      (>=, so exactly 1.30 counts as anomalous -- AC6).
    """
    token_map = _series_to_date_map(_single_series(
        get_project_metrics_cached(
            [project_id], MetricType.SPAN_TOKEN_USAGE,
            interval=Interval.DAILY, interval_start=interval_start, interval_end=interval_end,
        ).get(project_id, ())
    ))
    trace_map = _series_to_date_map(_single_series(
        get_project_metrics_cached(
            [project_id], MetricType.TRACE_COUNT,
            interval=Interval.DAILY, interval_start=interval_start, interval_end=interval_end,
        ).get(project_id, ())
    ))

    daily_avg = _avg_tokens_per_trace_by_date(token_map, trace_map)
    comparison = compare_to_baseline(daily_avg, target_date, baseline_window_days)
    return ContextBloatFinding(
        project_id=project_id,
        is_anomalous=comparison.deviation_ratio >= deviation_threshold,
        deviation_threshold=deviation_threshold,
        comparison=comparison,
    )


def _single_series(series: tuple[MetricSeries, ...]) -> MetricSeries | None:
    """No breakdown is requested, so at most one series is expected per
    project_id (see opik_metrics.MetricSeries.key docstring). An empty
    tuple (no results at all for the window) is not malformed -- it is
    legitimate "no data" and is represented as None here, which
    _series_to_date_map() turns into an empty map."""
    return series[0] if series else None


def _series_to_date_map(series: MetricSeries | None) -> Mapping[date, float | None]:
    if series is None:
        return {}
    # DAILY interval is assumed to yield at most one point per calendar
    # date; if the backend ever returned two, last-one-wins (no observed
    # case in the validated Demo dataset).
    return {p.time.date(): p.value for p in series.points}


def _avg_tokens_per_trace_by_date(
    token_map: Mapping[date, float | None],
    trace_map: Mapping[date, float | None],
) -> dict[date, float]:
    """A date counts only if BOTH series have it with a non-None value
    AND trace_count != 0; otherwise that date contributes nothing (never
    coerced to 0 tokens or 0 traces). Iterating token_map's keys already
    excludes dates absent from trace_map; the `is None`/`== 0` guards
    exclude dates present but null/zero -- the exclusion is symmetric by
    construction, not by explicit union/intersection bookkeeping."""
    out: dict[date, float] = {}
    for d, tokens in token_map.items():
        traces = trace_map.get(d)
        if tokens is None or traces is None or traces == 0:
            continue
        out[d] = tokens / traces
    return out
```

### AC 對應關係

| AC | 對應設計 |
|---|---|
| 1. 純函式正確計算基準/實際/偏離 | `compare_to_baseline()`：無 I/O，`BaselineComparison` 回傳全部 7 個欄位，`deviation_ratio`/`deviation_pct` 由 `actual_value`/`baseline_value` 直接算出 |
| 2. Demo 資料集 `context_bloat` 正確偵測 `maintenance_copilot` | `detect_context_bloat()` 用 `baseline_window_days=21`、`target_date`=最新生成日，`maintenance_copilot` 的 `deviation_ratio≈1.91 ≥ 1.30` → `is_anomalous=True` |
| 3. 其餘 8 個不誤報 | 同一函式對其餘 8 個 project_id 呼叫，`deviation_ratio < 1.30` → `is_anomalous=False`，不拋例外、不特殊處理 |
| 4. 輸出含具體基準/實際/偏離數字 | `ContextBloatFinding.comparison` 原樣攜帶 `baseline_value`/`actual_value`/`deviation_ratio`/`deviation_pct`/`baseline_days_used`，供呼叫端直接讀取，不需重新計算 |
| 5. 資料不足/零資料時的明確行為 | `compare_to_baseline()` 在 `target_date` 無值、`baseline_days_used==0`、`baseline_value==0` 三種情況下皆 `raise InsufficientBaselineDataError`，`detect_context_bloat()` 不捕捉、原樣往外拋，絕不回傳 0 或悄悄猜測 |
| 6. 門檻邊界（1.30）視為異常 | `is_anomalous = deviation_ratio >= deviation_threshold`，用 `>=` 而非 `>` |

## 資料模型

無新增持久化資料模型——本 Story 不建表、不加索引。`BaselineComparison`/
`ContextBloatFinding` 都是記憶體內的回應型別（frozen dataclass），生命
週期僅限於一次規則判定呼叫，與 SDLCCT-10/15/17 的資料模型決策一致。

## 關鍵技術決策

### 1. 分成 `baseline.py`（通用、無 I/O）與 `anomaly_context_bloat.py`（特定規則、有 I/O）兩個檔案

見上方「介面/API 契約」的詳細說明：這是「通用演算法 vs. 特定規則」的概念
邊界分檔，延續 SDLCCT-15/17 已建立的「依概念家族分檔」慣例，讓
`baseline.py` 保持零 Opik 依賴、可被任何未來規則直接重用。

### 2. 新增 `InsufficientBaselineDataError(ValueError)`，不重用 `bff.opik_metrics` 的例外類別

`bff.opik_metrics` 既有的 `OpikClientError`/`OpikHTTPError`/
`OpikTimeoutError`/`OpikResponseFormatError` 全部語意綁定「對後端發出了
一次請求，而這次請求失敗」（`OpikClientError.__init__` 強制要求
`endpoint` 參數）；`compare_to_baseline()` 是純函式、完全不做 I/O，硬套
這組例外會逼它編造一個不存在的 `endpoint` 字串，語意上是錯的。
`MissingProjectIdsError(ValueError)` 的語意（「必要資料未提供，呼叫端
契約違反，沒有 fallback」）比較接近，但它的既有用途專指「project
id(s) 完全沒傳」這個單一情境（SDLCCT-15/17 的決策都明確把它的語意邊界
劃在那裡）；本情境是「資料存在但不足以計算一個有意義的比較值」，語意上
是不同的失敗模式，沿用會混淆兩種不同原因的例外處理。因此新增一個最小的
專用類別 `InsufficientBaselineDataError`，繼承 `ValueError`（延續
`MissingProjectIdsError` 的「呼叫端資料契約違反用 `ValueError` 子類別」
慣例），而不是繼承 `OpikClientError`。`detect_context_bloat()` 也不捕捉
它，原樣往外拋，讓呼叫端（未來的規則彙整層/排程任務）用同一個
`except InsufficientBaselineDataError` 處理所有「資料不足」情境，無論
底層是哪一種具體原因。

### 3. 基準窗 = `target_date` 前面緊接的 `baseline_window_days` 個日期，不含 `target_date` 當天

`target_date` 當天就是 `actual_value` 的來源，若也算進基準窗平均，等於
拿一個值跟「包含自己的平均」比較，會系統性低估偏離幅度。這與規格給的具體
範例一致：`maintenance_copilot` 的 `d=1`（最新一天，`target_date`）是
「實際值」，`21` 天基準窗是往前數的歷史資料，兩者不重疊。

### 4. 日期對齊：兩個序列都要有該日期、且值皆非 `None`、且 `trace_count != 0`，才算該日有效；否則整天排除，不猜測

`SPAN_TOKEN_USAGE`、`TRACE_COUNT` 是兩次獨立的 `get_project_metrics_cached()`
呼叫，沒有保證兩者回傳的日期集合完全相同（例如某天完全沒有 trace，
`TRACE_COUNT` 可能該日無資料點，或值為 `0`）。若把缺一邊的日期當 `0` 參與
除法，會製造一個捏造出來的「avg tokens/trace」數字（`0/0` 或
`tokens/0` 都是未定義的，`tokens/None` 更是型別錯誤）；若把它當真實的
`avg=0`，又會把這天錯誤地拉低基準平均，製造假的「沒有攀升」假象。因此
明確決定：只有兩個序列在同一天都有非 `None` 的值、且 `trace_count != 0`，
才算這天有效數據點；其餘情況下該天直接從 `avg_tokens_per_trace` 序列中
消失，交給 `compare_to_baseline()` 既有的「缺失日期 = 無資料」語意處理
（而不是在對齊這一層發明另一套「缺資料」表示法）。

### 5. `MetricPoint.value` 的 `None` 從頭到尾不被強制轉成 `0.0`

延續 SDLCCT-10 設計文件的既有決策（`opik_metrics.py` docstring 明確寫
「Null "value" 原樣保留為 Python `None`，絕不用 `0.0` 取代」）。本故事的
`_series_to_date_map()`/`_avg_tokens_per_trace_by_date()`/
`compare_to_baseline()` 三層都遵守同一條規則：缺失/`None` 一律保持
「這天沒有可用數據」的狀態，一路傳到 `InsufficientBaselineDataError`
（如果最終導致基準或實際值完全算不出來）或被自然排除在基準平均之外
（如果只是部分日期缺失，其餘日期仍夠算出一個基準），從未在任何一層把
`None` 當 `0` 參與加總或除法。

### 6. `detect_context_bloat()` 永遠回傳 `ContextBloatFinding`，不回傳 `None`

AC3 要求「其餘 8 個不誤報」，若用回傳 `None` 表示「沒有異常」，呼叫端就
拿不到那 8 個 agent 的具體 `deviation_ratio`/`baseline_value` 等數字；但
使用者故事本身強調「輸出含可解釋的基準/實際/偏離數字，供未來其他異常
規則重用」，這個解釋性輸出的價值不應該只在判定為異常時才提供——對「為
什麼這個 agent 沒被判定異常」同樣需要可追溯的數字（例如除錯、或未來規則
彙整層要畫一張「全部 agent 的偏離比」儀表板）。因此用 `is_anomalous: bool`
欄位表達判定結果，函式本身永遠回傳完整的 `ContextBloatFinding`（資料不足
時則讓 `InsufficientBaselineDataError` 往外拋，而不是用 `None` 掩蓋，
呼應決策 #2/AC5）。

### 7. `detect_context_bloat()` 不驗證 `interval_start`/`interval_end` 是否「夠寬」覆蓋基準窗

延續 `opik_metrics.py` 既有慣例（「`interval_start`/`interval_end` 必填，
函式本身不讀系統時鐘、不猜窗口」）：呼叫端自行決定查詢窗口多寬。若窗口
太窄導致基準天數不足，`compare_to_baseline()` 會自然地拋出
`InsufficientBaselineDataError`，不需要在 `detect_context_bloat()` 這層
重複做一次「窗口夠不夠寬」的提前檢查——那會是同一個失敗情境的第二套
檢查邏輯，徒增維護面。

## UI 原型

無，本 Story 不涉及前端 UI——純粹是服務層的 Python 規則判定函式，沒有
新增或變更任何畫面、元件或樣式。Portal 畫面本身尚未存在，其 UI 技術選型
是未排程的未來故事的範圍，非本 Story 決定。

## 跨元素樣式耦合測試檢查

本 Story 不變更任何既有 selector 的 computed style——repo 目前沒有任何
前端程式碼、沒有 `tests/e2e/` 目錄，與 SDLCCT-9/10/11/15/17 設計文件記錄
的狀況相同，此後未變。確認：`Glob("**/portal*/**")`、
`Glob("**/frontend*/**")`、`Grep("toEqual|一致|consistent", path="tests")`
均無結果或無相關測試目錄存在。不適用。

## 開放設計問題(定稿時必須為空)

(無)
