"""Tests for the read-only Opik project-metrics client (SDLCCT-10).

Scope: bff/opik_metrics.py only. All httpx calls are mocked -- there is no
live Opik backend in this environment (see docs/design/SDLCCT-10.md).
Covers all 11 Gherkin acceptance criteria listed in the design doc's
AC-mapping table.
"""

from datetime import UTC, datetime

import httpx
import pytest

import opik_metrics
from opik_metrics import (
    BASE_URL_ENV_VAR,
    WORKSPACE_ENV_VAR,
    Breakdown,
    BreakdownField,
    Interval,
    MetricType,
    MissingProjectIdsError,
    OpikConfigError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    UnknownProjectKeyError,
    base_url,
    get_project_metrics,
    invalidate_project_ids_cache,
)

START = datetime(2026, 10, 1, tzinfo=UTC)
END = datetime(2026, 10, 15, tzinfo=UTC)

# Default name->id listing used by FakeClient.get() when a test doesn't
# supply its own "/v1/private/projects" response: identity mapping so that
# existing tests written against raw "p1"/"p2" strings keep working
# unchanged (the resolved id happens to equal the name).
DEFAULT_PROJECT_LISTING = {
    "content": [
        {"name": "p1", "id": "p1"},
        {"name": "p2", "id": "p2"},
    ]
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"results": []}

    def json(self):
        return self._payload


class FakeClient:
    """Stands in for opik_metrics._client()'s httpx.Client, recording the
    requests made and returning scripted responses/exceptions per endpoint."""

    def __init__(self, responses=None, raise_for=None, headers=None):
        self.responses = responses or {}
        self.raise_for = raise_for or {}
        self.calls = []
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, endpoint, json):
        self.calls.append((endpoint, json))
        if endpoint in self.raise_for:
            raise self.raise_for[endpoint]
        return self.responses.get(endpoint, FakeResponse())

    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
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


def test_empty_project_ids_raises_missing_project_ids_error(monkeypatch):
    """AC: explicit project id(s) required -- empty list never means "query all"."""
    fake = FakeClient()
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(MissingProjectIdsError):
        get_project_metrics([], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    assert fake.calls == []  # no backend call attempted


@pytest.mark.parametrize(
    "metric_type",
    [
        MetricType.COST,
        MetricType.TRACE_COUNT,
        MetricType.TRACE_ERROR_RATE,
        MetricType.SPAN_COUNT,
        MetricType.SPAN_TOKEN_USAGE,
    ],
)
def test_all_five_metric_types_sent_in_request_body(monkeypatch, metric_type):
    """AC: 5 metric types supported, each sent verbatim as metric_type."""
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(payload={"results": []})})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_project_metrics(["p1"], metric_type, interval=Interval.DAILY, interval_start=START, interval_end=END)

    endpoint, body = [c for c in fake.calls if c[0] != "/v1/private/projects"][0]
    assert endpoint == "/v1/private/projects/p1/metrics"
    assert body["metric_type"] == metric_type.value


@pytest.mark.parametrize(
    "breakdown,expected",
    [
        (Breakdown(field=BreakdownField.METADATA, metadata_key="model"), {"field": "metadata", "metadata_key": "model"}),
        (Breakdown(field=BreakdownField.TAGS), {"field": "tags"}),
        (Breakdown(field=BreakdownField.NAME), {"field": "name"}),
    ],
)
def test_breakdown_field_included_in_request_body(monkeypatch, breakdown, expected):
    """AC: breakdown by metadata key / tags / name."""
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(payload={"results": []})})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_project_metrics(
        ["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END, breakdown=breakdown
    )

    _, body = [c for c in fake.calls if c[0] != "/v1/private/projects"][0]
    assert body["breakdown"] == expected


def test_metadata_breakdown_without_key_raises_value_error():
    """AC: metadata breakdown must carry metadata_key."""
    with pytest.raises(ValueError):
        Breakdown(field=BreakdownField.METADATA)


def test_http_error_status_raises_opik_http_error_with_endpoint_and_status(monkeypatch):
    """AC: non-2xx response is an explicit error, never a silent empty/0 result."""
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(status_code=500)})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/projects/p1/metrics"
    assert exc_info.value.status_code == 500


