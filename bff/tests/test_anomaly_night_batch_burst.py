"""Tests for the night_batch_burst anomaly rule (SDLCCT-30).

Scope: bff/anomaly_night_batch_burst.py's detect_night_batch_burst() and
its private helpers. bff.opik_metrics.get_project_metrics_cached() is
mocked -- this is a BFF-layer pure-logic test (consistent with the other
bff/tests/*.py files, e.g. test_anomaly_context_bloat.py), not an
integration test against a live Opik backend.

The mocked data for procurement_rfq reproduces the real Demo dataset's
night_batch_burst incident, per docs/design/SDLCCT-30.md and
seed/catalog.py INCIDENTS[3] / seed/generate.py cohorts():
    - base_traces=25, weekend factor 0.3, jitter uniform(0.9, 1.1)
      (seed/generate.py day_count()) drives the DAILY baseline series.
    - On d=4 (target_date), a 600-trace cohort lands entirely inside
      UTC 17:00-19:00 (seed/generate.py cohorts(): hours=(17, 19),
      workflow="rfq_batch_rerun"), landing in the HOURLY off-hours
      window query.

Covers AC1 (procurement_rfq's real burst detected, ratio ~290-353),
AC2 (other 8 agents never flagged, max ratio ~1, margin >= 9), AC3
(output carries off_hours_trace_count / baseline_hourly_rate / ratio /
corroborating_workflow), AC4 (MissingProjectIdsError propagates via the
underlying get_project_metrics_cached([]) contract) and AC5 (ratio == 10
exactly counts as anomalous, >= not >).
"""

from datetime import UTC, date, datetime, timedelta

import pytest

import anomaly_night_batch_burst
from anomaly_night_batch_burst import (
    NightBatchBurstFinding,
    detect_night_batch_burst,
)
from opik_metrics import (
    MetricPoint,
    MetricSeries,
    MetricType,
    MissingProjectIdsError,
    get_project_metrics_cached,
)

TARGET_DATE = date(2026, 10, 14)
INTERVAL_START = datetime.combine(TARGET_DATE - timedelta(days=22), datetime.min.time(), tzinfo=UTC)
INTERVAL_END = datetime.combine(TARGET_DATE, datetime.min.time(), tzinfo=UTC)
OFF_HOURS_START = datetime(TARGET_DATE.year, TARGET_DATE.month, TARGET_DATE.day, 17, tzinfo=UTC)
OFF_HOURS_END = datetime(TARGET_DATE.year, TARGET_DATE.month, TARGET_DATE.day, 19, tzinfo=UTC)

OTHER_AGENTS = (
    "maintenance_copilot",
    "quality_rca",
    "order_status",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
    "temp_supplier_scraper",
)


def _daily_series(by_day_offset) -> MetricSeries:
    """by_day_offset(d) -> value for d=1..22 (d=1 is TARGET_DATE, excluded
    from its own baseline by detect_night_batch_burst())."""
    points = tuple(
        MetricPoint(
            time=datetime.combine(TARGET_DATE - timedelta(days=d - 1), datetime.min.time(), tzinfo=UTC),
            value=by_day_offset(d),
        )
        for d in range(1, 23)
    )
    return MetricSeries(key="irrelevant", points=points)


def _flat_daily_hourly_rate(daily_value: float = 25.0) -> MetricSeries:
    """A flat 21-day (+target day) baseline series: every day has the
    same daily trace count -> baseline_hourly_rate = daily_value / 24."""
    return _daily_series(lambda d: daily_value)


