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
    BreakdownField,
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


def _patch_metrics(
    monkeypatch, *, version_map: dict, model_map: dict, total_map: dict | None = None
):
    """Patch the 3 get_project_metrics_cached() calls made by
    get_agent_cost_breakdown(), dispatching on `breakdown` (SDLCCT-76: a
    bare `interval.value == "DAILY"` check can no longer distinguish the
    version-breakdown query from the new no-breakdown total query -- both
    are DAILY). `total_map` defaults to `version_map` itself when omitted:
    since `_by_date()` summing that same series tuple reproduces exactly
    the version series' own per-day totals, this yields a zero gap every
    day (no "其他" entry appended), preserving every pre-SDLCCT-76 test's
    expected response shape without each of them having to say so."""
    if total_map is None:
        total_map = version_map

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if breakdown is not None and breakdown.field == BreakdownField.METADATA:
            return version_map
        if breakdown is not None and breakdown.field == BreakdownField.TAGS:
            return model_map
        return total_map

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
        if breakdown is not None and breakdown.field == BreakdownField.METADATA:
            captured["version_breakdown"] = breakdown
            return _version_series_map({"v1.2.0": [1.0] * 7})
        if breakdown is not None and breakdown.field == BreakdownField.TAGS:
            captured["model_breakdown"] = breakdown
            return _model_series_map({})
        # the new no-breakdown total query (SDLCCT-76): match the version
        # series exactly so no "其他" entry is appended here.
        return _version_series_map({"v1.2.0": [1.0] * 7})

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


# -- SDLCCT-76: "其他／未標記版本" entry for untagged cost -------------------


def test_other_version_entry_appended_for_day_with_gap(monkeypatch):
    """Scenario 1: version_cost_series already has version entries, but the
    no-breakdown total query shows one day's real total is higher than the
    sum of the known versions that day -> a trailing "其他／未標記版本"
    entry is appended, with null on every day that has no gap and the gap
    amount on the one day that does."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({"v1.2.0": [1.0] * 7}),
        model_map=_model_series_map({}),
        total_map=_version_series_map(
            {"total": [1.0, 1.0, 1.0, 4.0, 1.0, 1.0, None]}
        ),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    series = body["version_cost_series"]
    assert len(series) == 2
    assert series[0]["version"] == "v1.2.0"
    other = series[1]
    assert other["version"] == "其他／未標記版本"
    by_date = {p["date"]: p["value"] for p in other["points"]}
    assert len(by_date) == 7
    assert by_date["2026-10-12"] == pytest.approx(3.0)  # total 4.0 - version 1.0
    assert by_date["2026-10-15"] is None  # total itself unknown that day -> null, not a gap
    for date_iso, value in by_date.items():
        if date_iso not in ("2026-10-12", "2026-10-15"):
            assert value is None


def test_other_version_entry_not_appended_when_fully_covered(monkeypatch):
    """Scenario 2: every day's version-split sum already equals the
    no-breakdown total (within the 1-cent tolerance) -> no "其他" entry is
    appended, and the response is byte-identical to the pre-SDLCCT-76
    SDLCCT-47 shape."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({"v1.2.0": [1.0] * 7}),
        model_map=_model_series_map({"gpt-4o": 10.0}),
        # total_map omitted -> defaults to version_map: exact match, no gap.
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_cost_series"] == [
        {
            "version": "v1.2.0",
            "points": [
                {"date": f"2026-10-{9 + i:02d}", "value": pytest.approx(1.0)}
                for i in range(7)
            ],
        }
    ]


def test_other_version_entry_not_appended_when_gap_within_threshold(monkeypatch):
    """A sub-cent gap (floating point noise) must not trigger the "其他"
    entry -- see docs/design/SDLCCT-76.md decision #3's 1-cent tolerance."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({"v1.2.0": [1.0] * 7}),
        model_map=_model_series_map({}),
        total_map=_version_series_map({"total": [1.005] * 7}),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["version_cost_series"]) == 1
    assert body["version_cost_series"][0]["version"] == "v1.2.0"


def test_other_version_entry_not_appended_when_gap_exactly_at_threshold(monkeypatch):
    """Boundary: a gap of exactly 0.01 (the stated 1-cent threshold itself,
    bit-for-bit -- version_map is empty so the gap is the raw total value
    with no subtraction-induced float noise) must NOT trigger the "其他"
    entry anywhere: the comparison is strictly `gap > 0.01`, not `>=`."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({}),
        model_map=_model_series_map({}),
        total_map=_version_series_map({"total": [0.01] * 7}),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_cost_series"] == []


def test_other_version_entry_appended_when_gap_just_above_threshold(monkeypatch):
    """Boundary complement: on a single day where the (bit-exact, no
    subtraction noise) gap is 0.02 while every other day is exactly 0.01
    (at, not over, the threshold), only that one day triggers the "其他"
    entry -- proving the boundary isn't rounded loosely in either
    direction."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({}),
        model_map=_model_series_map({}),
        total_map=_version_series_map(
            {"total": [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.02]}
        ),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    series = body["version_cost_series"]
    assert len(series) == 1
    other = series[0]
    assert other["version"] == "其他／未標記版本"
    by_date = {p["date"]: p["value"] for p in other["points"]}
    assert by_date["2026-10-15"] == pytest.approx(0.02)
    for date_iso, value in by_date.items():
        if date_iso != "2026-10-15":
            assert value is None


def test_total_cost_query_failure_maps_to_502_even_when_version_and_model_succeed(
    monkeypatch,
):
    """AC4/decision #2: the NEW third query (no-breakdown daily total,
    added by SDLCCT-76) must propagate a failure to an explicit 502 exactly
    like the pre-existing two queries do -- not be silently swallowed into
    "no gap detected". Succeeds on the METADATA (version) and TAGS (model)
    calls, fails only on the third (breakdown=None) call."""
    exc = OpikHTTPError(
        "non-2xx response", endpoint="/v1/private/projects/p1/metrics", status_code=503
    )

    def fake(keys, metric_type, *, interval, breakdown=None, **kw):
        if breakdown is not None and breakdown.field == BreakdownField.METADATA:
            return _version_series_map({"v1.2.0": [1.0] * 7})
        if breakdown is not None and breakdown.field == BreakdownField.TAGS:
            return _model_series_map({"gpt-4o": 10.0})
        raise exc

    monkeypatch.setattr(agent_detail_module, "get_project_metrics_cached", fake)
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/projects/p1/metrics"


def test_other_version_entry_covers_whole_window_when_all_untagged(monkeypatch):
    """Scenario 3: the version-breakdown query returns no series at all
    (every trace untagged) -> version_cost_series contains exactly one
    "其他／未標記版本" entry, covering the full 7-day window with the
    no-breakdown total query's own values/dates (not derived from the
    now-empty version series)."""
    _patch_metrics(
        monkeypatch,
        version_map=_version_series_map({}),
        model_map=_model_series_map({}),
        total_map=_version_series_map(
            {"total": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]}
        ),
    )
    _patch_traces(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/cost-breakdown")
    assert resp.status_code == 200
    body = resp.json()
    series = body["version_cost_series"]
    assert len(series) == 1
    other = series[0]
    assert other["version"] == "其他／未標記版本"
    assert other["points"] == [
        {"date": f"2026-10-{9 + i:02d}", "value": pytest.approx(float(i + 1))}
        for i in range(7)
    ]
