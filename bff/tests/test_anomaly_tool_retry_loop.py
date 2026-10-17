"""Tests for the tool_retry_loop anomaly rule (SDLCCT-29).

Scope: bff/anomaly_tool_retry_loop.py's detect_tool_retry_loop() and its
private alignment helpers. bff.opik_metrics.get_project_metrics_cached()
is mocked -- this is a BFF-layer pure-logic test (consistent with
bff/tests/test_anomaly_context_bloat.py's existing pattern), not an
integration test against a live Opik backend.

The mocked SPAN_COUNT / TRACE_COUNT / TRACE_ERROR_RATE series for
quality_rca reproduce the Demo dataset's real retry-loop incident
(seed/catalog.py INCIDENTS id=1, implemented in seed/generate.py's
cohorts()/emit()):
    - 85% of traces are the normal cohort: calls=5, tools=3-tuple
      non-empty -> 2 children spans/call (tool + llm) -> 10 children +
      1 root span = 11 spans/trace.
    - 15% of traces are the retry/loop cohort: calls=45, tools=1-tuple
      non-empty -> 2 children spans/call -> 90 children + 1 root span =
      91 spans/trace; 20% of THIS cohort ends in a trace-level error
      (error_info set on the trace, per generate.py's `failed` flag).
    - avg spans/trace on the incident day = 0.85*11 + 0.15*91 = 23.0;
      baseline (non-incident) days are flat at 11 (the normal cohort's
      per-trace span count) -> deviation_ratio = 23.0/11.0 ~= 2.0909
      (design doc's "~= 2.09").
    - error_rate on the incident day = fraction of traces with
      error_info = 0.15 * 0.20 = 0.03 (design doc's "~= 0.03").

Covers AC1 (quality_rca's real retry-loop event detected, co_occurred
True), AC2 (the other 8 agents never flagged, including the
procurement_rfq night_batch_burst single-signal case: spans/trace ratio
elevated but error_rate=0, so the AND logic correctly yields False),
AC3 (output carries error_rate / comparison.deviation_ratio /
co_occurred) and AC4 (threshold boundary: ratio==1.5 AND
error_rate==0.01 counts as anomalous, via >= on both sides).
"""

from datetime import UTC, date, datetime, timedelta

import anomaly_tool_retry_loop
from anomaly_tool_retry_loop import (
    MissingErrorRateDataError,
    ToolRetryLoopFinding,
    _series_to_date_map,
    detect_tool_retry_loop,
)
from opik_metrics import MetricPoint, MetricSeries, MetricType

TARGET_DATE = date(2026, 10, 14)
INTERVAL_START = datetime.combine(TARGET_DATE - timedelta(days=22), datetime.min.time(), tzinfo=UTC)
INTERVAL_END = datetime.combine(TARGET_DATE, datetime.min.time(), tzinfo=UTC)

# The other 8 Demo agents besides quality_rca (seed/catalog.py AGENTS).
OTHER_AGENTS = (
    "maintenance_copilot",
    "procurement_rfq",
    "order_status",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
    "temp_supplier_scraper",
)

# quality_rca retry-loop incident constants (seed/catalog.py INCIDENTS id=1,
# seed/generate.py cohorts()/emit()).
NORMAL_SPANS_PER_TRACE = 11.0  # calls=5, 3 tools -> (5*2)+1
LOOP_SPANS_PER_TRACE = 91.0  # calls=45, 1 tool -> (45*2)+1
LOOP_FRACTION = 0.15
LOOP_ERROR_RATE = 0.20
INCIDENT_AVG_SPANS_PER_TRACE = (
    (1 - LOOP_FRACTION) * NORMAL_SPANS_PER_TRACE + LOOP_FRACTION * LOOP_SPANS_PER_TRACE
)  # 23.0
INCIDENT_ERROR_RATE = LOOP_FRACTION * LOOP_ERROR_RATE  # 0.03


def _daily_series(by_day_offset) -> MetricSeries:
    """by_day_offset(d) -> value for d=1..22 (d=1 is TARGET_DATE)."""
    points = tuple(
        MetricPoint(
            time=datetime.combine(TARGET_DATE - timedelta(days=d - 1), datetime.min.time(), tzinfo=UTC),
            value=by_day_offset(d),
        )
        for d in range(1, 23)
    )
    return MetricSeries(key="irrelevant", points=points)


