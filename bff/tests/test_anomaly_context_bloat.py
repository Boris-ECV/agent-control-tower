"""Tests for the context_bloat anomaly rule (SDLCCT-27).

Scope: bff/anomaly_context_bloat.py's detect_context_bloat() and its
private alignment helpers. bff.opik_metrics.get_project_metrics_cached()
is mocked -- this is a BFF-layer pure-logic test (consistent with the
other bff/tests/*.py files), not an integration test against a live Opik
backend. The mocked SPAN_TOKEN_USAGE / TRACE_COUNT series for
maintenance_copilot reproduce the Demo dataset's approved, real-data-
validated context_bloat formula from docs/design/SDLCCT-27.md:
    prompt_per_call(d) = round(12000 * (1 + 2*(14-min(d, 14))/13))
    completion_per_call = 600
    calls_per_trace = 2
    tokens_per_trace(d) = calls_per_trace * (prompt_per_call(d) + completion_per_call)
where d is "days before target_date" (d=1 is target_date itself, the
most recent generated day; d<=14 ramps from 1.0x at d=14 to 3.0x at d=1;
d>14 is flat at the 1.0x base). The other 8 Demo agents are modelled as
flat, low-variance series well under the deviation threshold.

Covers AC2 (maintenance_copilot correctly detected), AC3 (other 8 agents
do not false-positive), AC4 (output carries concrete baseline/actual/
deviation numbers) and AC6 (threshold boundary: deviation_ratio == 1.30
counts as anomalous, via is_anomalous which lives in this module).
"""

from datetime import UTC, date, datetime, timedelta

import anomaly_context_bloat
from anomaly_context_bloat import ContextBloatFinding, _series_to_date_map, detect_context_bloat
from opik_metrics import MetricPoint, MetricSeries

TARGET_DATE = date(2026, 10, 14)
INTERVAL_START = datetime.combine(TARGET_DATE - timedelta(days=22), datetime.min.time(), tzinfo=UTC)
INTERVAL_END = datetime.combine(TARGET_DATE, datetime.min.time(), tzinfo=UTC)

OTHER_AGENTS = (
    "quality_rca",
    "procurement_rfq",
    "order_status",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
    "temp_supplier_scraper",
)


def _prompt_per_call(d: int) -> int:
    """Approved formula from docs/design/SDLCCT-27.md, clipped at d=14's
    base value (1.0x) for d > 14 (no incident ramp beyond 14 days ago)."""
    d_clamped = min(d, 14)
    return round(12000 * (1 + 2 * (14 - d_clamped) / 13))


def _tokens_per_trace(d: int) -> int:
    return 2 * (_prompt_per_call(d) + 600)


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


def _mock_backend(monkeypatch, *, token_series_by_project, trace_series_by_project):
    def fake(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        from opik_metrics import MetricType

        out = {}
        for pid in project_ids:
            if metric_type is MetricType.SPAN_TOKEN_USAGE:
                out[pid] = (token_series_by_project[pid],)
            elif metric_type is MetricType.TRACE_COUNT:
                out[pid] = (trace_series_by_project[pid],)
            else:
                raise AssertionError(f"unexpected metric_type: {metric_type}")
        return out

    monkeypatch.setattr(anomaly_context_bloat, "get_project_metrics_cached", fake)


def _flat_agent_series(value: float = 1000.0):
    token_series = _daily_series(lambda d: value)
    trace_series = _daily_series(lambda d: 1.0)
    return token_series, trace_series


# AC2: maintenance_copilot's real ramp pattern is correctly detected.
def test_ac2_maintenance_copilot_is_detected_as_anomalous(monkeypatch):
    token_series = _daily_series(lambda d: _tokens_per_trace(d))
    trace_series = _daily_series(lambda d: 1.0)
    _mock_backend(
        monkeypatch,
        token_series_by_project={"maintenance_copilot": token_series},
        trace_series_by_project={"maintenance_copilot": trace_series},
    )

    finding = detect_context_bloat(
        "maintenance_copilot",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert isinstance(finding, ContextBloatFinding)
    assert finding.project_id == "maintenance_copilot"
    assert finding.is_anomalous is True
    assert finding.comparison.deviation_ratio >= 1.30


# AC3: the other 8 agents, flat/low-variance, never false-positive.
def test_ac3_other_eight_agents_are_not_flagged(monkeypatch):
    token_series_by_project = {}
    trace_series_by_project = {}
    for agent in OTHER_AGENTS:
        token_series, trace_series = _flat_agent_series()
        token_series_by_project[agent] = token_series
        trace_series_by_project[agent] = trace_series
    _mock_backend(
        monkeypatch,
        token_series_by_project=token_series_by_project,
        trace_series_by_project=trace_series_by_project,
    )

    for agent in OTHER_AGENTS:
        finding = detect_context_bloat(
            agent,
            target_date=TARGET_DATE,
            interval_start=INTERVAL_START,
            interval_end=INTERVAL_END,
        )
        assert finding.is_anomalous is False, f"{agent} unexpectedly flagged"
        assert finding.comparison.deviation_ratio < 1.30


# AC4: output carries concrete, directly-usable baseline/actual/deviation
# numbers -- caller never has to recompute them.
def test_ac4_finding_carries_concrete_baseline_actual_deviation_numbers(monkeypatch):
    token_series = _daily_series(lambda d: _tokens_per_trace(d))
    trace_series = _daily_series(lambda d: 1.0)
    _mock_backend(
        monkeypatch,
        token_series_by_project={"maintenance_copilot": token_series},
        trace_series_by_project={"maintenance_copilot": trace_series},
    )

    finding = detect_context_bloat(
        "maintenance_copilot",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    comparison = finding.comparison
    assert comparison.target_date == TARGET_DATE
    assert comparison.baseline_window_days == 21
    assert comparison.baseline_days_used == 21
    assert comparison.actual_value == _tokens_per_trace(1)
    assert comparison.baseline_value > 0
    assert comparison.deviation_ratio == comparison.actual_value / comparison.baseline_value
    assert comparison.deviation_pct == (comparison.deviation_ratio - 1.0) * 100.0
    assert finding.deviation_threshold == 1.30


# AC6: threshold boundary -- deviation_ratio exactly == 1.30 counts as
# anomalous (>=, not >).
def test_ac6_deviation_ratio_exactly_at_threshold_is_anomalous(monkeypatch):
    # 21 flat baseline days at 100 tokens/trace, target day at exactly 130
    # tokens/trace -> deviation_ratio == 1.30 exactly.
    token_series = _daily_series(lambda d: 130.0 if d == 1 else 100.0)
    trace_series = _daily_series(lambda d: 1.0)
    _mock_backend(
        monkeypatch,
        token_series_by_project={"maintenance_copilot": token_series},
        trace_series_by_project={"maintenance_copilot": trace_series},
    )

    finding = detect_context_bloat(
        "maintenance_copilot",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    assert finding.comparison.deviation_ratio == 1.30
    assert finding.is_anomalous is True


# Decision #4: a day missing from one series, or present with a None/zero
# value, is excluded from the avg-tokens/trace series entirely -- never
# coerced into a 0/guessed number that would distort the baseline.
def test_day_misaligned_between_token_and_trace_series_is_excluded(monkeypatch):
    # d=10 has no trace-count data point at all; d=5 has trace_count == 0.
    # Both must be excluded from the baseline average, not treated as 0.
    def token_value(d):
        return 100.0

    def trace_value(d):
        if d == 10:
            return None  # simulates "missing that date" via a null point
        if d == 5:
            return 0.0
        return 1.0

    token_series = _daily_series(token_value)
    trace_series = _daily_series(trace_value)
    _mock_backend(
        monkeypatch,
        token_series_by_project={"maintenance_copilot": token_series},
        trace_series_by_project={"maintenance_copilot": trace_series},
    )

    finding = detect_context_bloat(
        "maintenance_copilot",
        target_date=TARGET_DATE,
        interval_start=INTERVAL_START,
        interval_end=INTERVAL_END,
    )

    # 21-day baseline window minus the 2 excluded days (d=5, d=10).
    assert finding.comparison.baseline_days_used == 19
    assert finding.comparison.baseline_value == 100.0
    assert finding.comparison.actual_value == 100.0
    assert finding.is_anomalous is False


def test_series_to_date_map_of_no_results_is_empty():
    # _single_series() returns None when a project has no series at all
    # for the window (empty tuple, not malformed) -- _series_to_date_map()
    # turns that into an empty map, not a KeyError or a guessed value.
    assert _series_to_date_map(None) == {}