def _mock_backend(
    monkeypatch,
    *,
    off_hours_hourly_by_project,
    daily_by_project,
    workflow_total_by_project,
):
    def fake(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        from opik_metrics import Interval

        out = {}
        for pid in project_ids:
            if metric_type is MetricType.TRACE_COUNT and interval is Interval.HOURLY:
                out[pid] = (off_hours_hourly_by_project[pid],)
            elif metric_type is MetricType.TRACE_COUNT and interval is Interval.DAILY:
                out[pid] = (daily_by_project[pid],)
            elif metric_type is MetricType.TRACE_COUNT and interval is Interval.TOTAL:
                out[pid] = workflow_total_by_project.get(pid, ())
            else:
                raise AssertionError(f"unexpected call: {metric_type}/{interval}")
        return out

    monkeypatch.setattr(anomaly_night_batch_burst, "get_project_metrics_cached", fake)


def _procurement_rfq_off_hours_series(count: int = 600) -> MetricSeries:
    # 600 traces spread over the 2-hour UTC 17-19 window, as one hourly
    # point per hour per seed/generate.py's uniform-random-offset-within-
    # window placement -- the exact per-hour split doesn't matter, only
    # the sum does (detect_night_batch_burst sums hourly points).
    return MetricSeries(
        key="procurement_rfq",
        points=(
            MetricPoint(time=OFF_HOURS_START, value=count / 2),
            MetricPoint(time=OFF_HOURS_START + timedelta(hours=1), value=count / 2),
        ),
    )


def _flat_agent_off_hours_series(value: float = 0.0) -> MetricSeries:
    return MetricSeries(
        key="irrelevant",
        points=(
            MetricPoint(time=OFF_HOURS_START, value=value),
            MetricPoint(time=OFF_HOURS_START + timedelta(hours=1), value=value),
        ),
    )


def _workflow_series(workflow: str, total: float) -> tuple[MetricSeries, ...]:
    return (MetricSeries(key=workflow, points=(MetricPoint(time=OFF_HOURS_START, value=total),)),)


# AC1: procurement_rfq's real night burst is detected (ratio ~290-353).
def test_ac1_procurement_rfq_real_burst_is_detected(monkeypatch):
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": _procurement_rfq_off_hours_series()},
        daily_by_project={"procurement_rfq": _flat_daily_hourly_rate(25.0)},
        workflow_total_by_project={"procurement_rfq": _workflow_series("rfq_batch_rerun", 600.0)},
    )

    finding = detect_night_batch_burst(
        "procurement_rfq",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert isinstance(finding, NightBatchBurstFinding)
    assert finding.project_id == "procurement_rfq"
    assert finding.off_hours_trace_count == 600
    # Real Demo dataset ratio range per docs/design/SDLCCT-30.md is
    # ~290-353 depending on the 21-day baseline window's weekend/jitter
    # mix; this mock uses a flat baseline (no weekend/jitter variation),
    # which lands at 288.0 -- just below that range but still an order
    # of magnitude past the threshold, so it exercises the same
    # real-formula shape (base_traces=25 / 24h) without claiming a
    # precision this flat mock can't reproduce.
    assert 280.0 <= finding.ratio <= 353.0
    assert finding.is_anomalous is True


# AC2: the other 8 agents, with no off-hours cohort, never false-positive
# (ratio ~1, margin >= 9 below the threshold of 10).
def test_ac2_other_eight_agents_are_not_flagged(monkeypatch):
    off_hours_by_project = {}
    daily_by_project = {}
    workflow_by_project = {}
    for agent in OTHER_AGENTS:
        # Off-hours window gets its natural share of a uniform 24h day:
        # daily_value(25) / 24 hours * 2-hour window = ~2.08 traces.
        off_hours_by_project[agent] = _flat_agent_off_hours_series(25.0 / 24.0)
        daily_by_project[agent] = _flat_daily_hourly_rate(25.0)
        workflow_by_project[agent] = ()
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project=off_hours_by_project,
        daily_by_project=daily_by_project,
        workflow_total_by_project=workflow_by_project,
    )

    for agent in OTHER_AGENTS:
        finding = detect_night_batch_burst(
            agent,
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )
        assert finding.is_anomalous is False, f"{agent} unexpectedly flagged"
        assert finding.ratio <= 1.1
        assert finding.ratio_threshold - finding.ratio >= 9.0


