"""Tests for the Trace spans endpoint (SDLCCT-55): api/app.py +
api/trace_spans.py.

Scope: HTTP contract (200 tree shape, 404 unknown key w/ no Opik call,
200 empty tree for no-data, 502 error mapping, duplicate-sibling-name
preservation). opik_spans.get_trace_spans is monkeypatched on the
api.trace_spans module (same convention as bff/tests/test_api_agent_detail.py
-- the name the business-logic module imports is what must be patched).
registry.get_agent() is backed by the real seed/catalog.AGENTS data.
"""

import pytest
from fastapi.testclient import TestClient

import api.trace_spans as trace_spans_module
from api.app import app
from opik_metrics import (
    OpikConfigError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
)
from opik_spans import SpanSummary

client = TestClient(app)

AGENT_KEY = "maintenance_copilot"
TRACE_ID = "trace-123"


def _span(id_, parent_span_id, *, name=None, type_=None, start=None, end=None):
    raw = {
        "id": id_,
        "parent_span_id": parent_span_id,
        "name": name,
        "type": type_,
        "start_time": start,
        "end_time": end,
    }
    return SpanSummary(id=id_, parent_span_id=parent_span_id, raw=raw)


def _patch_spans(monkeypatch, spans, *, capture=None):
    def fake(project_name, trace_id, **kw):
        if capture is not None:
            capture["project_name"] = project_name
            capture["trace_id"] = trace_id
        return spans

    monkeypatch.setattr(trace_spans_module, "get_trace_spans", fake)


# -- Scenario 1: valid key + trace_id, 1+ spans -> 200 tree -------------------


def test_valid_key_and_trace_returns_200_tree_with_nested_children(monkeypatch):
    spans = (
        _span("root", None, name="agent-run", type_="llm", start="t0", end="t9"),
        _span("child1", "root", name="tool-call", type_="tool", start="t1", end="t2"),
    )
    capture = {}
    _patch_spans(monkeypatch, spans, capture=capture)

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 200
    body = resp.json()

    assert body["key"] == AGENT_KEY
    assert body["trace_id"] == TRACE_ID
    assert len(body["spans"]) == 1
    root = body["spans"][0]
    assert root["id"] == "root"
    assert root["parent_span_id"] is None
    assert root["name"] == "agent-run"
    assert root["type"] == "llm"
    assert root["start_time"] == "t0"
    assert root["end_time"] == "t9"

    assert len(root["children"]) == 1
    child = root["children"][0]
    assert child["id"] == "child1"
    assert child["parent_span_id"] == "root"
    assert child["name"] == "tool-call"
    assert child["type"] == "tool"
    assert child["start_time"] == "t1"
    assert child["end_time"] == "t2"
    assert child["children"] == []

    assert capture["project_name"] == AGENT_KEY
    assert capture["trace_id"] == TRACE_ID


# -- Scenario 2: key not in registry -> 404, no Opik call ---------------------


def test_unknown_agent_key_returns_404_with_existing_message_convention(monkeypatch):
    calls = {"spans": 0}

    def fake(*a, **kw):
        calls["spans"] += 1
        raise AssertionError("should not be called for an unknown key")

    monkeypatch.setattr(trace_spans_module, "get_trace_spans", fake)

    resp = client.get(f"/api/agents/not-a-real-agent/traces/{TRACE_ID}/spans")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Agent 'not-a-real-agent' not found"}
    assert calls["spans"] == 0


# -- Scenario 3: trace_id has no spans -> 200 empty tree, not 404/502 --------


def test_trace_with_no_spans_returns_200_empty_tree(monkeypatch):
    _patch_spans(monkeypatch, ())

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == AGENT_KEY
    assert body["trace_id"] == TRACE_ID
    assert body["spans"] == []


# -- Scenario 4: underlying Opik query failure -> 502, existing handler shape -


@pytest.mark.parametrize(
    "exc",
    [
        OpikHTTPError("non-2xx response", endpoint="/v1/private/spans", status_code=503),
        OpikTimeoutError("request timed out", endpoint="/v1/private/spans"),
        OpikResponseFormatError(
            "unexpected response shape", endpoint="/v1/private/spans", status_code=200
        ),
    ],
)
def test_spans_query_failure_maps_to_502(monkeypatch, exc):
    def raiser(*a, **kw):
        raise exc

    monkeypatch.setattr(trace_spans_module, "get_trace_spans", raiser)

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["message"] == str(exc)
    assert body["error"]["endpoint"] == "/v1/private/spans"


def test_opik_config_error_maps_to_502(monkeypatch):
    def raiser(*a, **kw):
        raise OpikConfigError("OPIK_BASE_URL is not set")

    monkeypatch.setattr(trace_spans_module, "get_trace_spans", raiser)

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 502
    body = resp.json()
    assert "OPIK_BASE_URL" in body["error"]["message"]
    assert body["error"]["endpoint"] is None


# -- Scenario 5: duplicate same-name siblings preserved, no dedup ------------


def test_duplicate_sibling_spans_preserve_order_and_full_data(monkeypatch):
    spans = [_span("root", None, name="agent-run", type_="llm")]
    for i in range(45):
        spans.append(
            _span(f"tool-call-{i}", "root", name="search_tool", type_="tool", start=f"t{i}")
        )
    _patch_spans(monkeypatch, tuple(spans))

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 200
    body = resp.json()

    children = body["spans"][0]["children"]
    assert len(children) == 45
    assert all(c["name"] == "search_tool" for c in children)
    # order preserved (same as input order) and ids/start_time distinct --
    # not collapsed/deduped into a single representative node
    assert [c["id"] for c in children] == [f"tool-call-{i}" for i in range(45)]
    assert [c["start_time"] for c in children] == [f"t{i}" for i in range(45)]


# -- Edge case: orphan span (parent not in result set) passes through --------


def test_orphan_span_appears_as_top_level_node_not_dropped(monkeypatch):
    spans = (
        _span("root", None, name="agent-run", type_="llm"),
        _span("orphan", "missing-parent", name="dangling-tool", type_="tool"),
    )
    _patch_spans(monkeypatch, spans)

    resp = client.get(f"/api/agents/{AGENT_KEY}/traces/{TRACE_ID}/spans")
    assert resp.status_code == 200
    body = resp.json()

    top_level_ids = {node["id"] for node in body["spans"]}
    assert top_level_ids == {"root", "orphan"}
