"""Tests for the Agent registry screen's bff HTTP layer (SDLCCT-43):
api/app.py + api/agents.py.

Scope: HTTP contract (all 9 Agents, response shape, error mapping),
budget_consumed_pct null-handling, trend null-point preservation, and
governance-gap flag correctness. opik_metrics.get_project_metrics_cached
is monkeypatched on the api.agents module (same convention as
bff/tests/test_api_cost_overview.py) -- this is a BFF pure-logic test,
not a live Opik integration test. registry.load_registry() is backed by
the real seed/catalog.AGENTS data (9 Agents, 1 unregistered:
temp_supplier_scraper).
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

import api.agents as agents_module
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

ANCHOR_DATE_ISO = DEFAULT_ANCHOR_DATE.isoformat()


def _total_series_map(cost_by_key: dict) -> dict:
    """Shape for a Interval.TOTAL query: one point per key."""
    out = {}
    for key, value in cost_by_key.items():
        out[key] = (
            MetricSeries(
                key=key,
                points=(MetricPoint(time=datetime(2026, 10, 1, tzinfo=UTC), value=value),),
            ),
        )
    return out


def _daily_series_map(values_by_key: dict) -> dict:
    """Shape for a Interval.DAILY 7-day query: 7 points per key, dated
    2026-10-09 .. 2026-10-15 (anchor - 6 days .. anchor), values_by_key[key]
    is a 7-element sequence (may contain None)."""
    out = {}
    for key, values in values_by_key.items():
        points = tuple(
            MetricPoint(time=datetime(2026, 10, 9 + i, tzinfo=UTC), value=v)
            for i, v in enumerate(values)
        )
        out[key] = (MetricSeries(key=key, points=points),)
    return out


def _flat_costs(default: float = 0.0) -> dict:
    return {key: default for key in ALL_KEYS}


def _patched(monkeypatch, *, totals: dict, dailies: dict):
    calls = {"n": 0}

    def fake(keys, metric_type, *, interval, **kw):
        calls["n"] += 1
        if interval.value == "TOTAL":
            return _total_series_map({k: totals.get(k, 0.0) for k in keys})
        return _daily_series_map({k: dailies.get(k, [0.0] * 7) for k in keys})

    monkeypatch.setattr(agents_module, "get_project_metrics_cached", fake)
    return calls


def test_all_9_agents_returned_in_registry_order(monkeypatch):
    _patched(monkeypatch, totals=_flat_costs(), dailies={})

    resp = client.get("/api/agents")
    assert resp.status_code == 200
    body = resp.json()

    assert body["anchor_date"] == ANCHOR_DATE_ISO
    assert body["period_start"] == "2026-10-01"
    assert len(body["agents"]) == 9
    assert [a["key"] for a in body["agents"]] == list(ALL_KEYS)


def test_governance_gap_flag_correctness(monkeypatch):
    _patched(monkeypatch, totals=_flat_costs(), dailies={})

    resp = client.get("/api/agents")
    body = resp.json()

    by_key = {a["key"]: a for a in body["agents"]}
    assert by_key[UNREGISTERED_KEY]["has_governance_gap"] is True
    for key in REGISTERED_KEYS:
        assert by_key[key]["has_governance_gap"] is False, key


def test_budget_consumed_pct_null_when_no_budget_never_zero(monkeypatch):
    totals = _flat_costs()
    totals[UNREGISTERED_KEY] = 234.5
    _patched(monkeypatch, totals=totals, dailies={})

    resp = client.get("/api/agents")
    body = resp.json()

    unreg = next(a for a in body["agents"] if a["key"] == UNREGISTERED_KEY)
    assert unreg["budget"] is None
    assert unreg["current_period_spend"] == pytest.approx(234.5)
    assert unreg["budget_consumed_pct"] is None


def test_budget_consumed_pct_computed_for_registered_agent(monkeypatch):
    totals = _flat_costs()
    totals["maintenance_copilot"] = 612.4  # budget = 900.0 per seed/catalog.py
    _patched(monkeypatch, totals=totals, dailies={})

    resp = client.get("/api/agents")
    body = resp.json()

    mc = next(a for a in body["agents"] if a["key"] == "maintenance_copilot")
    assert mc["budget"] == pytest.approx(900.0)
    assert mc["budget_consumed_pct"] == pytest.approx(612.4 / 900.0 * 100)


def test_trend_null_points_preserved_never_coerced_to_zero(monkeypatch):
    dailies = {"maintenance_copilot": [18.2, 21.0, 19.5, None, 22.8, 25.1, 20.3]}
    _patched(monkeypatch, totals=_flat_costs(), dailies=dailies)

    resp = client.get("/api/agents")
    body = resp.json()

    mc = next(a for a in body["agents"] if a["key"] == "maintenance_copilot")
    assert len(mc["trend"]) == 7
    assert mc["trend"][0] == {"date": "2026-10-09", "value": pytest.approx(18.2)}
    assert mc["trend"][3] == {"date": "2026-10-12", "value": None}
    assert mc["trend"][6] == {"date": "2026-10-15", "value": pytest.approx(20.3)}


def test_trend_queried_once_as_a_single_batch_not_per_agent(monkeypatch):
    calls = _patched(monkeypatch, totals=_flat_costs(), dailies={})

    resp = client.get("/api/agents")
    assert resp.status_code == 200
    # Exactly 2 calls total: one TOTAL batch (current_period_spend) + one
    # DAILY batch (trend) -- never one call per Agent (9 Agents would be 18
    # calls if querying per-agent).
    assert calls["n"] == 2


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
def test_opik_client_errors_propagate_and_map_to_502(monkeypatch, exc):
    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(agents_module, "get_project_metrics_cached", raiser)

    resp = client.get("/api/agents")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_opik_config_error_maps_to_502(monkeypatch):
    def raiser(*a, **kw):
        raise OpikConfigError("OPIK_BASE_URL is not set")

    monkeypatch.setattr(agents_module, "get_project_metrics_cached", raiser)

    resp = client.get("/api/agents")
    assert resp.status_code == 502
    body = resp.json()
    assert "OPIK_BASE_URL" in body["error"]["message"]
    assert body["error"]["endpoint"] is None
