"""Read-only Opik client for project metrics (SDLCCT-10).

Request shape (endpoint, Comet-Workspace header, base-url handling) is
consistent with seed/client.py's proven patterns, but this module is
reimplemented independently in bff/: it is read-only, long-running-process
safe (raises typed exceptions instead of seed/client.py's SystemExit), and
has no dependency on seed/.
"""

import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

import httpx

# Vendored copy of seed/anchor.py (see docs/design/SDLCCT-10.md decision #3):
# bff/ and seed/ are separate packages, each with its own pyproject.toml and
# pythonpath = ["."], so the import is flat ("anchor"), matching seed/'s own
# convention (seed/client.py etc. import sibling modules the same way) --
# the design doc's decision #3 explicitly anticipates adjusting the import
# path when copying the module into bff/.
from anchor import get_anchor_date  # noqa: F401  (re-exported for callers)

BASE_URL_ENV_VAR = "OPIK_BASE_URL"
WORKSPACE_ENV_VAR = "OPIK_WORKSPACE"
DEFAULT_WORKSPACE = "default"


class MetricType(StrEnum):
    COST = "COST"
    TRACE_COUNT = "TRACE_COUNT"
    TRACE_ERROR_RATE = "TRACE_ERROR_RATE"
    SPAN_COUNT = "SPAN_COUNT"
    SPAN_TOKEN_USAGE = "SPAN_TOKEN_USAGE"


class Interval(StrEnum):
    HOURLY = "HOURLY"
    DAILY = "DAILY"
    TOTAL = "TOTAL"


class BreakdownField(StrEnum):
    METADATA = "metadata"
    TAGS = "tags"
    NAME = "name"


@dataclass(frozen=True)
class Breakdown:
    field: BreakdownField
    metadata_key: str | None = None  # required iff field is METADATA

    def __post_init__(self):
        if self.field is BreakdownField.METADATA and not self.metadata_key:
            raise ValueError("Breakdown(field=METADATA) requires metadata_key")


@dataclass(frozen=True)
class MetricPoint:
    time: datetime
    value: float | None  # None = "unknown" (missing provider/model/usage); NEVER coerced to 0.0


@dataclass(frozen=True)
class MetricSeries:
    key: str  # breakdown value (metadata value / tag / name), or the project_id itself when no breakdown
    points: tuple[MetricPoint, ...]


class MissingProjectIdsError(ValueError):
    """Raised when project_ids is empty. A caller-side contract violation,
    not a backend failure -- there is deliberately no "query all projects"
    fallback (AC: explicit project id(s) required)."""


class OpikConfigError(Exception):
    """Raised for configuration problems detected before any backend call
    is attempted (e.g. OPIK_BASE_URL unset). Distinct from OpikClientError:
    no endpoint was ever reached, so there is no endpoint/status to report."""


class OpikClientError(Exception):
    """Base class for an explicit failure of a specific backend call.
    Always carries the endpoint path and (when known) the HTTP status
    code, so a caller/log never has to guess which request failed."""

    def __init__(self, message: str, *, endpoint: str, status_code: int | None = None):
        super().__init__(f"{message} (endpoint={endpoint}, status={status_code})")
        self.endpoint = endpoint
        self.status_code = status_code


class OpikHTTPError(OpikClientError):
    """Non-2xx response from the backend."""


class OpikTimeoutError(OpikClientError):
    """Request timed out (status_code is always None)."""


class OpikResponseFormatError(OpikClientError):
    """2xx response but the JSON body did not match the expected shape
    (missing "results" key, "data" not a list, etc.)."""


def base_url() -> str:
    """The Opik backend address. Required: there is deliberately no default."""
    value = os.environ.get(BASE_URL_ENV_VAR, "").strip()
    if not value:
        raise OpikConfigError(f"{BASE_URL_ENV_VAR} is not set (example: https://<host>/api)")
    return value.rstrip("/")


def _client() -> httpx.Client:
    workspace = os.environ.get(WORKSPACE_ENV_VAR, "").strip() or DEFAULT_WORKSPACE
    return httpx.Client(base_url=base_url(), headers={"Comet-Workspace": workspace}, timeout=120.0)


def get_project_metrics(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None = None,
) -> dict[str, tuple[MetricSeries, ...]]:
    """Query one project's metrics endpoint for each id in `project_ids`,
    explicitly, and return {project_id: (MetricSeries, ...)}.

    - project_ids must be non-empty -> MissingProjectIdsError otherwise.
    - interval_start/interval_end are required (no default): callers that
      want "today" pass anchor.get_anchor_date() themselves -- this
      module never reads the system clock and never guesses a window.
    - Any backend failure for any one project_id raises immediately
      (OpikHTTPError / OpikTimeoutError / OpikResponseFormatError) with
      that project's endpoint+status; partial results are not returned.
    - Null "value" entries in the response are preserved as Python None
      in MetricPoint.value (never replaced with 0.0).
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    body_base = {
        "metric_type": metric_type.value,
        "interval": interval.value,
        "interval_start": _iso(interval_start),
        "interval_end": _iso(interval_end),
    }
    if breakdown is not None:
        body_base["breakdown"] = (
            {"field": breakdown.field.value, "metadata_key": breakdown.metadata_key}
            if breakdown.field is BreakdownField.METADATA
            else {"field": breakdown.field.value}
        )

    out: dict[str, tuple[MetricSeries, ...]] = {}
    with _client() as c:
        for pid in project_ids:
            endpoint = f"/v1/private/projects/{pid}/metrics"
            try:
                r = c.post(endpoint, json=body_base)
            except httpx.TimeoutException as exc:
                raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
            except httpx.HTTPError as exc:
                raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
            if r.status_code != 200:
                raise OpikHTTPError(
                    "non-2xx response", endpoint=endpoint, status_code=r.status_code
                )
            out[pid] = _parse_metric_response(r, endpoint)
    return out


def _parse_metric_response(r: httpx.Response, endpoint: str) -> tuple[MetricSeries, ...]:
    try:
        payload = r.json()
        results = payload["results"]
        series = []
        for res in results:
            key = res.get("name") or res["project_id"]
            points = tuple(
                MetricPoint(time=datetime.fromisoformat(p["time"].replace("Z", "+00:00")), value=p["value"])
                for p in res["data"]
            )
            series.append(MetricSeries(key=key, points=points))
        return tuple(series)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def _iso(ts: datetime) -> str:
    from datetime import UTC

    return ts.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