def test_transport_http_error_raises_opik_http_error(monkeypatch):
    """AC: a transport-level HTTP failure (e.g. connection error) is explicit, not silent."""
    fake = FakeClient(raise_for={"/v1/private/projects/p1/metrics": httpx.ConnectError("boom")})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikHTTPError) as exc_info:
        get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/projects/p1/metrics"


def test_timeout_raises_opik_timeout_error_with_no_status_code(monkeypatch):
    """AC: timeout is an explicit error with status_code=None (never a silent empty result)."""
    fake = FakeClient(raise_for={"/v1/private/projects/p1/metrics": httpx.TimeoutException("timed out")})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError) as exc_info:
        get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/projects/p1/metrics"
    assert exc_info.value.status_code is None


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},  # missing "results"
        {"results": [{"name": "p1", "data": "not-a-list"}]},
        {"results": [{"name": "p1", "data": [{"time": "not-a-date", "value": 1.0}]}]},
    ],
)
def test_unexpected_response_shape_raises_opik_response_format_error(monkeypatch, bad_payload):
    """AC: unexpected backend response shape is an explicit error, never a silent empty result."""
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(payload=bad_payload)})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikResponseFormatError) as exc_info:
        get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    assert exc_info.value.endpoint == "/v1/private/projects/p1/metrics"
    assert exc_info.value.status_code == 200


def test_one_project_failing_raises_immediately_without_partial_results(monkeypatch):
    """AC: never silently return 0/empty -- a failure for one of several
    project ids raises immediately instead of returning partial results."""
    fake = FakeClient(
        responses={"/v1/private/projects/p1/metrics": FakeResponse(payload={"results": []})},
        raise_for={"/v1/private/projects/p2/metrics": httpx.TimeoutException("timed out")},
    )
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(OpikTimeoutError):
        get_project_metrics(
            ["p1", "p2"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END
        )


def test_comet_workspace_header_defaults_to_default(monkeypatch):
    """AC: Comet-Workspace header sent, default value "default"."""
    monkeypatch.delenv(WORKSPACE_ENV_VAR, raising=False)

    with opik_metrics._client() as c:
        assert c.headers["comet-workspace"] == "default"


def test_comet_workspace_header_overridable_via_env_var(monkeypatch):
    """AC: OPIK_WORKSPACE overrides the default Comet-Workspace header."""
    monkeypatch.setenv(WORKSPACE_ENV_VAR, "my-workspace")

    with opik_metrics._client() as c:
        assert c.headers["comet-workspace"] == "my-workspace"


def test_interval_start_and_end_are_required_and_sent_as_iso(monkeypatch):
    """AC: time window uses explicit caller-supplied bounds (anchor date), not the system clock."""
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(payload={"results": []})})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    _, body = [c for c in fake.calls if c[0] != "/v1/private/projects"][0]
    assert body["interval_start"] == "2026-10-01T00:00:00.000Z"
    assert body["interval_end"] == "2026-10-15T00:00:00.000Z"


def test_get_project_metrics_requires_interval_start_and_end_arguments():
    """AC: no default time window -- missing interval bounds is a TypeError, not a guessed window."""
    with pytest.raises(TypeError):
        get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY)


