"""Model-switch cost spike anomaly rule (SDLCCT-28): detects an agent's
model tag changing from a cheaper to a more expensive model with no
corresponding change in traffic volume.

Deliberately does NOT reuse bff.baseline.compare_to_baseline(): its
trailing N-day sliding-average baseline would be polluted by the switch
event itself (the baseline window would span across switch_date). This
rule instead splits the query window into two mutually exclusive,
model-homogeneous sub-windows at switch_date and sums cost/traces within
each -- see docs/design/SDLCCT-28.md Q3.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from opik_metrics import (
    Breakdown,
    BreakdownField,
    Interval,
    MetricSeries,
    MetricType,
    get_project_metrics_cached,
)

MODEL_TAG_PREFIX = "model:"
MODEL_SWITCH_DEVIATION_THRESHOLD = 3.0


class InsufficientSwitchWindowDataError(ValueError):
    """Raised when a switch_date was found but the before- or after-switch
    sub-window has no usable (cost, trace_count) data to compute a
    before/after cost-per-trace -- see docs/design/SDLCCT-28.md decision
    #2 for why this is its own class rather than reusing
    bff.baseline.InsufficientBaselineDataError or any bff.opik_metrics
    exception."""


@dataclass(frozen=True)
class ModelSwitchFinding:
    project_id: str
    is_anomalous: bool
    deviation_threshold: float
    switch_date: date | None
    before_model_tag: str | None
    after_model_tag: str | None
    before_cost_per_trace: float | None
    after_cost_per_trace: float | None
    deviation_ratio: float | None


def detect_model_switch(
    project_id: str,
    *,
    interval_start: datetime,
    interval_end: datetime,
    deviation_threshold: float = MODEL_SWITCH_DEVIATION_THRESHOLD,
) -> ModelSwitchFinding:
    """Always returns a ModelSwitchFinding (never None) -- same
    "explain a non-anomaly too" convention as detect_context_bloat()
    (SDLCCT-27 decision #6) and find_governance_gaps() (SDLCCT-31).

    - Queries TRACE_COUNT (DAILY, Breakdown(TAGS)) and COST (DAILY, no
      breakdown), both for [project_id] only, over
      [interval_start, interval_end]. Any OpikConfigError/OpikHTTPError/
      OpikTimeoutError/OpikResponseFormatError/MissingProjectIdsError
      from either call propagates unchanged -- not caught here.
    - If no dominant-tag change is found in the window: returns
      is_anomalous=False, switch_date=None, and every other evidence
      field None (AC4). This is NOT an error -- it is the expected
      result for 8 of the 9 Demo agents.
    - If a switch_date is found but a sub-window has no usable data:
      raises InsufficientSwitchWindowDataError (never a guessed ratio).
    - is_anomalous = deviation_ratio >= deviation_threshold (>=, same
      boundary convention as detect_context_bloat()/AC6 there; this
      ticket's AC list has no explicit boundary case, so the existing
      repo-wide convention applies -- see decision #4).
    """
    trace_count_result = get_project_metrics_cached(
        [project_id],
        MetricType.TRACE_COUNT,
        interval=Interval.DAILY,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=Breakdown(field=BreakdownField.TAGS),
    ).get(project_id, ())

    switch_date, before_tag, after_tag, total_traces_by_date = _find_switch_date(trace_count_result)

    if switch_date is None:
        return ModelSwitchFinding(
            project_id=project_id,
            is_anomalous=False,
            deviation_threshold=deviation_threshold,
            switch_date=None,
            before_model_tag=None,
            after_model_tag=None,
            before_cost_per_trace=None,
            after_cost_per_trace=None,
            deviation_ratio=None,
        )

    cost_result = get_project_metrics_cached(
        [project_id],
        MetricType.COST,
        interval=Interval.DAILY,
        interval_start=interval_start,
        interval_end=interval_end,
    ).get(project_id, ())
    daily_cost = _series_to_date_map(cost_result[0] if cost_result else None)

    before_dates = _date_range(interval_start.date(), switch_date - timedelta(days=1))
    after_dates = _date_range(switch_date, interval_end.date())

    before_total_cost, before_total_traces = _cost_per_trace(daily_cost, total_traces_by_date, before_dates)
    after_total_cost, after_total_traces = _cost_per_trace(daily_cost, total_traces_by_date, after_dates)

    if before_total_traces == 0 or after_total_traces == 0:
        raise InsufficientSwitchWindowDataError(
            f"{project_id}: zero usable traces in the before- or after-switch "
            f"sub-window around switch_date={switch_date}"
        )

    before_cost_per_trace = before_total_cost / before_total_traces
    if before_cost_per_trace == 0:
        raise InsufficientSwitchWindowDataError(
            f"{project_id}: before_cost_per_trace is 0 around switch_date={switch_date}: "
            "deviation ratio is undefined"
        )
    after_cost_per_trace = after_total_cost / after_total_traces

    deviation_ratio = after_cost_per_trace / before_cost_per_trace
    return ModelSwitchFinding(
        project_id=project_id,
        is_anomalous=deviation_ratio >= deviation_threshold,
        deviation_threshold=deviation_threshold,
        switch_date=switch_date,
        before_model_tag=f"{MODEL_TAG_PREFIX}{before_tag}",
        after_model_tag=f"{MODEL_TAG_PREFIX}{after_tag}",
        before_cost_per_trace=before_cost_per_trace,
        after_cost_per_trace=after_cost_per_trace,
        deviation_ratio=deviation_ratio,
    )


def _find_switch_date(trace_count_series: tuple[MetricSeries, ...]):
    """Return (switch_date, before_tag, after_tag, total_traces_by_date).
    before_tag/after_tag are the bare model values (no "model:" prefix) --
    detect_model_switch() re-adds the prefix when building the finding.
    switch_date is None iff before_tag/after_tag are also None (AC4)."""
    model_series = [s for s in trace_count_series if s.key.startswith(MODEL_TAG_PREFIX)]

    # date -> {model_value: count}, skipping None values (same convention
    # as SDLCCT-27 decision #5).
    by_date: dict[date, dict[str, float]] = defaultdict(dict)
    for s in model_series:
        model_value = s.key[len(MODEL_TAG_PREFIX):]
        for p in s.points:
            if p.value is not None:
                by_date[p.time.date()][model_value] = p.value

    total_traces_by_date: dict[date, float] = {
        d: sum(counts.values()) for d, counts in by_date.items() if counts
    }
    dominant_by_date: dict[date, str] = {
        d: max(counts.items(), key=lambda kv: kv[1])[0]
        for d, counts in by_date.items() if counts
    }

    prev_tag = None
    for d in sorted(dominant_by_date):
        tag = dominant_by_date[d]
        if prev_tag is not None and tag != prev_tag:
            return d, prev_tag, tag, total_traces_by_date
        prev_tag = tag
    return None, None, None, total_traces_by_date


def _cost_per_trace(
    daily_cost: Mapping[date, float | None],
    total_traces_by_date: Mapping[date, float],
    dates: Iterable[date],
) -> tuple[float, float]:
    """Return (total_cost, total_traces), summing only over dates where
    BOTH sides have non-None data (same "missing one side excludes the
    whole day" convention as SDLCCT-27 decision #4)."""
    total_cost, total_traces = 0.0, 0.0
    for d in dates:
        cost, traces = daily_cost.get(d), total_traces_by_date.get(d)
        if cost is None or traces is None:
            continue
        total_cost += cost
        total_traces += traces
    return total_cost, total_traces


def _series_to_date_map(series: MetricSeries | None) -> Mapping[date, float | None]:
    """No breakdown is requested for the COST query, so at most one
    series is expected per project_id (see opik_metrics.MetricSeries.key
    docstring). An empty tuple (no results at all) is legitimate "no
    data", represented here as an empty map."""
    if series is None:
        return {}
    return {p.time.date(): p.value for p in series.points}


def _date_range(start: date, end: date) -> list[date]:
    """Inclusive calendar-date range; empty list if end < start (e.g. a
    switch_date that lands on the very first day of the window, leaving
    no "before" days at all)."""
    span = (end - start).days
    return [start + timedelta(days=i) for i in range(span + 1)] if span >= 0 else []
