"""Tests for the Budget and savings simulation endpoint (SDLCCT-46):
api/app.py + api/budget_simulation.py.

Scope: HTTP contract (effective-rate computation, reference-agent search,
short-circuit on same-model simulation, 400/404/502 mapping).
opik_metrics.get_project_metrics_cached is monkeypatched on the
api.budget_simulation module (same convention as
bff/tests/test_api_agent_detail.py) -- this is a BFF pure-logic test, not
a live Opik integration test. registry.get_agent()/load_registry() are
backed by the real seed/catalog.AGENTS data.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import api.budget_simulation as budget_simulation_module
from anchor import DEFAULT_ANCHOR_DATE
from api.app import app
from opik_metrics import (
    MetricPoint,
    MetricSeries,
    OpikConfigError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
)

client = TestClient(app)

AGENT_KEY = "maintenance_copilot"  # claude-sonnet-4-5, registered
# gemini-2.5-pro, registered -- its own dominant model
REFERENCE_AGENT_KEY = "quality_rca"
UNREGISTERED_KEY = "temp_supplier_scraper"
WINDOW_START_ISO = "2026-09-16"
WINDOW_END_ISO = "2026-10-15"
ANCHOR_DATE_ISO = DEFAULT_ANCHOR_DATE.isoformat()
assert ANCHOR_DATE_ISO == WINDOW_END_ISO


_WINDOW_START = datetime(2026, 9, 16, tzinfo=UTC)


def _tag_series(model: str, counts: list[float | None]) -> MetricSeries:
    points = tuple(
        MetricPoint(time=_WINDOW_START + timedelta(days=i), value=v)
        for i, v in enumerate(counts)
    )
    return MetricSeries(key=f"model:{model}", points=points)


def _plain_series(values: list[float | None]) -> MetricSeries:
    points = tuple(
        MetricPoint(time=_WINDOW_START + timedelta(days=i), value=v)
        for i, v in enumerate(values)
    )
    return MetricSeries(key="irrelevant", points=points)


def _patch_metrics(
    monkeypatch,
    *,
    trace_count_by_key: dict[str, tuple] | None = None,
    cost_by_key: dict[str, float | None] | None = None,
    tokens_by_key: dict[str, float | None] | None = None,
):
    """trace_count_by_key: {key: (MetricSeries, ...)} for TRACE_COUNT+TAGS.
    cost_by_key/tokens_by_key: {key: total_value_or_None} -- a single-point
    series wrapping that total (None preserved as a null point, same
    "contributes 0" convention tested by test_api_agent_detail.py)."""
    trace_count_by_key = trace_count_by_key or {}
    cost_by_key = cost_by_key or {}
    tokens_by_key = tokens_by_key or {}

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if metric_type.value == "TRACE_COUNT":
            return {k: trace_count_by_key[k] for k in keys if k in trace_count_by_key}
        if metric_type.value == "COST":
            return {
                k: (_plain_series([cost_by_key[k]]),) for k in keys if k in cost_by_key
            }
        if metric_type.value == "SPAN_TOKEN_USAGE":
            return {
                k: (_plain_series([tokens_by_key[k]]),) for k in keys if k in tokens_by_key
            }
        raise AssertionError(f"unexpected metric_type {metric_type}")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", fake)


def _simple_setup(monkeypatch, *, agent_model="claude-sonnet-4-5", ref_model="gemini-2.5-pro"):
    """AGENT_KEY's own dominant model is agent_model; REFERENCE_AGENT_KEY's
    own dominant model is ref_model; both have simple cost/token data."""
    trace_count_by_key = {
        AGENT_KEY: (_tag_series(agent_model, [10.0] * 30),),
        REFERENCE_AGENT_KEY: (_tag_series(ref_model, [5.0] * 30),),
        "procurement_rfq": (_tag_series("claude-haiku-4-5", [5.0] * 30),),
        "order_status": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "supply_risk_monitor": (_tag_series("gemini-2.5-flash", [5.0] * 30),),
        "production_scheduler": (_tag_series("gpt-4.1", [5.0] * 30),),
        "ehs_qa": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "quoting_assistant": (_tag_series("gpt-4o", [5.0] * 30),),
    }
    _patch_metrics(
        monkeypatch,
        trace_count_by_key=trace_count_by_key,
        cost_by_key={AGENT_KEY: 100.0, REFERENCE_AGENT_KEY: 40.0},
        tokens_by_key={AGENT_KEY: 200000.0, REFERENCE_AGENT_KEY: 200000.0},
    )


# -- AC1: current_effective_rate = window COST total / SPAN_TOKEN_USAGE total


def test_current_effective_rate_is_whole_window_aggregate(monkeypatch):
    _simple_setup(monkeypatch)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gemini-2.5-pro"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_key"] == AGENT_KEY
    assert body["window_start"] == WINDOW_START_ISO
    assert body["window_end"] == WINDOW_END_ISO
    assert body["total_tokens"] == pytest.approx(200000.0)
    assert body["current_effective_rate"] == pytest.approx(100.0 / 200000.0)


# -- AC2: find reference agent dominated by target_model, compute its own rate


def test_reference_agent_found_and_its_own_rate_used(monkeypatch):
    _simple_setup(monkeypatch)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gemini-2.5-pro"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["reference_agent_key"] == REFERENCE_AGENT_KEY
    assert body["target_effective_rate"] == pytest.approx(40.0 / 200000.0)


def test_reference_agent_tie_break_picks_lexicographically_smallest_key(monkeypatch):
    """Two candidate reference agents both dominated by target_model
    'gpt-4o-mini': 'ehs_qa' and 'order_status'. 'ehs_qa' sorts first."""
    trace_count_by_key = {
        AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),),
        "quality_rca": (_tag_series("gemini-2.5-pro", [5.0] * 30),),
        "procurement_rfq": (_tag_series("claude-haiku-4-5", [5.0] * 30),),
        "order_status": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "supply_risk_monitor": (_tag_series("gemini-2.5-flash", [5.0] * 30),),
        "production_scheduler": (_tag_series("gpt-4.1", [5.0] * 30),),
        "ehs_qa": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "quoting_assistant": (_tag_series("gpt-4o", [5.0] * 30),),
    }
    _patch_metrics(
        monkeypatch,
        trace_count_by_key=trace_count_by_key,
        cost_by_key={AGENT_KEY: 100.0, "ehs_qa": 10.0, "order_status": 999.0},
        tokens_by_key={AGENT_KEY: 200000.0, "ehs_qa": 100000.0, "order_status": 100000.0},
    )

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o-mini"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["reference_agent_key"] == "ehs_qa"
    assert body["target_effective_rate"] == pytest.approx(10.0 / 100000.0)


def test_unregistered_agents_excluded_from_reference_search(monkeypatch):
    """temp_supplier_scraper is dominated by 'gpt-4o' but registered=False
    -- it must never be picked as a reference agent for target_model
    'gpt-4o', even though it is the only candidate whose tag matches."""
    trace_count_by_key = {
        AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),),
        "quality_rca": (_tag_series("gemini-2.5-pro", [5.0] * 30),),
        "procurement_rfq": (_tag_series("claude-haiku-4-5", [5.0] * 30),),
        "order_status": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "supply_risk_monitor": (_tag_series("gemini-2.5-flash", [5.0] * 30),),
        "production_scheduler": (_tag_series("gpt-4.1", [5.0] * 30),),
        "ehs_qa": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "quoting_assistant": (_tag_series("gpt-4.1", [5.0] * 30),),  # no gpt-4o here
        UNREGISTERED_KEY: (_tag_series("gpt-4o", [5.0] * 30),),
    }
    _patch_metrics(
        monkeypatch,
        trace_count_by_key=trace_count_by_key,
        cost_by_key={AGENT_KEY: 100.0},
        tokens_by_key={AGENT_KEY: 200000.0},
    )

    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o")
    assert resp.status_code == 404
    assert "gpt-4o" in resp.json()["error"]["message"]


# -- AC3: projected_cost / estimated_monthly_savings projection


def test_projected_cost_and_savings_computed_from_rates_and_total_tokens(monkeypatch):
    _simple_setup(monkeypatch)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gemini-2.5-pro"
    )
    body = resp.json()
    total_tokens = 200000.0
    current_rate = 100.0 / 200000.0
    target_rate = 40.0 / 200000.0
    assert body["projected_cost"] == pytest.approx(total_tokens * target_rate)
    assert body["estimated_monthly_savings"] == pytest.approx(
        (current_rate - target_rate) * total_tokens
    )


# -- AC4: no reference agent for target_model -> explicit 404, never 0/blank


def test_no_reference_agent_for_model_returns_404(monkeypatch):
    trace_count_by_key = {
        AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),),
        "quality_rca": (_tag_series("gemini-2.5-pro", [5.0] * 30),),
        "procurement_rfq": (_tag_series("claude-haiku-4-5", [5.0] * 30),),
        "order_status": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "supply_risk_monitor": (_tag_series("gemini-2.5-flash", [5.0] * 30),),
        "production_scheduler": (_tag_series("gpt-4.1", [5.0] * 30),),
        "ehs_qa": (_tag_series("gpt-4o-mini", [5.0] * 30),),
        "quoting_assistant": (_tag_series("gpt-4.1", [5.0] * 30),),
    }
    _patch_metrics(
        monkeypatch,
        trace_count_by_key=trace_count_by_key,
        cost_by_key={AGENT_KEY: 100.0},
        tokens_by_key={AGENT_KEY: 200000.0},
    )

    # No registered agent is dominated by gpt-4o in this fixture.
    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o")
    assert resp.status_code == 404
    body = resp.json()
    assert "gpt-4o" in body["error"]["message"]


def test_unknown_agent_key_returns_404_before_any_opik_call(monkeypatch):
    def fake(*a, **kw):
        raise AssertionError("should not be called for an unknown agent_key")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", fake)

    resp = client.get("/api/budget-simulation?agent_key=not-a-real-agent&target_model=gpt-4o")
    assert resp.status_code == 404
    assert resp.json() == {"error": {"message": "Agent 'not-a-real-agent' not found"}}


def test_unknown_target_model_returns_400_before_any_opik_call(monkeypatch):
    def fake(*a, **kw):
        raise AssertionError("should not be called for an unknown target_model")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", fake)

    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=not-a-model")
    assert resp.status_code == 400
    assert resp.json() == {"error": {"message": "Unknown target_model 'not-a-model'"}}


def test_agent_with_no_window_data_returns_404(monkeypatch):
    """AGENT_KEY itself has zero SPAN_TOKEN_USAGE data in the window --
    division-by-zero guard (decision #3), not AC5's "query failed"."""
    _patch_metrics(
        monkeypatch,
        trace_count_by_key={AGENT_KEY: ()},
        cost_by_key={AGENT_KEY: None},
        tokens_by_key={},
    )

    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o")
    assert resp.status_code == 404
    assert AGENT_KEY in resp.json()["error"]["message"]


# -- AC5: underlying query failure propagates unchanged, never swallowed


@pytest.mark.parametrize(
    "exc",
    [
        OpikHTTPError("non-2xx response", endpoint="/v1/private/projects/p1/metrics", status_code=503),
        OpikTimeoutError("request timed out", endpoint="/v1/private/projects/p1/metrics"),
        OpikResponseFormatError(
            "unexpected response shape", endpoint="/v1/private/projects/p1/metrics", status_code=200
        ),
    ],
)
def test_metrics_query_failure_maps_to_502(monkeypatch, exc):
    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", raiser)

    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_opik_config_error_maps_to_502(monkeypatch):
    def raiser(*a, **kw):
        raise OpikConfigError("OPIK_BASE_URL is not set")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", raiser)

    resp = client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gpt-4o")
    assert resp.status_code == 502
    body = resp.json()
    assert "OPIK_BASE_URL" in body["error"]["message"]
    assert body["error"]["endpoint"] is None


def test_reference_search_query_failure_maps_to_502_even_when_own_rate_succeeds(monkeypatch):
    """AC5: the failure can come from the AC2 reference-search TRACE_COUNT
    batch call (the second TRACE_COUNT-family call made), not just the
    agent's own first query."""
    exc = OpikHTTPError(
        "non-2xx response", endpoint="/v1/private/projects/p2/metrics", status_code=503
    )
    call_count = {"trace_count": 0}

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if metric_type.value == "TRACE_COUNT":
            call_count["trace_count"] += 1
            if call_count["trace_count"] == 1:
                return {AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),)}
            raise exc
        if metric_type.value == "COST":
            return {AGENT_KEY: (_plain_series([100.0]),)}
        if metric_type.value == "SPAN_TOKEN_USAGE":
            return {AGENT_KEY: (_plain_series([200000.0]),)}
        raise AssertionError(f"unexpected metric_type {metric_type}")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", fake)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gemini-2.5-pro"
    )
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p2/metrics"


