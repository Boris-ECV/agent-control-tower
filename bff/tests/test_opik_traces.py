"""Tests for the read-only Opik trace search client (SDLCCT-17):
opik_traces.py's get_top_traces_by_cost().

Scope: bff/opik_traces.py only. All httpx calls are mocked -- there is no
live Opik backend in this environment (see docs/design/SDLCCT-17.md).
Covers all 4 Gherkin acceptance criteria listed in the design doc's
AC-mapping table.
"""

import json

import httpx
import pytest

import opik_traces
from opik_metrics import BASE_URL_ENV_VAR, WORKSPACE_ENV_VAR
from opik_traces import (
    DEFAULT_TOP_TRACES_SIZE,
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    get_top_traces_by_cost,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class FakeClient:
    """Stands in for opik_traces._client()'s httpx.Client, recording the
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


# --- AC1: sorted trace list, id/metadata populated, sorting param correct --


def test_top_traces_returns_sorted_list_with_sorting_param_json_encoded(monkeypatch):
    payload = {
        "content": [
            {"id": "t1", "metadata": {"model": "gpt-4"}, "total_estimated_cost": 5.0},
            {"id": "t2", "metadata": None, "total_estimated_cost": 1.0},
        ]
    }
    fake = FakeClient(responses={"/v1/private/traces": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    result = get_top_traces_by_cost("proj-1")

    assert len(result) == 2
    assert result[0].id == "t1"
    assert result[0].metadata == {"model": "gpt-4"}
    assert result[1].id == "t2"
    assert result[1].metadata is None  # verified nullable field
    # trust backend order -- never re-sorted client-side
    assert [t.id for t in result] == ["t1", "t2"]

    endpoint, method, params = fake.calls[0]
    assert endpoint == "/v1/private/traces"
    assert method == "GET"
    assert params["project_name"] == "proj-1"
    assert params["size"] == DEFAULT_TOP_TRACES_SIZE
    assert json.loads(params["sorting"]) == [
        {"field": "total_estimated_cost", "direction": "DESC"}
    ]


def test_top_traces_size_override_single_request(monkeypatch):
    fake = FakeClient(responses={"/v1/private/traces": FakeResponse(payload={"content": []})})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    get_top_traces_by_cost("proj-1", size=50)

    assert len(fake.calls) == 1  # no pagination loop
    _, _, params = fake.calls[0]
    assert params["size"] == 50


# --- AC2: empty/missing project_name rejected before any HTTP call --------


def test_top_traces_empty_project_name_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_top_traces_by_cost("")

    assert fake.calls == []


def test_top_traces_none_project_name_raises_before_any_http_call(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_top_traces_by_cost(None)

    assert fake.calls == []


# --- AC3: typed errors, never an empty tuple -------------------------------


def test_top_traces_http_error_raises_opik_http_error(monkeypatch):
    fake = FakeClient(responses={"/v1/private/traces": FakeResponse(status_code=500)})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_top_traces_by_cost("proj-1")

    assert exc_info.value.endpoint == "/v1/private/traces"
    assert exc_info.value.status_code == 500


def test_top_traces_transport_error_raises_opik_http_error(monkeypatch):
    fake = FakeClient(raise_for={"/v1/private/traces": httpx.ConnectError("boom")})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_top_traces_by_cost("proj-1")

    assert exc_info.value.endpoint == "/v1/private/traces"


def test_top_traces_timeout_raises_opik_timeout_error(monkeypatch):
    fake = FakeClient(raise_for={"/v1/private/traces": httpx.TimeoutException("timed out")})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError) as exc_info:
        get_top_traces_by_cost("proj-1")

    assert exc_info.value.endpoint == "/v1/private/traces"
    assert exc_info.value.status_code is None


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},  # missing "content"
        {"content": "not-a-list"},
        {"content": [{"metadata": {}}]},  # missing "id"
    ],
)
def test_top_traces_malformed_response_raises_opik_response_format_error(monkeypatch, bad_payload):
    fake = FakeClient(responses={"/v1/private/traces": FakeResponse(payload=bad_payload)})
    monkeypatch.setattr(opik_traces, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError) as exc_info:
        get_top_traces_by_cost("proj-1")

    assert exc_info.value.endpoint == "/v1/private/traces"
    assert exc_info.value.status_code == 200


# --- AC4: Comet-Workspace header always present ----------------------------


def test_top_traces_comet_workspace_header_default():
    with opik_traces._client() as c:
        assert c.headers["Comet-Workspace"] == "default"


def test_top_traces_comet_workspace_header_override(monkeypatch):
    monkeypatch.setenv(WORKSPACE_ENV_VAR, "my-workspace")
    with opik_traces._client() as c:
        assert c.headers["Comet-Workspace"] == "my-workspace"
