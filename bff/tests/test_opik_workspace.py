"""Tests for the read-only Opik workspace/project summary client
(SDLCCT-15): opik_workspace.py's get_workspace_daily_costs() and
get_project_stats().

Scope: bff/opik_workspace.py only. All httpx calls are mocked -- there is
no live Opik backend in this environment (see docs/design/SDLCCT-15.md).
Covers all 10 Gherkin acceptance criteria listed in the design doc's
AC-mapping table (5 per endpoint).
"""

from datetime import UTC, datetime

import httpx
import pytest

import opik_metrics
import opik_workspace
from opik_metrics import BASE_URL_ENV_VAR, WORKSPACE_ENV_VAR, invalidate_project_ids_cache
from opik_workspace import (
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    get_project_stats,
    get_workspace_daily_costs,
)

START = datetime(2026, 10, 1, tzinfo=UTC)
END = datetime(2026, 10, 15, tzinfo=UTC)

# Default name->id listing used by FakeClient.get() when a test doesn't
# supply its own "/v1/private/projects" response: identity mapping so that
# existing tests written against raw "p1"/"p2"/"unrequested"/"other-a"/
# "other-b" strings keep working unchanged (the resolved id happens to
# equal the name).
DEFAULT_PROJECT_LISTING = {
    "content": [
        {"name": "p1", "id": "p1"},
        {"name": "p2", "id": "p2"},
        {"name": "unrequested", "id": "unrequested"},
        {"name": "other-a", "id": "other-a"},
        {"name": "other-b", "id": "other-b"},
    ]
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class FakeClient:
    """Stands in for opik_workspace._client()'s httpx.Client, recording the
    requests made and returning scripted responses/exceptions per endpoint."""

    def __init__(self, responses=None, raise_for=None):
        self.responses = responses or {}
        self.raise_for = raise_for or {}
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, endpoint, json):
        self.calls.append((endpoint, "POST", json))
        if endpoint in self.raise_for:
            raise self.raise_for[endpoint]
        return self.responses.get(endpoint, FakeResponse())

    def get(self, endpoint, params):
        self.calls.append((endpoint, "GET", params))
        if endpoint in self.raise_for:
            raise self.raise_for[endpoint]
        if endpoint == "/v1/private/projects":
            return self.responses.get(endpoint, FakeResponse(payload=DEFAULT_PROJECT_LISTING))
        return self.responses.get(endpoint, FakeResponse())


@pytest.fixture(autouse=True)
def opik_base_url(monkeypatch):
    monkeypatch.setenv(BASE_URL_ENV_VAR, "https://opik.example.com/api")
    monkeypatch.delenv(WORKSPACE_ENV_VAR, raising=False)
    invalidate_project_ids_cache()
    yield
    invalidate_project_ids_cache()


# --- /v1/private/workspaces/costs ------------------------------------------


def test_workspace_costs_empty_project_ids_raises_before_any_http_call(monkeypatch):
    """AC 1: no explicit project id(s) -> reject, no HTTP request sent."""
    fake = FakeClient()
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_workspace_daily_costs([], interval_start=START, interval_end=END)

    assert fake.calls == []