# -- AC6: target_model == agent's own dominant model -> equality, savings=0


def test_same_model_simulation_short_circuits_to_equal_rates_and_zero_savings(monkeypatch):
    _patch_metrics(
        monkeypatch,
        trace_count_by_key={AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),)},
        cost_by_key={AGENT_KEY: 123.45},
        tokens_by_key={AGENT_KEY: 500000.0},
    )

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=claude-sonnet-4-5"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["reference_agent_key"] == AGENT_KEY
    assert body["current_effective_rate"] == pytest.approx(body["target_effective_rate"])
    assert body["estimated_monthly_savings"] == pytest.approx(0.0)
    assert body["projected_cost"] == pytest.approx(body["current_effective_rate"] * 500000.0)


def test_same_model_simulation_never_queries_other_agents_trace_count(monkeypatch):
    """Decision #1: the short-circuit skips AC2's search entirely, so no
    OTHER agent's TRACE_COUNT is ever queried."""
    queried_keys: list[tuple] = []

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if metric_type.value == "TRACE_COUNT":
            queried_keys.append(tuple(keys))
            return {AGENT_KEY: (_tag_series("claude-sonnet-4-5", [10.0] * 30),)}
        if metric_type.value == "COST":
            return {AGENT_KEY: (_plain_series([100.0]),)}
        if metric_type.value == "SPAN_TOKEN_USAGE":
            return {AGENT_KEY: (_plain_series([200000.0]),)}
        raise AssertionError(f"unexpected metric_type {metric_type}")

    monkeypatch.setattr(budget_simulation_module, "get_project_metrics_cached", fake)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=claude-sonnet-4-5"
    )
    assert resp.status_code == 200
    assert queried_keys == [(AGENT_KEY,)]


# -- AC7: response marks the result as an estimate


def test_response_marks_result_as_estimate(monkeypatch):
    _simple_setup(monkeypatch)

    resp = client.get(
        f"/api/budget-simulation?agent_key={AGENT_KEY}&target_model=gemini-2.5-pro"
    )
    body = resp.json()
    assert body["is_estimate"] is True
    assert isinstance(body["explanation"], str) and body["explanation"] != ""


# -- query parameter contract: both required, no defaults ------------------


def test_missing_required_query_params_returns_422():
    assert client.get("/api/budget-simulation").status_code == 422
    assert client.get(f"/api/budget-simulation?agent_key={AGENT_KEY}").status_code == 422
    assert client.get("/api/budget-simulation?target_model=gpt-4o").status_code == 422