def _mock_backend(monkeypatch, *, span_series_by_project, trace_series_by_project, error_rate_series_by_project):
    def fake(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        out = {}
        for pid in project_ids:
            if metric_type is MetricType.SPAN_COUNT:
                out[pid] = (span_series_by_project[pid],)
            elif metric_type is MetricType.TRACE_COUNT:
                out[pid] = (trace_series_by_project[pid],)
            elif metric_type is MetricType.TRACE_ERROR_RATE:
                out[pid] = (error_rate_series_by_project[pid],)
            else:
                raise AssertionError(f"unexpected metric_type: {metric_type}")
        return out

    monkeypatch.setattr(anomaly_tool_retry_loop, "get_project_metrics_cached", fake)


def _flat_agent_series(avg_spans_per_trace: float = 11.0, error_rate: float = 0.0):
    """TRACE_COUNT is flat at 1.0/day, so SPAN_COUNT == avg_spans_per_trace
    directly; error_rate flat at `error_rate` every day."""
    span_series = _daily_series(lambda d: avg_spans_per_trace)
    trace_series = _daily_series(lambda d: 1.0)
    error_rate_series = _daily_series(lambda d: error_rate)
    return span_series, trace_series, error_rate_series


# AC1: quality_rca's real retry-loop event (incident day only; the 21
# baseline days before it are flat, non-incident).
def test_ac1_quality_rca_retry_loop_event_is_detected(monkeypatch):
    span_series = _daily_series(lambda d: INCIDENT_AVG_SPANS_PER_TRACE if d == 1 else NORMAL_SPANS_PER_TRACE)
    trace_series = _daily_series(lambda d: 1.0)
    error_rate_series = _daily_series(lambda d: INCIDENT_ERROR_RATE if d == 1 else 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"quality_rca": span_series},
        trace_series_by_project={"quality_rca": trace_series},
        error_rate_series_by_project={"quality_rca": error_rate_series},
    )

    finding = detect_tool_retry_loop(
        "quality_rca",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert isinstance(finding, ToolRetryLoopFinding)
    assert finding.project_id == "quality_rca"
    assert finding.co_occurred is True
    assert finding.is_anomalous is True
    assert finding.comparison.deviation_ratio == INCIDENT_AVG_SPANS_PER_TRACE / NORMAL_SPANS_PER_TRACE
    assert round(finding.comparison.deviation_ratio, 2) == 2.09
    assert finding.error_rate == INCIDENT_ERROR_RATE
    assert round(finding.error_rate, 2) == 0.03


# AC2: the other 8 agents, flat/no-incident, never false-positive.
def test_ac2_other_eight_agents_are_not_flagged(monkeypatch):
    span_series_by_project = {}
    trace_series_by_project = {}
    error_rate_series_by_project = {}
    for agent in OTHER_AGENTS:
        span_series, trace_series, error_rate_series = _flat_agent_series()
        span_series_by_project[agent] = span_series
        trace_series_by_project[agent] = trace_series
        error_rate_series_by_project[agent] = error_rate_series
    _mock_backend(
        monkeypatch,
        span_series_by_project=span_series_by_project,
        trace_series_by_project=trace_series_by_project,
        error_rate_series_by_project=error_rate_series_by_project,
    )

    for agent in OTHER_AGENTS:
        finding = detect_tool_retry_loop(
            agent,
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )
        assert finding.co_occurred is False, f"{agent} unexpectedly flagged"
        assert finding.is_anomalous is False, f"{agent} unexpectedly flagged"


# AC2 (single-signal case): procurement_rfq's night_batch_burst event day
# (seed/catalog.py INCIDENTS id=4) has an elevated spans/trace ratio (traffic
# burst) but error_rate stays 0 that day -- the AND logic must NOT flag it.
def test_ac2_procurement_rfq_night_batch_burst_single_signal_is_not_flagged(monkeypatch):
    # Ratio signal alone clears the threshold (>= 1.5)...
    span_series = _daily_series(lambda d: 20.0 if d == 1 else 10.0)
    trace_series = _daily_series(lambda d: 1.0)
    # ...but error_rate is 0 that day (and every day): no tool errors in a
    # pure traffic burst, so co_occurred must be False.
    error_rate_series = _daily_series(lambda d: 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"procurement_rfq": span_series},
        trace_series_by_project={"procurement_rfq": trace_series},
        error_rate_series_by_project={"procurement_rfq": error_rate_series},
    )

    finding = detect_tool_retry_loop(
        "procurement_rfq",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.comparison.deviation_ratio >= finding.ratio_threshold
    assert finding.error_rate == 0.0
    assert finding.co_occurred is False
    assert finding.is_anomalous is False


# AC3: output carries concrete, directly-usable evidence -- caller never
# has to recompute error_rate / comparison.deviation_ratio / co_occurred.
def test_ac3_finding_carries_concrete_evidence(monkeypatch):
    span_series = _daily_series(lambda d: INCIDENT_AVG_SPANS_PER_TRACE if d == 1 else NORMAL_SPANS_PER_TRACE)
    trace_series = _daily_series(lambda d: 1.0)
    error_rate_series = _daily_series(lambda d: INCIDENT_ERROR_RATE if d == 1 else 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"quality_rca": span_series},
        trace_series_by_project={"quality_rca": trace_series},
        error_rate_series_by_project={"quality_rca": error_rate_series},
    )

    finding = detect_tool_retry_loop(
        "quality_rca",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.error_rate == INCIDENT_ERROR_RATE
    comparison = finding.comparison
    assert comparison.target_date == TARGET_DATE
    assert comparison.baseline_window_days == 21
    assert comparison.baseline_days_used == 21
    assert comparison.actual_value == INCIDENT_AVG_SPANS_PER_TRACE
    assert comparison.baseline_value == NORMAL_SPANS_PER_TRACE
    assert comparison.deviation_ratio == INCIDENT_AVG_SPANS_PER_TRACE / NORMAL_SPANS_PER_TRACE
    assert comparison.deviation_pct == (comparison.deviation_ratio - 1.0) * 100.0
    assert finding.co_occurred is True
    assert finding.ratio_threshold == 1.5
    assert finding.error_rate_threshold == 0.01


# AC4: threshold boundary -- ratio==1.5 AND error_rate==0.01 exactly both
# count as anomalous (>=, not >, on both sub-conditions).
def test_ac4_exact_threshold_boundary_is_anomalous(monkeypatch):
    # 21 flat baseline days at 10.0 spans/trace, target day at exactly 15.0
    # -> deviation_ratio == 1.5 exactly.
    span_series = _daily_series(lambda d: 15.0 if d == 1 else 10.0)
    trace_series = _daily_series(lambda d: 1.0)
    error_rate_series = _daily_series(lambda d: 0.01 if d == 1 else 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"quality_rca": span_series},
        trace_series_by_project={"quality_rca": trace_series},
        error_rate_series_by_project={"quality_rca": error_rate_series},
    )

    finding = detect_tool_retry_loop(
        "quality_rca",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.comparison.deviation_ratio == 1.5
    assert finding.error_rate == 0.01
    assert finding.co_occurred is True
    assert finding.is_anomalous is True


# Missing/None TRACE_ERROR_RATE on target_date -> explicit
# MissingErrorRateDataError, never silently treated as error_rate=0.
def test_missing_error_rate_on_target_date_raises(monkeypatch):
    span_series = _daily_series(lambda d: 10.0)
    trace_series = _daily_series(lambda d: 1.0)
    error_rate_series = _daily_series(lambda d: None if d == 1 else 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"quality_rca": span_series},
        trace_series_by_project={"quality_rca": trace_series},
        error_rate_series_by_project={"quality_rca": error_rate_series},
    )

    import pytest

    with pytest.raises(MissingErrorRateDataError):
        detect_tool_retry_loop(
            "quality_rca",
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )


