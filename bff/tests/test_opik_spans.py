"""Tests for the read-only Opik spans client and trace tree assembly
(SDLCCT-53): opik_spans.py's get_trace_spans() and build_span_tree().

Scope: bff/opik_spans.py only. All httpx calls are mocked -- there is no
live Opik backend in this environment, same convention as
bff/tests/test_opik_traces.py (monkeypatched _client(), FakeClient /
FakeResponse recording calls and returning scripted responses/exceptions).

AC numbering follows the 7 Gherkin scenarios in the G1-approved spec:
AC1 project_name missing -> no request, MissingProjectIdsError
AC2 trace_id missing -> no request, MissingProjectIdsError
AC3 normal call -> immutable flat sequence, raw escape hatch preserved
AC4 non-2xx -> OpikHTTPError (endpoint + status_code), never empty tuple
AC5 timeout / malformed response -> OpikTimeoutError / OpikResponseFormatError
AC6 flat span list -> tree, child order == input order
AC7 orphan span -> extra top-level node, not silently dropped
"""

import httpx
import pytest

import opik_spans
from opik_metrics import BASE_URL_ENV_VAR, WORKSPACE_ENV_VAR
from opik_spans import (
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    build_span_tree,
    get_trace_spans,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class FakeClient:
    """Stands in for opik_spans._client()'s httpx.Client, recording the
    requests made and returning scripted responses/exceptions per endpoint."""

    def __init__(self, responses=None, raise_for=None):
        self.responses = responses or {}
        self.raise_for = raise_for or {}
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, endpoint, params):
        self.calls.append((endpoint, "GET", params))
        if endpoint in self.raise_for:
            raise self.raise_for[endpoint]
        return self.responses.get(endpoint, FakeResponse())


@pytest.fixture(autouse=True)
def opik_base_url(monkeypatch):
    monkeypatch.setenv(BASE_URL_ENV_VAR, "https://opik.example.com/api")
    monkeypatch.delenv(WORKSPACE_ENV_VAR, raising=False)


def _span(span_id, parent_span_id=None, **extra):
    """Build one fake /spans "content" entry; extra fields land in raw."""
    item = {"id": span_id, "parent_span_id": parent_span_id}
    item.update(extra)
    return item


# --- AC1: project_name missing -> no HTTP call, MissingProjectIdsError ----


def test_get_trace_spans_empty_project_name_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_trace_spans("", "trace-1")

    assert fake.calls == []


def test_get_trace_spans_none_project_name_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_trace_spans(None, "trace-1")

    assert fake.calls == []


# --- AC2: trace_id missing -> no HTTP call, MissingProjectIdsError --------


def test_get_trace_spans_empty_trace_id_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_trace_spans("quality_rca", "")

    assert fake.calls == []


def test_get_trace_spans_none_trace_id_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_trace_spans("quality_rca", None)

    assert fake.calls == []


# --- AC3: normal call -> immutable flat sequence, raw escape hatch --------


def test_get_trace_spans_returns_immutable_sequence_preserving_raw(monkeypatch):
    # 91 fake spans to mirror seed/verify.py's live-backend count for the
    # demo loop trace; a chain of parent -> child relations plus one root.
    n = 91
    items = [_span("span-0", parent_span_id=None, name="root", duration_ms=12.5)]
    for i in range(1, n):
        items.append(
            _span(f"span-{i}", parent_span_id=f"span-{i - 1}", name=f"step-{i}", duration_ms=1.0 * i)
        )
    payload = {"content": items}
    fake = FakeClient(responses={"/v1/private/spans": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    result = get_trace_spans("quality_rca", "trace-loop-1", size=200)

    assert len(result) == 91
    assert isinstance(result, tuple)  # immutable sequence
    with pytest.raises((TypeError, AttributeError)):
        result[0].id = "mutated"  # frozen dataclass -> cannot be reassigned

    assert result[0].id == "span-0"
    assert result[0].parent_span_id is None
    assert result[1].id == "span-1"
    assert result[1].parent_span_id == "span-0"
    # raw escape hatch keeps the full original entry, not just id/parent_span_id
    assert result[1].raw == items[1]
    assert result[1].raw["name"] == "step-1"

    endpoint, method, params = fake.calls[0]
    assert endpoint == "/v1/private/spans"
    assert method == "GET"
    assert params["project_name"] == "quality_rca"
    assert params["trace_id"] == "trace-loop-1"
    assert params["size"] == 200


# --- AC4: non-2xx -> OpikHTTPError, never an empty tuple ------------------


def test_get_trace_spans_non_2xx_raises_opik_http_error(monkeypatch):
    fake = FakeClient(responses={"/v1/private/spans": FakeResponse(status_code=500)})
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_trace_spans("quality_rca", "trace-1")

    assert exc_info.value.endpoint == "/v1/private/spans"
    assert exc_info.value.status_code == 500


def test_get_trace_spans_transport_error_raises_opik_http_error(monkeypatch):
    fake = FakeClient(raise_for={"/v1/private/spans": httpx.ConnectError("boom")})
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_trace_spans("quality_rca", "trace-1")

    assert exc_info.value.endpoint == "/v1/private/spans"


# --- AC5: timeout / malformed response -> typed errors, never swallowed --


def test_get_trace_spans_timeout_raises_opik_timeout_error(monkeypatch):
    fake = FakeClient(raise_for={"/v1/private/spans": httpx.TimeoutException("timed out")})
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError) as exc_info:
        get_trace_spans("quality_rca", "trace-1")

    assert exc_info.value.endpoint == "/v1/private/spans"
    assert exc_info.value.status_code is None


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},  # missing "content"
        {"content": "not-a-list"},
        {"content": [{"parent_span_id": None}]},  # missing "id"
    ],
)
def test_get_trace_spans_malformed_response_raises_opik_response_format_error(monkeypatch, bad_payload):
    fake = FakeClient(responses={"/v1/private/spans": FakeResponse(payload=bad_payload)})
    monkeypatch.setattr(opik_spans, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError) as exc_info:
        get_trace_spans("quality_rca", "trace-1")

    assert exc_info.value.endpoint == "/v1/private/spans"
    assert exc_info.value.status_code == 200


# --- AC6: flat span list -> tree, child order == input order -------------


def test_build_span_tree_assembles_single_root_tree_preserving_child_order(monkeypatch):
    spans = [
        opik_spans.SpanSummary(id="root", parent_span_id=None, raw={"id": "root"}),
        opik_spans.SpanSummary(id="child-b", parent_span_id="root", raw={"id": "child-b"}),
        opik_spans.SpanSummary(id="child-a", parent_span_id="root", raw={"id": "child-a"}),
        opik_spans.SpanSummary(id="grandchild", parent_span_id="child-b", raw={"id": "grandchild"}),
    ]

    tree = build_span_tree(spans)

    assert len(tree) == 1
    root_node = tree[0]
    assert root_node.span.id == "root"
    # children ordered by first appearance in the input list: child-b before child-a
    assert [c.span.id for c in root_node.children] == ["child-b", "child-a"]
    child_b_node = root_node.children[0]
    assert [c.span.id for c in child_b_node.children] == ["grandchild"]
    child_a_node = root_node.children[1]
    assert child_a_node.children == ()


def test_build_span_tree_empty_input_returns_empty_tuple():
    assert build_span_tree([]) == ()


# --- AC7: orphan span -> extra top-level node, not silently dropped ------


def test_build_span_tree_orphan_span_becomes_extra_top_level_node():
    spans = [
        opik_spans.SpanSummary(id="root", parent_span_id=None, raw={"id": "root"}),
        opik_spans.SpanSummary(id="child", parent_span_id="root", raw={"id": "child"}),
        # parent_span_id points to an id not present in this list (e.g.
        # truncated out by a size-capped get_trace_spans() call) -- must
        # not be silently dropped nor cause assembly to fail.
        opik_spans.SpanSummary(id="orphan", parent_span_id="missing-parent", raw={"id": "orphan"}),
    ]

    tree = build_span_tree(spans)

    assert len(tree) == 2  # root + orphan, same top level
    assert {node.span.id for node in tree} == {"root", "orphan"}
    orphan_node = next(n for n in tree if n.span.id == "orphan")
    assert orphan_node.children == ()
    root_node = next(n for n in tree if n.span.id == "root")
    assert [c.span.id for c in root_node.children] == ["child"]
