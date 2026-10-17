"""Nighttime batch burst anomaly detection rule (SDLCCT-30): off-hours
TRACE_COUNT surge vs. this project's own 24h-uniform baseline rate, with
metadata.workflow as corroborating (never gating) evidence.

Built directly on bff.opik_metrics.get_project_metrics_cached() -- does
NOT reuse bff.baseline.compare_to_baseline(): see
docs/design/SDLCCT-30.md decision #2 for why this rule's baseline
arithmetic (daily total / 24) is a different, simpler shape than
compare_to_baseline()'s day-over-day comparison, so there is no shared
"InsufficientBaselineDataError"-style failure mode to reuse.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from opik_metrics import (
    Breakdown,
    BreakdownField,
    Interval,
    MetricType,
    MissingProjectIdsError,  # noqa: F401  (re-exported: see module docstring / AC4)
    get_project_metrics_cached,
)

NIGHT_BATCH_BURST_WINDOW_HOURS_UTC: tuple[int, int] = (17, 19)
NIGHT_BATCH_BURST_RATIO_THRESHOLD: float = 10.0
_METADATA_WORKFLOW_KEY = "workflow"  # not a parameter -- see decision #3 in the design doc


@dataclass(frozen=True)
class NightBatchBurstFinding:
    project_id: str
    is_anomalous: bool
    ratio_threshold: float
    off_hours_window_utc: tuple[int, int]
    off_hours_trace_count: int
    baseline_hourly_rate: float
    ratio: float
    corroborating_workflow: str | None  # evidence only -- never read by is_anomalous


def detect_night_batch_burst(
    project_id: str,
    *,
    target_date: date,
    interval_start: datetime,
    interval_end: datetime,
    off_hours_window_utc: tuple[int, int] = NIGHT_BATCH_BURST_WINDOW_HOURS_UTC,
    baseline_window_days: int = 21,
    ratio_threshold: float = NIGHT_BATCH_BURST_RATIO_THRESHOLD,
) -> NightBatchBurstFinding:
    """Always returns a NightBatchBurstFinding (never None) -- same
    "explain-your-reasoning even when not anomalous" contract as
    SDLCCT-27's detect_context_bloat().

    See docs/design/SDLCCT-30.md for the full algorithm and the decisions
    behind each design choice (decision #1: single project_id in/out
    shape; #2: no new exception class / no compare_to_baseline() reuse;
    #3: corroborating_workflow never gates is_anomalous; #4: off-hours
    None/missing hours summed as 0, a deliberate TRACE_COUNT-only
    exception to the repo's general "None never becomes 0" convention;
    #5: MissingProjectIdsError's actual trigger condition under this
    single-project_id signature).
    """
    window_start_hour, window_end_hour = off_hours_window_utc
    off_hours_start = datetime(
        target_date.year, target_date.month, target_date.day, window_start_hour, tzinfo=UTC
    )
    off_hours_end = datetime(
        target_date.year, target_date.month, target_date.day, window_end_hour, tzinfo=UTC
    )

    off_hours_series = get_project_metrics_cached(
        [project_id],
        MetricType.TRACE_COUNT,
        interval=Interval.HOURLY,
        interval_start=off_hours_start,
        interval_end=off_hours_end,
    ).get(project_id, ())
    off_hours_trace_count = _sum_points_none_as_zero(off_hours_series)

    daily_series = get_project_metrics_cached(
        [project_id],
        MetricType.TRACE_COUNT,
        interval=Interval.DAILY,
        interval_start=interval_start,
        interval_end=interval_end,
    ).get(project_id, ())
    daily_map = {p.time.date(): p.value for s in daily_series for p in s.points}
    baseline_dates = [target_date - timedelta(days=d) for d in range(1, baseline_window_days + 1)]
    baseline_points = [v for d in baseline_dates if (v := daily_map.get(d)) is not None]
    if not baseline_points:
        raise ValueError(
            f"no usable baseline data for project_id={project_id!r} in the "
            f"{baseline_window_days}-day window before {target_date}"
        )
    baseline_daily_avg = sum(baseline_points) / len(baseline_points)
    baseline_hourly_rate = baseline_daily_avg / 24.0
    if baseline_hourly_rate == 0:
        raise ValueError(
            f"baseline_hourly_rate is 0 for project_id={project_id!r}: ratio is undefined"
        )

    window_hours = window_end_hour - window_start_hour
    ratio = (off_hours_trace_count / window_hours) / baseline_hourly_rate

    workflow_series = get_project_metrics_cached(
        [project_id],
        MetricType.TRACE_COUNT,
        interval=Interval.TOTAL,
        interval_start=off_hours_start,
        interval_end=off_hours_end,
        breakdown=Breakdown(BreakdownField.METADATA, metadata_key=_METADATA_WORKFLOW_KEY),
    ).get(project_id, ())
    corroborating_workflow = _highest_workflow(workflow_series)

    return NightBatchBurstFinding(
        project_id=project_id,
        is_anomalous=ratio >= ratio_threshold,
        ratio_threshold=ratio_threshold,
        off_hours_window_utc=off_hours_window_utc,
        off_hours_trace_count=off_hours_trace_count,
        baseline_hourly_rate=baseline_hourly_rate,
        ratio=ratio,
        corroborating_workflow=corroborating_workflow,
    )


def _sum_points_none_as_zero(series) -> int:
    """TRACE_COUNT-only exception (decision #4): a missing/None hourly
    point means "the backend reported zero trace writes for that hour",
    not "unknown" -- see the design doc for why this does not generalize
    to COST/SPAN_TOKEN_USAGE."""
    total = 0
    for s in series:
        for p in s.points:
            total += p.value if p.value is not None else 0
    return round(total)


def _highest_workflow(series) -> str | None:
    """The workflow metadata value with the highest total TRACE_COUNT
    over the off-hours window; None if there is no series or every
    total is 0/None (decision #3: evidence only, never gates
    is_anomalous)."""
    best_key: str | None = None
    best_value: float = 0.0
    for s in series:
        total = sum(p.value for p in s.points if p.value is not None)
        if total > 0 and (best_key is None or total > best_value):
            best_key = s.key
            best_value = total
    return best_key
