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
