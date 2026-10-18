"""Tests for the Cost overview screen's bff HTTP layer (SDLCCT-32):
api/app.py + api/cost_overview.py.

Scope: HTTP contract (route shapes, status codes, error mapping) and the
derived-number math (budget %, projected overspend, MoM comparison). Uses
FastAPI's TestClient. opik_metrics.get_project_metrics_cached is
monkeypatched on the api.cost_overview module (same convention as
bff/tests/test_anomaly_governance_gap.py monkeypatching
get_workspace_daily_costs) -- this is a BFF pure-logic test, not a live
Opik integration test. registry.load_registry() is backed by the real
seed/catalog.AGENTS data (9 Agents, 1 unregistered: temp_supplier_scraper),
same as test_anomaly_governance_gap.py.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

import api.cost_overview as cost_overview
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

# The 9 catalog.AGENTS keys (see test_anomaly_governance_gap.py REGISTERED_KEYS).
REGISTERED_KEYS = (
    "maintenance_copilot",
    "quality_rca",
    "procurement_rfq",
    "order_status",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
)
UNREGISTERED_KEY = "temp_supplier_scraper"
ALL_KEYS = REGISTERED_KEYS + (UNREGISTERED_KEY,)

# Registered-agent budgets, summed, per seed/catalog.py (verified by reading
# the real registry: 900+400+90+30+60+290+10+220).
TOTAL_BUDGET = 2000.0

# anchor.DEFAULT_ANCHOR_DATE is 2026-10-15 -> days_elapsed=15, days_in_month=31
ANCHOR_DATE_ISO = DEFAULT_ANCHOR_DATE.isoformat()


def _series_map(cost_by_key: dict) -> dict:
    """Build the {project_id: (MetricSeries, ...)} shape
    get_project_metrics_cached() returns, one point per key."""
    out = {}
    for key, value in cost_by_key.items():
        out[key] = (
            MetricSeries(
                key=key,
                points=(MetricPoint(time=datetime(2026, 10, 1, tzinfo=UTC), value=value),),
            ),
        )
    return out


def _flat_costs(default: float = 0.0) -> dict:
    return {key: default for key in ALL_KEYS}


# ---------------------------------------------------------------------------
# /api/cost-overview/summary
# ---------------------------------------------------------------------------


def test_summary_success_shape_and_math(monkeypatch):
    costs = _flat_costs()
    costs[UNREGISTERED_KEY] = 234.5
    costs["maintenance_copilot"] = 12345.67 - 234.5  # so total_spend lands on 12345.67

    monkeypatch.setattr(
        cost_overview,
        "get_project_metrics_cached",
        lambda keys, *a, **kw: _series_map({k: costs[k] for k in keys}),
    )

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 200
    body = resp.json()

    assert body["anchor_date"] == ANCHOR_DATE_ISO
    assert body["month_start"] == "2026-10-01"
    assert body["days_elapsed"] == 15
    assert body["days_in_month"] == 31
    assert body["total_spend"] == pytest.approx(12345.67)
    assert body["total_budget"] == pytest.approx(TOTAL_BUDGET)
    assert body["budget_consumed_pct"] == pytest.approx(12345.67 / 2000.0 * 100)
    expected_projection = 12345.67 / 15 * 31
    assert body["projected_month_end_spend"] == pytest.approx(expected_projection)
    assert body["projected_overspend"] == pytest.approx(expected_projection - 2000.0)


def test_summary_unregistered_agent_counted_in_numerator_not_denominator(monkeypatch):
    """AC2: temp_supplier_scraper's spend is in total_spend but its (absent)
    budget is excluded from total_budget, and it is flagged in `unregistered`."""
    costs = _flat_costs()
    costs[UNREGISTERED_KEY] = 234.5

    monkeypatch.setattr(
        cost_overview,
        "get_project_metrics_cached",
        lambda keys, *a, **kw: _series_map({k: costs[k] for k in keys}),
    )

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 200
    body = resp.json()

    assert body["total_spend"] == pytest.approx(234.5)
    assert body["total_budget"] == pytest.approx(TOTAL_BUDGET)  # unaffected by unregistered spend
    assert body["unregistered"]["spend"] == pytest.approx(234.5)
    assert body["unregistered"]["agents"] == [
        {"key": UNREGISTERED_KEY, "display": "臨時供應商爬蟲", "spend": pytest.approx(234.5)}
    ]


def test_summary_zero_budget_yields_null_not_zero_or_error(monkeypatch):
    """total_budget == 0 -> budget_consumed_pct must be null, never 0 or a
    division-by-zero error (CONSTITUTION: missing/undefined values are
    "unknown", never 0)."""
    monkeypatch.setattr(cost_overview, "load_registry", lambda: ({"key": "a", "display": "A", "registered": False, "budget": None},))
    monkeypatch.setattr(
        cost_overview,
        "get_project_metrics_cached",
        lambda keys, *a, **kw: _series_map({"a": 50.0}),
    )

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_budget"] == 0
    assert body["budget_consumed_pct"] is None
    # projected_overspend is still computable (days_elapsed != 0)
    assert body["projected_overspend"] is not None


def test_summary_days_elapsed_zero_yields_null_projection(monkeypatch):
    """days_elapsed == 0 -> projected_month_end_spend AND projected_overspend
    must both be null (never 0 or a division-by-zero error)."""
    monkeypatch.setattr(cost_overview, "_month_bounds", lambda anchor_date: (anchor_date, 0, 31))
    monkeypatch.setattr(
        cost_overview,
        "get_project_metrics_cached",
        lambda keys, *a, **kw: _series_map(_flat_costs()),
    )

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["days_elapsed"] == 0
    assert body["projected_month_end_spend"] is None
    assert body["projected_overspend"] is None


# ---------------------------------------------------------------------------
# /api/cost-overview/period-comparison
# ---------------------------------------------------------------------------


def test_period_comparison_shape_and_month_over_month_boundaries(monkeypatch):
    calls = []

    def fake(keys, *a, interval_start, interval_end, **kw):
        calls.append((interval_start, interval_end))
        # First call = current period, second = previous period.
        if len(calls) == 1:
            return _series_map({k: (3200.0 if k == "production_scheduler" else 0.0) for k in keys})
        return _series_map({k: (1800.0 if k == "production_scheduler" else 0.0) for k in keys})

    monkeypatch.setattr(cost_overview, "get_project_metrics_cached", fake)

    resp = client.get("/api/cost-overview/period-comparison")
    assert resp.status_code == 200
    body = resp.json()

    assert body["anchor_date"] == ANCHOR_DATE_ISO
    assert body["current_period"] == {"start": "2026-10-01", "end": "2026-10-15"}
    assert body["previous_period"] == {"start": "2026-09-01", "end": "2026-09-15"}

    # Month-over-month, not timedelta(30): verify the actual query windows.
    current_start, current_end = calls[0]
    previous_start, previous_end = calls[1]
    assert current_start == datetime(2026, 10, 1, tzinfo=UTC)
    assert current_end == datetime(2026, 10, 16, tzinfo=UTC)  # anchor + 1 day
    assert previous_start == datetime(2026, 9, 1, tzinfo=UTC)
    assert previous_end == datetime(2026, 9, 16, tzinfo=UTC)

    top = body["agents"][0]
    assert top["key"] == "production_scheduler"
    assert top["current_cost"] == pytest.approx(3200.0)
    assert top["previous_cost"] == pytest.approx(1800.0)
    assert top["delta"] == pytest.approx(1400.0)
    assert top["delta_pct"] == pytest.approx(1400.0 / 1800.0 * 100)
    assert len(body["agents"]) == 9


def test_period_comparison_ranked_by_delta_descending_not_percentage(monkeypatch):
    """A small agent with a huge % increase must not outrank a large agent
    with a bigger dollar increase (delta_pct is informational only)."""
    calls = []

    def fake(keys, *a, **kw):
        calls.append(None)
        if len(calls) == 1:  # current period
            return _series_map({k: (5000.0 if k == "maintenance_copilot" else (10.0 if k == "ehs_qa" else 0.0)) for k in keys})
        return _series_map({k: (3000.0 if k == "maintenance_copilot" else (1.0 if k == "ehs_qa" else 0.0)) for k in keys})

    monkeypatch.setattr(cost_overview, "get_project_metrics_cached", fake)

    resp = client.get("/api/cost-overview/period-comparison")
    body = resp.json()
    # maintenance_copilot delta=2000 (dollar-largest); ehs_qa delta=9 but
    # delta_pct=900% (percentage-largest) -- delta ranking must win.
    assert body["agents"][0]["key"] == "maintenance_copilot"
    ehs = next(a for a in body["agents"] if a["key"] == "ehs_qa")
    assert ehs["delta_pct"] == pytest.approx(900.0)
    assert body["agents"].index(ehs) > 0


def test_period_comparison_includes_unregistered_agent_with_display_name(monkeypatch):
    monkeypatch.setattr(
        cost_overview,
        "get_project_metrics_cached",
        lambda keys, *a, **kw: _series_map(_flat_costs()),
    )

    resp = client.get("/api/cost-overview/period-comparison")
    body = resp.json()
    unreg = next(a for a in body["agents"] if a["key"] == UNREGISTERED_KEY)
    assert unreg["display"] == "臨時供應商爬蟲"


# ---------------------------------------------------------------------------
# Error mapping: OpikHTTPError / OpikTimeoutError / OpikResponseFormatError /
# OpikConfigError -> 502; MissingProjectIdsError -> 500.
# ---------------------------------------------------------------------------


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
def test_opik_client_errors_map_to_502_with_endpoint_and_status(monkeypatch, exc):
    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(cost_overview, "get_project_metrics_cached", raiser)

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_opik_timeout_error_status_code_is_none(monkeypatch):
    exc = OpikTimeoutError("request timed out", endpoint="/v1/private/projects/p1/metrics")

    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(cost_overview, "get_project_metrics_cached", raiser)

    resp = client.get("/api/cost-overview/period-comparison")
    assert resp.status_code == 502
    assert resp.json()["error"]["status_code"] is None


def test_opik_config_error_maps_to_502(monkeypatch):
    def raiser(*a, **kw):
        raise OpikConfigError("OPIK_BASE_URL is not set")

    monkeypatch.setattr(cost_overview, "get_project_metrics_cached", raiser)

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 502
    body = resp.json()
    assert "OPIK_BASE_URL" in body["error"]["message"]
    assert body["error"]["endpoint"] is None


def test_missing_project_ids_error_maps_to_500(monkeypatch):
    monkeypatch.setattr(cost_overview, "load_registry", lambda: ())

    resp = client.get("/api/cost-overview/summary")
    assert resp.status_code == 500
    assert "message" in resp.json()["error"]