def test_workspace_costs_successful_fetch_scoped_to_backend_response(monkeypatch):
    """AC 2: explicit project ids -> successful daily-cost fetch; result
    keys are exactly what the backend returned (no client-side filtering)."""
    payload = {
        "results": [
            {
                "project_id": "p1",
                "data": [{"time": "2026-10-01T00:00:00Z", "value": 1.5}],
            },
            {
                "project_id": "p2",
                "data": [{"time": "2026-10-01T00:00:00Z", "value": None}],
            },
        ]
    }
    fake = FakeClient(responses={"/v1/private/workspaces/costs": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_workspace_daily_costs(["p1", "p2"], interval_start=START, interval_end=END)

    assert set(result.keys()) == {"p1", "p2"}
    assert result["p1"][0].value == 1.5
    assert result["p2"][0].value is None  # never coerced to 0.0

    endpoint, method, body = [c for c in fake.calls if c[0] != "/v1/private/projects"][0]
    assert endpoint == "/v1/private/workspaces/costs"
    assert method == "POST"
    assert body["project_ids"] == ["p1", "p2"]


def test_workspace_costs_http_error_raises_opik_http_error(monkeypatch):
    """AC 3 (http): non-2xx response is an explicit error, never 0/empty."""
    fake = FakeClient(responses={"/v1/private/workspaces/costs": FakeResponse(status_code=500)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_workspace_daily_costs(["p1"], interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/workspaces/costs"
    assert exc_info.value.status_code == 500


def test_workspace_costs_transport_error_raises_opik_http_error(monkeypatch):
    """AC 3 (transport-level error, e.g. connection failure): explicit
    OpikHTTPError, never a silent empty/0 result."""
    fake = FakeClient(raise_for={"/v1/private/workspaces/costs": httpx.ConnectError("boom")})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_workspace_daily_costs(["p1"], interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/workspaces/costs"


def test_workspace_costs_timeout_raises_opik_timeout_error(monkeypatch):
    """AC 3 (timeout): explicit error with status_code=None, never silent."""
    fake = FakeClient(raise_for={"/v1/private/workspaces/costs": httpx.TimeoutException("timed out")})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError) as exc_info:
        get_workspace_daily_costs(["p1"], interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/workspaces/costs"
    assert exc_info.value.status_code is None


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},  # missing "results"
        {"results": [{"project_id": "p1", "data": "not-a-list"}]},
        {"results": [{"project_id": "p1", "data": [{"time": "not-a-date", "value": 1.0}]}]},
    ],
)
def test_workspace_costs_malformed_response_raises_opik_response_format_error(monkeypatch, bad_payload):
    """AC 3 (malformed): unexpected shape is an explicit error, never 0/empty."""
    fake = FakeClient(responses={"/v1/private/workspaces/costs": FakeResponse(payload=bad_payload)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError) as exc_info:
        get_workspace_daily_costs(["p1"], interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/workspaces/costs"
    assert exc_info.value.status_code == 200


def test_workspace_costs_comet_workspace_header_default():
    """AC 4: Comet-Workspace header always present, default value."""
    with opik_workspace._client() as c:
        assert c.headers["Comet-Workspace"] == "default"


def test_workspace_costs_comet_workspace_header_override(monkeypatch):
    """AC 4: Comet-Workspace header reflects an overridden workspace env var."""
    monkeypatch.setenv(WORKSPACE_ENV_VAR, "my-workspace")
    with opik_workspace._client() as c:
        assert c.headers["Comet-Workspace"] == "my-workspace"


def test_workspace_costs_interval_params_use_caller_supplied_anchor_window(monkeypatch):
    """AC 5: interval_start/interval_end are required caller-supplied values
    (anchor-date style), never derived from the system clock."""
    fake = FakeClient(responses={"/v1/private/workspaces/costs": FakeResponse(payload={"results": []})})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_workspace_daily_costs(["p1"], interval_start=START, interval_end=END)

    _, _, body = [c for c in fake.calls if c[0] != "/v1/private/projects"][0]
    assert body["interval_start"] == "2026-10-01T00:00:00.000Z"
    assert body["interval_end"] == "2026-10-15T00:00:00.000Z"


# --- /v1/private/projects/stats --------------------------------------------


def test_project_stats_empty_project_ids_raises_before_any_http_call(monkeypatch):
    """AC 1: no explicit project id(s) -> reject, no HTTP request sent."""
    fake = FakeClient()
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_project_stats([], from_time=START, to_time=END)

    assert fake.calls == []


def test_project_stats_successful_fetch_filtered_to_requested_ids(monkeypatch):
    """AC 2: explicit project ids -> only those projects' stats returned,
    other projects in the page never leak into the result."""
    payload = {
        "content": [
            {"project_id": "p1", "total_estimated_cost_sum": 3.5},
            {"project_id": "p2", "total_estimated_cost_sum": 7.0},
            {"project_id": "unrequested", "total_estimated_cost_sum": 99.0},
        ]
    }
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_stats(["p1", "p2"], from_time=START, to_time=END)

    assert set(result.keys()) == {"p1", "p2"}
    assert result["p1"].total_estimated_cost_sum == 3.5
    assert result["p2"].total_estimated_cost_sum == 7.0


def test_project_stats_client_side_filtering_drops_unrequested_projects(monkeypatch):
    """AC 2 (explicit): a page containing extra, unrequested projects must
    not leak them into the result -- the backend has no project-id filter."""
    payload = {
        "content": [
            {"project_id": "p1", "total_estimated_cost_sum": 1.0},
            {"project_id": "other-a", "total_estimated_cost_sum": 2.0},
            {"project_id": "other-b", "total_estimated_cost_sum": 3.0},
        ]
    }
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_stats(["p1"], from_time=START, to_time=END)

    assert set(result.keys()) == {"p1"}
    assert "other-a" not in result
    assert "other-b" not in result


def test_project_stats_http_error_raises_opik_http_error(monkeypatch):
    """AC 3 (http): non-2xx response is an explicit error."""
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(status_code=503)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_project_stats(["p1"], from_time=START, to_time=END)

    assert exc_info.value.endpoint == "/v1/private/projects/stats"
    assert exc_info.value.status_code == 503


def test_project_stats_transport_error_raises_opik_http_error(monkeypatch):
    """AC 3 (transport-level error, e.g. connection failure): explicit
    OpikHTTPError, never a silent empty/0 result."""
    fake = FakeClient(raise_for={"/v1/private/projects/stats": httpx.ConnectError("boom")})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_project_stats(["p1"], from_time=START, to_time=END)

    assert exc_info.value.endpoint == "/v1/private/projects/stats"


def test_project_stats_timeout_raises_opik_timeout_error(monkeypatch):
    """AC 3 (timeout): explicit error with status_code=None."""
    fake = FakeClient(raise_for={"/v1/private/projects/stats": httpx.TimeoutException("timed out")})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError) as exc_info:
        get_project_stats(["p1"], from_time=START, to_time=END)

    assert exc_info.value.endpoint == "/v1/private/projects/stats"
    assert exc_info.value.status_code is None


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},  # missing "content"
        {"content": [{"total_estimated_cost_sum": 1.0}]},  # missing project_id
        {"content": "not-a-list"},
    ],
)
def test_project_stats_malformed_response_raises_opik_response_format_error(monkeypatch, bad_payload):
    """AC 3 (malformed): unexpected shape is an explicit error."""
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(payload=bad_payload)})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError) as exc_info:
        get_project_stats(["p1"], from_time=START, to_time=END)

    assert exc_info.value.endpoint == "/v1/private/projects/stats"
    assert exc_info.value.status_code == 200


def test_project_stats_comet_workspace_header_default():
    """AC 4: Comet-Workspace header always present, default value."""
    with opik_workspace._client() as c:
        assert c.headers["Comet-Workspace"] == "default"


def test_project_stats_comet_workspace_header_override(monkeypatch):
    """AC 4: Comet-Workspace header reflects an overridden workspace env var."""
    monkeypatch.setenv(WORKSPACE_ENV_VAR, "another-workspace")
    with opik_workspace._client() as c:
        assert c.headers["Comet-Workspace"] == "another-workspace"


def test_project_stats_time_window_params_use_caller_supplied_anchor_window_and_default_page_size(monkeypatch):
    """AC 5: from_time/to_time are required caller-supplied values (anchor-
    date style), never derived from the system clock; single page,
    page_size=100 by default, no pagination loop."""
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(payload={"content": []})})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_project_stats(["p1"], from_time=START, to_time=END)

    stats_calls = [c for c in fake.calls if c[0] == "/v1/private/projects/stats"]
    assert len(stats_calls) == 1  # single page, no pagination loop
    endpoint, method, params = stats_calls[0]
    assert endpoint == "/v1/private/projects/stats"
    assert method == "GET"
    assert params["size"] == opik_workspace.DEFAULT_PROJECTS_STATS_PAGE_SIZE
    assert params["from_time"] == "2026-10-01T00:00:00.000Z"
    assert params["to_time"] == "2026-10-15T00:00:00.000Z"


