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