def test_series_to_date_map_of_no_results_is_empty():
    assert _series_to_date_map(None) == {}


# A day missing from one series, or present with a None/zero value, is
# excluded from the avg-spans/trace series entirely -- never coerced into
# a 0/guessed number that would distort the baseline (same contract as
# anomaly_context_bloat.py's equivalent helper).
def test_day_misaligned_between_span_and_trace_series_is_excluded(monkeypatch):
    def span_value(d):
        return 100.0

    def trace_value(d):
        if d == 10:
            return None  # simulates "missing that date" via a null point
        if d == 5:
            return 0.0
        return 1.0

    span_series = _daily_series(span_value)
    trace_series = _daily_series(trace_value)
    error_rate_series = _daily_series(lambda d: 0.0)
    _mock_backend(
        monkeypatch,
        span_series_by_project={"quality_rca": span_series},
        trace_series_by_project={"quality_rca": trace_series},
        error_rate_series_by_project={"quality_rca": error_rate_series},
    )

    finding = detect_tool_retry_loop(
        "quality_rca",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    # 21-day baseline window minus the 2 excluded days (d=5, d=10).
    assert finding.comparison.baseline_days_used == 19
    assert finding.comparison.baseline_value == 100.0
    assert finding.comparison.actual_value == 100.0
    assert finding.co_occurred is False