def test_project_stats_page_size_override(monkeypatch):
    """page_size is overridable by the caller, still a single request."""
    fake = FakeClient(responses={"/v1/private/projects/stats": FakeResponse(payload={"content": []})})
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_project_stats(["p1"], from_time=START, to_time=END, page_size=50)

    stats_calls = [c for c in fake.calls if c[0] == "/v1/private/projects/stats"]
    assert len(stats_calls) == 1
    _, _, params = stats_calls[0]
    assert params["size"] == 50


# --- SDLCCT-63: registry key must be resolved to a real Opik project id ---


def test_workspace_costs_registry_key_resolved_to_real_id_in_request_body(monkeypatch):
    """Bug SDLCCT-63: body's project_ids must be the real Opik project
    UUID(s), never the raw registry key string; the returned dict's keys
    stay the original registry key(s)."""
    real_uuid = "11111111-2222-3333-4444-555555555555"
    fake = FakeClient(
        responses={
            "/v1/private/projects": FakeResponse(
                payload={"content": [{"name": "maintenance_copilot", "id": real_uuid}]}
            ),
            "/v1/private/workspaces/costs": FakeResponse(
                payload={"results": [{"project_id": real_uuid, "data": []}]}
            ),
        }
    )
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_workspace_daily_costs(["maintenance_copilot"], interval_start=START, interval_end=END)

    post_calls = [c for c in fake.calls if c[1] == "POST"]
    assert post_calls[0][2]["project_ids"] == [real_uuid]
    assert set(result.keys()) == {"maintenance_copilot"}


def test_workspace_costs_unmapped_response_project_id_raises_format_error(monkeypatch):
    """A project_id in the response that isn't among the resolved,
    requested ids is a backend/response mismatch, not silently dropped
    or silently kept under a wrong key."""
    real_uuid = "11111111-2222-3333-4444-555555555555"
    fake = FakeClient(
        responses={
            "/v1/private/projects": FakeResponse(
                payload={"content": [{"name": "maintenance_copilot", "id": real_uuid}]}
            ),
            "/v1/private/workspaces/costs": FakeResponse(
                payload={"results": [{"project_id": "some-other-id", "data": []}]}
            ),
        }
    )
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError):
        get_workspace_daily_costs(["maintenance_copilot"], interval_start=START, interval_end=END)


def test_project_stats_registry_key_resolved_to_real_id_for_filtering(monkeypatch):
    """Bug SDLCCT-63: client-side filtering must compare against the
    resolved real Opik project id, not the raw registry key; the returned
    dict's keys stay the original registry key(s)."""
    real_uuid = "11111111-2222-3333-4444-555555555555"
    fake = FakeClient(
        responses={
            "/v1/private/projects": FakeResponse(
                payload={"content": [{"name": "maintenance_copilot", "id": real_uuid}]}
            ),
            "/v1/private/projects/stats": FakeResponse(
                payload={
                    "content": [
                        {"project_id": real_uuid, "total_estimated_cost_sum": 4.2},
                        {"project_id": "unrelated-id", "total_estimated_cost_sum": 99.0},
                    ]
                }
            ),
        }
    )
    monkeypatch.setattr(opik_workspace, "_client", lambda: fake)
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_stats(["maintenance_copilot"], from_time=START, to_time=END)

    assert set(result.keys()) == {"maintenance_copilot"}
    assert result["maintenance_copilot"].total_estimated_cost_sum == 4.2
