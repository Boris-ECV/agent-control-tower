"""Tests for the Agent detail cost-breakdown endpoint (SDLCCT-47):
api/app.py + api/agent_detail.py.

Scope: HTTP contract (version-split series, model-split breakdown, top-N
trace list, null-handling, 404/502 mapping). opik_metrics.
get_project_metrics_cached and opik_traces.get_top_traces_by_cost are
monkeypatched on the api.agent_detail module (same convention as
bff/tests/test_api_agents.py) -- this is a BFF pure-logic test, not a live
Opik integration test. registry.get_agent() is backed by the real
seed/catalog.AGENTS data.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

import api.agent_detail as agent_detail_module
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
from opik_traces import DEFAULT_TOP_TRACES_SIZE, TraceSummary

client = TestClient(app)

AGENT_KEY = "maintenance_copilot"
ANCHOR_DATE_ISO = DEFAULT_ANCHOR_DATE.isoformat()


def _version_series_map(entries: dict[str, list[float | None]]) -> dict:
    """Shape for the DAILY/METADATA(deployed_version) breakdown query: one
    MetricSeries per version, 7 points each (2026-10-09 .. 2026-10-15)."""
    series = []
    for version, values in entries.items():
        points = tuple(
            MetricPoint(time=datetime(2026, 10, 9 + i, tzinfo=UTC), value=v)
            for i, v in enumerate(values)
        )
        series.append(MetricSeries(key=version, points=points))
    return {AGENT_KEY: tuple(series)}


def _model_series_map(entries: dict[str, float | None]) -> dict:
    """Shape for the TOTAL/TAGS breakdown query: one MetricSeries per model,
    a single point each."""
    series = [
        MetricSeries(
            key=model,
            points=(MetricPoint(time=datetime(2026, 10, 1, tzinfo=UTC), value=value),),
        )
        for model, value in entries.items()
    ]
    return {AGENT_KEY: tuple(series)}


def _patch_metrics(monkeypatch, *, version_map: dict, model_map: dict):
    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if interval.value == "DAILY":
            return version_map
        return model_map

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake)


def _patch_traces(monkeypatch, traces, *, capture=None):
    def fake(project_name, *, size=DEFAULT_TOP_TRACES_SIZE):
        if capture is not None:
            capture["project_name"] = project_name
            capture["size"] = size
        return traces

    monkeypatch.setattr(agent_detail_module, "get_top_traces_by_cost", fake)


def _default_setup(monkeypatch):
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({"v1.2.0": [1.0] * 7}),
        model_map=_model_series_map({"gpt-4o": 10.0}),
    )
    _patch_traces(monkeypatch, ())


# -- AC1: version-split series, null preserved -------------------------------


def test_version_cost_series_null_points_preserved(monkeypatch):
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map(
            {"v1.2.0": [1.0, 2.0, None, 4.0, 5.0, 6.0, 7.0]}
        ),
        model_map=_model_series_map({}),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()

    assert body["key"] == AGENT_KEY
    assert body["anchor_date"] == ANCHOR_DATE_ISO
    assert body["period_start"] == "2026-10-01"
    series = body["version_cost_series"]
    assert len(series) == 1
    assert series[0]["version"] == "v1.2.0"
    assert series[0]["points"][2] == {"date": "2026-10-11", "value": None}
    assert series[0]["points"][0] == {"date": "2026-10-09", "value": pytest.approx(1.0)}


def test_version_cost_series_queried_with_metadata_breakdown(monkeypatch):
    captured = {}

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if interval.value == "DAILY":
            captured["version_breakdown"] = breakdown
            return _version_series_map({"v1.2.0": [1.0] * 7})
        captured["model_breakdown"] = breakdown
        return _model_series_map({})

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200

    assert captured["version_breakdown"].field.value == "metadata"
    assert captured["version_breakdown"].metadata_key == "deployed_version"


# -- AC2: model-split breakdown (TAGS) ---------------------------------------


def test_model_cost_breakdown_sums_non_null_points(monkeypatch):
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({}),
        model_map=_model_series_map({"gpt-4o": 12.5, "claude-3": 7.5}),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    body = resp.json()

    by_model = {e["model"]: e["cost"] for e in body["model_cost_breakdown"]}
    assert by_model["gpt-4o"] == pytest.approx(12.5)
    assert by_model["claude-3"] == pytest.approx(7.5)


def test_model_cost_breakdown_null_when_all_points_null_never_zero(monkeypatch):
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({}),
        model_map=_model_series_map({"gpt-4o": None}),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    body = resp.json()

    entry = body["model_cost_breakdown"][0]
    assert entry["model"] == "gpt-4o"
    assert entry["cost"] is None


def test_model_breakdown_queried_with_tags_breakdown(monkeypatch):
    captured = {}

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if interval.value == "DAILY":
            return _version_series_map({})
        captured["breakdown"] = breakdown
        return _model_series_map({})

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    assert captured["breakdown"].field.value == "tags"


# -- AC3: top-N trace list ----------------------------------------------------


def _trace(id_, cost, metadata=None):
    raw = {"id": id_, "total_estimated_cost": cost}
    return TraceSummary(id=id_, metadata=metadata, raw=raw)


def test_top_traces_default_size_matches_default_top_traces_size(monkeypatch):
    _patch_metrics(
        monkeypatch, version_map=_version_series_map({}), model_map=_model_series_map({})
    )
    capture = {}
    _patch_traces(monkeypatch, (_trace("t1", 50.0), _trace("t2", 20.0)), capture=capture)

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    assert capture["size"] == DEFAULT_TOP_TRACES_SIZE
    assert capture["project_name"] == AGENT_KEY

    traces = resp.json()["top_traces"]
    assert traces == [
        {"id": "t1", "total_estimated_cost": pytest.approx(50.0), "metadata": None},
        {"id": "t2", "total_estimated_cost": pytest.approx(20.0), "metadata": None},
    ]


def test_top_traces_custom_top_n_passed_through(monkeypatch):
    _patch_metrics(
        monkeypatch, version_map=_version_series_map({}), model_map=_model_series_map({})
    )
    capture = {}
    _patch_traces(monkeypatch, (_trace("t1", 50.0),), capture=capture)

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown?top_n=3")
    assert resp.status_code == 200
    assert capture["size"] == 3


def test_top_traces_missing_cost_field_is_null_not_dropped(monkeypatch):
    _patch_metrics(
        monkeypatch, version_map=_version_series_map({}), model_map=_model_series_map({})
    )
    trace = TraceSummary(id="t1", metadata={"x": 1}, raw={"id": "t1"})
    _patch_traces(monkeypatch, (trace,))

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    body = resp.json()

    assert body["top_traces"] == [{"id": "t1", "total_estimated_cost": None, "metadata": {"x": 1}}]


# -- AC5: unknown key -> 404 --------------------------------------------------


def test_unknown_agent_key_returns_404_never_empty_data(monkeypatch):
    _default_setup(monkeypatch)

    resp = client.get("/api/agents/not-a-real-agent/cost-breakdown")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Agent 'not-a-real-agent' not found"}


def test_unknown_agent_key_never_calls_opik(monkeypatch):
    calls = {"metrics": 0, "traces": 0}

    def fake_metrics(*a, **kw):
        calls["metrics"] += 1
        raise AssertionError("should not be called for an unknown key")

    def fake_traces(*a, **kw):
        calls["traces"] += 1
        raise AssertionError("should not be called for an unknown key")

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake_metrics)
    monkeypatch.setattr(agent_detail_module, "get_top_traces_by_cost", fake_traces)

    resp = client.get("/api/agents/not-a-real-agent/cost-breakdown")
    assert resp.status_code == 404
    assert calls == {"metrics": 0, "traces": 0}


# -- AC4: any one of the 3 underlying queries failing -> explicit 502 -------


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

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", raiser)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_opik_config_error_maps_to_502(monkeypatch):
    def raiser(*a, **kw):
        raise OpikConfigError("OPIK_BASE_URL is not set")

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", raiser)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 502
    body = resp.json()
    assert "OPIK_BASE_URL" in body["error"]["message"]
    assert body["error"]["endpoint"] is None


def test_model_breakdown_query_failure_maps_to_502_even_when_version_succeeds(monkeypatch):
    """AC4 says "any one of the three underlying queries" fails -> 502.
    The other tests in this group all fail on the *first* call made
    (version/DAILY), since get_project_metrics_cached is mocked with a
    single unconditional raiser. This test fails only on the *second*
    call (model/TOTAL) while the first succeeds, proving the error
    propagates regardless of which of the three queries is the one that
    fails -- not just because it happens to be first."""
    exc = OpikHTTPError(
        "non-2xx response", endpoint="/v1/private/projects/p1/metrics", status_code=503
    )

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if interval.value == "DAILY":
            return _version_series_map({"v1.2.0": [1.0] * 7})
        raise exc

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_traces_query_failure_maps_to_502_even_when_metrics_succeed(monkeypatch):
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({"v1.2.0": [1.0] * 7}),
        model_map=_model_series_map({"gpt-4o": 10.0}),
    )

    exc = OpikHTTPError("non-2xx response", endpoint="/v1/private/traces", status_code=500)

    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(agent_detail_module, "get_top_traces_by_cost", raiser)

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/traces"