def test_null_cost_value_preserved_as_none_not_coerced_to_zero(monkeypatch):
    """AC: missing cost data stays distinguishable "unknown" (None), never coerced to 0."""
    payload = {
        "results": [
            {
                "name": "p1",
                "data": [
                    {"time": "2026-10-01T00:00:00.000Z", "value": 1.5},
                    {"time": "2026-10-02T00:00:00.000Z", "value": None},
                ],
            }
        ]
    }
    fake = FakeClient(responses={"/v1/private/projects/p1/metrics": FakeResponse(payload=payload)})
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_metrics(["p1"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END)

    points = result["p1"][0].points
    assert points[0].value == 1.5
    assert points[1].value is None


def test_missing_base_url_raises_opik_config_error(monkeypatch):
    """AC: OPIK_BASE_URL required, no default."""
    monkeypatch.delenv(BASE_URL_ENV_VAR, raising=False)

    with pytest.raises(OpikConfigError):
        base_url()


def test_blank_base_url_raises_opik_config_error(monkeypatch):
    """AC: OPIK_BASE_URL set to whitespace only is treated as unset."""
    monkeypatch.setenv(BASE_URL_ENV_VAR, "   ")

    with pytest.raises(OpikConfigError):
        base_url()


def test_multiple_project_ids_each_queried_and_keyed_by_project_id(monkeypatch):
    """AC: explicit multi-project semantics -- client loops per id, keyed by project_id."""
    fake = FakeClient(
        responses={
            "/v1/private/projects/p1/metrics": FakeResponse(payload={"results": []}),
            "/v1/private/projects/p2/metrics": FakeResponse(payload={"results": []}),
        }
    )
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_metrics(
        ["p1", "p2"], MetricType.COST, interval=Interval.DAILY, interval_start=START, interval_end=END
    )

    assert set(result.keys()) == {"p1", "p2"}
    assert {endpoint for endpoint, _ in fake.calls if endpoint != "/v1/private/projects"} == {
        "/v1/private/projects/p1/metrics",
        "/v1/private/projects/p2/metrics",
    }


def test_registry_key_is_resolved_to_real_opik_project_id_not_sent_as_name(monkeypatch):
    """Bug SDLCCT-63: the registry key string (e.g. "maintenance_copilot")
    must never be sent verbatim as the Opik project id in the request
    path -- it must first be resolved via GET /v1/private/projects to the
    real UUID Opik assigned to that project name."""
    real_uuid = "0ddba11-c0ffee-feedface-deadbeef-abc123"
    fake = FakeClient(
        responses={
            "/v1/private/projects": FakeResponse(
                payload={"content": [{"name": "maintenance_copilot", "id": real_uuid}]}
            ),
            f"/v1/private/projects/{real_uuid}/metrics": FakeResponse(payload={"results": []}),
        }
    )
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    result = get_project_metrics(
        ["maintenance_copilot"],
        MetricType.COST,
        interval=Interval.DAILY,
        interval_start=START,
        interval_end=END,
    )

    post_endpoints = {endpoint for endpoint, _ in fake.calls if endpoint != "/v1/private/projects"}
    assert post_endpoints == {f"/v1/private/projects/{real_uuid}/metrics"}
    assert "/v1/private/projects/maintenance_copilot/metrics" not in post_endpoints
    # output dict is still keyed by the original registry key, not the uuid.
    assert set(result.keys()) == {"maintenance_copilot"}


def test_unknown_project_key_raises_unknown_project_key_error(monkeypatch):
    """A key with no matching entry in the GET /v1/private/projects listing
    raises UnknownProjectKeyError carrying the offending key, instead of
    being sent to the backend as if it were already a valid id."""
    fake = FakeClient(
        responses={
            "/v1/private/projects": FakeResponse(payload={"content": [{"name": "p1", "id": "p1"}]}),
        }
    )
    monkeypatch.setattr(opik_metrics, "_client", lambda: fake)

    with pytest.raises(UnknownProjectKeyError) as exc_info:
        get_project_metrics(
            ["does-not-exist"],
            MetricType.COST,
            interval=Interval.DAILY,
            interval_start=START,
            interval_end=END,
        )

    assert exc_info.value.missing_key == "does-not-exist"
    # no metrics POST was ever attempted for the unresolved key.
    assert all(not endpoint.endswith("/metrics") for endpoint, _ in fake.calls)