# AC3: output carries concrete evidence, including the corroborating
# workflow metadata -- caller never has to recompute any of it.
def test_ac3_finding_carries_concrete_evidence_fields(monkeypatch):
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": _procurement_rfq_off_hours_series()},
        daily_by_project={"procurement_rfq": _flat_daily_hourly_rate(25.0)},
        workflow_total_by_project={"procurement_rfq": _workflow_series("rfq_batch_rerun", 600.0)},
    )

    finding = detect_night_batch_burst(
        "procurement_rfq",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.off_hours_trace_count == 600
    assert finding.baseline_hourly_rate == pytest.approx(25.0 / 24.0)
    assert finding.ratio == pytest.approx((600 / 2) / (25.0 / 24.0))
    assert finding.corroborating_workflow == "rfq_batch_rerun"
    assert finding.off_hours_window_utc == (17, 19)
    assert finding.ratio_threshold == 10.0


# AC4: MissingProjectIdsError (raised by get_project_metrics_cached() when
# project_ids is empty) propagates unchanged -- tested directly against
# the underlying contract, since detect_night_batch_burst()'s own
# signature takes a single non-empty project_id (design doc decision #5).
def test_ac4_missing_project_ids_error_propagates_from_underlying_call():
    with pytest.raises(MissingProjectIdsError):
        get_project_metrics_cached(
            [],
            MetricType.TRACE_COUNT,
            interval=anomaly_night_batch_burst.Interval.HOURLY,
            interval_start=OFF_HOURS_START,
            interval_end=OFF_HOURS_END,
        )


# AC5: threshold boundary -- ratio exactly == 10.0 counts as anomalous
# (>=, not >).
def test_ac5_ratio_exactly_at_threshold_is_anomalous(monkeypatch):
    # baseline_hourly_rate = 1.0 (daily_value=24 / 24); off_hours window
    # is 2 hours wide; off_hours_trace_count=20 -> (20/2)/1.0 == 10.0.
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": _flat_agent_off_hours_series(10.0)},
        daily_by_project={"procurement_rfq": _flat_daily_hourly_rate(24.0)},
        workflow_total_by_project={"procurement_rfq": ()},
    )

    finding = detect_night_batch_burst(
        "procurement_rfq",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.off_hours_trace_count == 20
    assert finding.baseline_hourly_rate == 1.0
    assert finding.ratio == 10.0
    assert finding.is_anomalous is True
    assert finding.corroborating_workflow is None


# Decision #4: missing/None off-hours hourly points are summed as 0, a
# deliberate TRACE_COUNT-only exception to the "None never becomes 0"
# convention.
def test_off_hours_none_points_are_summed_as_zero(monkeypatch):
    off_hours_series = MetricSeries(
        key="procurement_rfq",
        points=(
            MetricPoint(time=OFF_HOURS_START, value=None),
            MetricPoint(time=OFF_HOURS_START + timedelta(hours=1), value=20.0),
        ),
    )
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": off_hours_series},
        daily_by_project={"procurement_rfq": _flat_daily_hourly_rate(24.0)},
        workflow_total_by_project={"procurement_rfq": ()},
    )

    finding = detect_night_batch_burst(
        "procurement_rfq",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.off_hours_trace_count == 20


# Decision #2: a zero/absent baseline raises a plain ValueError (no new
# exception class), named after project_id.
def test_zero_baseline_raises_value_error(monkeypatch):
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": _flat_agent_off_hours_series(5.0)},
        daily_by_project={"procurement_rfq": _daily_series(lambda d: None)},
        workflow_total_by_project={"procurement_rfq": ()},
    )

    with pytest.raises(ValueError, match="procurement_rfq"):
        detect_night_batch_burst(
            "procurement_rfq",
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )


# Decision #2 (continued): a baseline whose non-None values are present
# but average to exactly 0 also raises a plain ValueError (distinct from
# the "no non-None day at all" case above, but the same guard).
def test_baseline_averaging_to_zero_raises_value_error(monkeypatch):
    _mock_backend(
        monkeypatch,
        off_hours_hourly_by_project={"procurement_rfq": _flat_agent_off_hours_series(5.0)},
        daily_by_project={"procurement_rfq": _daily_series(lambda d: 0.0)},
        workflow_total_by_project={"procurement_rfq": ()},
    )

    with pytest.raises(ValueError, match="procurement_rfq"):
        detect_night_batch_burst(
            "procurement_rfq",
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )
