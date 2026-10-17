"""Tests for the model_switch anomaly rule (SDLCCT-28).

Scope: bff/anomaly_model_switch.py's detect_model_switch() and its private
helpers. bff.opik_metrics.get_project_metrics_cached() is mocked -- this is
a BFF-layer pure-logic test (consistent with the other bff/tests/*.py
files), not an integration test against a live Opik backend.

The mocked TRACE_COUNT+TAGS / COST series reproduce the Demo dataset's
real, approved facts (docs/design/SDLCCT-28.md):
- order_status (seed/catalog.py INCIDENTS id=3, "model_switch"):
  seed/generate.py::cohorts() switches order_status's model from
  "gpt-4o-mini" to "claude-sonnet-4-5" for d <= 9 (the 9 most recent
  days before the anchor), with unscaled calls=1/prompt=4000/
  completion=250 (seed/catalog.py Agent("order_status", ...)) and SAME
  traffic (same cohort, only `model` is replaced).
- seed/model_prices.snapshot.json real unit prices:
    gpt-4o-mini:        input=0.00000015 output=0.0000006
    claude-sonnet-4-5:  input=0.000003   output=0.000015
  -> cost/trace (unscaled, calls=1, prompt=4000, completion=250):
    gpt-4o-mini:       4000*0.00000015 + 250*0.0000006  = 0.00075
    claude-sonnet-4-5: 4000*0.000003   + 250*0.000015   = 0.01575
  -> deviation_ratio = 0.01575 / 0.00075 = 21.0 exactly.

The other 8 Demo agents are modelled with a single, unchanging model tag
for the whole window (cohorts() never replaces their `model`), so
_find_switch_date() never finds a dominant-tag change for them (AC2).

Covers all 4 Gherkin AC.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

import anomaly_model_switch
from anomaly_model_switch import (
    InsufficientSwitchWindowDataError,
    ModelSwitchFinding,
    _cost_per_trace,
    _find_switch_date,
    detect_model_switch,
)
from opik_metrics import MetricPoint, MetricSeries, MetricType

ANCHOR = date(2026, 10, 15)
INTERVAL_START = datetime.combine(ANCHOR - timedelta(days=30), datetime.min.time(), tzinfo=UTC)
INTERVAL_END = datetime.combine(ANCHOR - timedelta(days=1), datetime.min.time(), tzinfo=UTC)

BEFORE_MODEL = "gpt-4o-mini"
AFTER_MODEL = "claude-sonnet-4-5"
BEFORE_COST_PER_TRACE = 4000 * 0.00000015 + 250 * 0.0000006  # 0.00075
AFTER_COST_PER_TRACE = 4000 * 0.000003 + 250 * 0.000015  # 0.01575
TRACES_PER_DAY = 10.0

OTHER_AGENTS = (
    "maintenance_copilot",
    "quality_rca",
    "procurement_rfq",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
    "temp_supplier_scraper",
)


def _day(d_ago: int) -> date:
    """d_ago=1 is INTERVAL_END's date (the most recent day); d_ago=30 is
    INTERVAL_START's date -- mirrors seed/generate.py's `d` convention."""
    return ANCHOR - timedelta(days=d_ago)


def _series(key: str, points: dict[date, float]) -> MetricSeries:
    return MetricSeries(
        key=key,
        points=tuple(
            MetricPoint(time=datetime.combine(d, datetime.min.time(), tzinfo=UTC), value=v)
            for d, v in sorted(points.items())
        ),
    )


def _order_status_trace_count_series() -> tuple[MetricSeries, ...]:
    """gpt-4o-mini dominant for d=10..30 (21 days); claude-sonnet-4-5
    dominant for d=1..9 (9 days) -- same traffic (TRACES_PER_DAY) both
    sides, per the switch-day AC's "same traffic" fact."""
    before_points = {_day(d): TRACES_PER_DAY for d in range(10, 31)}
    after_points = {_day(d): TRACES_PER_DAY for d in range(1, 10)}
    return (
        _series(f"model:{BEFORE_MODEL}", before_points),
        _series(f"model:{AFTER_MODEL}", after_points),
    )


def _order_status_cost_series() -> MetricSeries:
    points = {_day(d): TRACES_PER_DAY * BEFORE_COST_PER_TRACE for d in range(10, 31)}
    points.update({_day(d): TRACES_PER_DAY * AFTER_COST_PER_TRACE for d in range(1, 10)})
    return _series("order_status", points)


def _flat_agent_trace_count_series(model: str = "gpt-4o") -> tuple[MetricSeries, ...]:
    points = {_day(d): TRACES_PER_DAY for d in range(1, 31)}
    return (_series(f"model:{model}", points),)


def _flat_agent_cost_series(cost_per_trace: float = 0.001) -> MetricSeries:
    points = {_day(d): TRACES_PER_DAY * cost_per_trace for d in range(1, 31)}
    return _series("agent", points)


def _mock_backend(monkeypatch, *, trace_count_by_project, cost_by_project):
    def fake(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        out = {}
        for pid in project_ids:
            if metric_type is MetricType.TRACE_COUNT:
                out[pid] = trace_count_by_project[pid]
            elif metric_type is MetricType.COST:
                out[pid] = (cost_by_project[pid],)
            else:
                raise AssertionError(f"unexpected metric_type: {metric_type}")
        return out

    monkeypatch.setattr(anomaly_model_switch, "get_project_metrics_cached", fake)


# AC1: order_status's real switch day is detected, deviation_ratio ~ 21.0.
def test_ac1_order_status_switch_day_detected(monkeypatch):
    _mock_backend(
        monkeypatch,
        trace_count_by_project={"order_status": _order_status_trace_count_series()},
        cost_by_project={"order_status": _order_status_cost_series()},
    )

    finding = detect_model_switch(
        "order_status", interval_start=INTERVAL_START, interval_end=INTERVAL_END
    )

    assert isinstance(finding, ModelSwitchFinding)
    assert finding.project_id == "order_status"
    assert finding.switch_date == _day(9)
    assert finding.before_model_tag == f"model:{BEFORE_MODEL}"
    assert finding.after_model_tag == f"model:{AFTER_MODEL}"
    assert finding.before_cost_per_trace == pytest.approx(BEFORE_COST_PER_TRACE)
    assert finding.after_cost_per_trace == pytest.approx(AFTER_COST_PER_TRACE)
    assert finding.deviation_ratio == pytest.approx(21.0)
    assert finding.is_anomalous is True


# AC2: the other 8 agents, single unchanging model tag, never flagged.
def test_ac2_other_eight_agents_never_flagged(monkeypatch):
    trace_count_by_project = {agent: _flat_agent_trace_count_series() for agent in OTHER_AGENTS}
    cost_by_project = {agent: _flat_agent_cost_series() for agent in OTHER_AGENTS}
    _mock_backend(
        monkeypatch,
        trace_count_by_project=trace_count_by_project,
        cost_by_project=cost_by_project,
    )

    for agent in OTHER_AGENTS:
        finding = detect_model_switch(
            agent, interval_start=INTERVAL_START, interval_end=INTERVAL_END
        )
        assert finding.switch_date is None, f"{agent} unexpectedly got a switch_date"
        assert finding.is_anomalous is False


# AC3: output carries all 7 non-None evidence fields when anomalous.
def test_ac3_finding_carries_all_evidence_fields_when_anomalous(monkeypatch):
    _mock_backend(
        monkeypatch,
        trace_count_by_project={"order_status": _order_status_trace_count_series()},
        cost_by_project={"order_status": _order_status_cost_series()},
    )

    finding = detect_model_switch(
        "order_status", interval_start=INTERVAL_START, interval_end=INTERVAL_END
    )

    assert finding.is_anomalous is True
    assert finding.switch_date is not None
    assert finding.before_model_tag is not None
    assert finding.after_model_tag is not None
    assert finding.before_cost_per_trace is not None
    assert finding.after_cost_per_trace is not None
    assert finding.deviation_ratio is not None
    assert finding.deviation_threshold is not None


# AC4: no dominant-tag change found -> is_anomalous=False, all evidence
# fields None.
def test_ac4_no_switch_found_yields_all_none_fields(monkeypatch):
    _mock_backend(
        monkeypatch,
        trace_count_by_project={"maintenance_copilot": _flat_agent_trace_count_series()},
        cost_by_project={"maintenance_copilot": _flat_agent_cost_series()},
    )

    finding = detect_model_switch(
        "maintenance_copilot", interval_start=INTERVAL_START, interval_end=INTERVAL_END
    )

    assert finding.is_anomalous is False
    assert finding.switch_date is None
    assert finding.before_model_tag is None
    assert finding.after_model_tag is None
    assert finding.before_cost_per_trace is None
    assert finding.after_cost_per_trace is None
    assert finding.deviation_ratio is None
    assert finding.deviation_threshold == anomaly_model_switch.MODEL_SWITCH_DEVIATION_THRESHOLD


def test_no_series_at_all_yields_no_switch():
    switch_date, before_tag, after_tag, total_traces_by_date = _find_switch_date(())
    assert (switch_date, before_tag, after_tag) == (None, None, None)
    assert total_traces_by_date == {}


def test_cost_per_trace_excludes_dates_missing_from_either_side():
    daily_cost = {_day(1): 10.0, _day(2): 20.0}
    total_traces_by_date = {_day(1): 5.0}  # _day(2) missing from traces entirely
    total_cost, total_traces = _cost_per_trace(
        daily_cost, total_traces_by_date, [_day(1), _day(2)]
    )
    assert total_cost == 10.0
    assert total_traces == 5.0


def test_insufficient_window_data_raises_when_after_window_is_empty(monkeypatch):
    # switch_date lands exactly on interval_end's date -> the after-window
    # has a tag change but the cost series has zero data there.
    trace_series = (
        _series(f"model:{BEFORE_MODEL}", {_day(d): TRACES_PER_DAY for d in range(2, 31)}),
        _series(f"model:{AFTER_MODEL}", {_day(1): TRACES_PER_DAY}),
    )
    cost_series = _series(
        "agent", {_day(d): TRACES_PER_DAY * BEFORE_COST_PER_TRACE for d in range(2, 31)}
    )  # no cost point at all for _day(1) -> after-window has 0 usable cost
    _mock_backend(
        monkeypatch,
        trace_count_by_project={"agent": trace_series},
        cost_by_project={"agent": cost_series},
    )

    with pytest.raises(InsufficientSwitchWindowDataError):
        detect_model_switch("agent", interval_start=INTERVAL_START, interval_end=INTERVAL_END)
