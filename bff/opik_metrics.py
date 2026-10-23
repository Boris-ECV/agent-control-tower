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
from cache import TTLCache

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


class UnknownProjectKeyError(OpikClientError):
    """Raised by resolve_project_ids() when a name in project_ids has no
    matching entry in Opik's GET /v1/private/projects listing. The list
    request itself succeeded (status 200) -- this is a data mismatch
    (caller passed a name Opik doesn't know), not a transport failure,
    so it is kept distinct from OpikHTTPError/OpikResponseFormatError."""

    def __init__(self, message: str, *, endpoint: str, missing_key: str):
        super().__init__(message, endpoint=endpoint, status_code=200)
        self.missing_key = missing_key


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

    name_to_id = resolve_project_ids(project_ids)

    out: dict[str, tuple[MetricSeries, ...]] = {}
    with _client() as c:
        for name in project_ids:
            pid = name_to_id[name]
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
            out[name] = _parse_metric_response(r, endpoint)
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


_PROJECT_IDS_LIST_PAGE_SIZE = 200  # matches seed/client.py::project_ids(), verified by seed/verify.py
_PROJECT_IDS_CACHE_TTL_SECONDS = 60.0  # same TTL/rationale as _metrics_cache (decision 3)
_project_ids_cache = TTLCache(ttl_seconds=_PROJECT_IDS_CACHE_TTL_SECONDS)
_PROJECT_IDS_CACHE_KEY = "name_to_id"  # single entry: one GET returns the whole list, not scoped per name


def _fetch_project_name_to_id() -> dict[str, str]:
    """GET /v1/private/projects?size=200 -> {name: id}. Same request shape
    and same {"content": [{"name", "id", ...}]} response shape as
    seed/client.py::project_ids() (not imported from seed/ -- bff/ has no
    dependency on seed/, same vendoring stance as anchor.py, see
    docs/design/SDLCCT-10.md decision #3)."""
    endpoint = "/v1/private/projects"
    with _client() as c:
        try:
            r = c.get(endpoint, params={"size": _PROJECT_IDS_LIST_PAGE_SIZE})
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        try:
            payload = r.json()
            return {p["name"]: p["id"] for p in payload["content"]}
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise OpikResponseFormatError(
                f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
            ) from exc


def resolve_project_ids(keys: Sequence[str]) -> dict[str, str]:
    """Resolve each name in `keys` (registry key strings, e.g.
    "maintenance_copilot") to its real Opik project UUID, via the cached
    GET /v1/private/projects listing. Returns {name: id} -- not a parallel
    list -- so a caller can both look up by original name and build the
    reverse {id: name} map in one line.

    - Backed by a 60s TTL cache of the FULL listing: cache read/write
      failures are isolated exactly like get_project_metrics_cached()'s
      existing pattern -- read failure is treated as a miss, write
      failure is swallowed; the actual GET call itself is never inside a
      try/except, so OpikHTTPError/OpikTimeoutError/OpikResponseFormatError
      from it propagate unchanged.
    - Does NOT check for empty `keys` -- every call site already checks
      `project_ids` non-empty (-> MissingProjectIdsError) before calling
      this, per existing convention; this function assumes that contract.
    - Raises UnknownProjectKeyError (carrying the offending name in
      .missing_key) the first time a key has no match. Never silently
      drops the key, and never falls back to treating the name as if it
      were already a valid id.
    """
    try:
        hit, cached = _project_ids_cache.get(_PROJECT_IDS_CACHE_KEY)
    except Exception:
        hit, cached = False, None

    name_to_id = cached if hit else _fetch_project_name_to_id()

    if not hit:
        try:
            _project_ids_cache.set(_PROJECT_IDS_CACHE_KEY, name_to_id)
        except Exception:
            pass

    resolved: dict[str, str] = {}
    for key in keys:
        if key not in name_to_id:
            raise UnknownProjectKeyError(
                f"no Opik project found with name '{key}'",
                endpoint="/v1/private/projects",
                missing_key=key,
            )
        resolved[key] = name_to_id[key]
    return resolved


def invalidate_project_ids_cache() -> None:
    """Manual invalidation hook, mirrors invalidate_project_metrics_cache()."""
    _project_ids_cache.invalidate_all()


_METRICS_CACHE_TTL_SECONDS = 60.0
_metrics_cache = TTLCache(ttl_seconds=_METRICS_CACHE_TTL_SECONDS)


def _metrics_cache_key(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None,
) -> tuple:
    breakdown_key = (
        (breakdown.field.value, breakdown.metadata_key) if breakdown is not None else None
    )
    return (
        tuple(sorted(project_ids)),  # order-insensitive; see decision below
        metric_type.value,
        interval.value,
        _iso(interval_start),
        _iso(interval_end),
        breakdown_key,
    )


def get_project_metrics_cached(
    project_ids: Sequence[str],
    metric_type: MetricType,
    *,
    interval: Interval,
    interval_start: datetime,
    interval_end: datetime,
    breakdown: Breakdown | None = None,
) -> dict[str, tuple[MetricSeries, ...]]:
    """Cached wrapper around get_project_metrics() (SDLCCT-11).

    Same signature, same return type, same exceptions as
    get_project_metrics() -- a caller can swap between the two freely.
    Cache read/write failures never change the result or swallow a
    backend exception: see "快取失敗隔離" decision below.
    """
    key = _metrics_cache_key(
        project_ids,
        metric_type,
        interval=interval,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=breakdown,
    )

    try:
        hit, cached_value = _metrics_cache.get(key)
    except Exception:
        hit, cached_value = False, None  # treat read failure as a miss (AC6)

    if hit:
        return cached_value

    # NOT inside a try/except: any OpikHTTPError / OpikTimeoutError /
    # OpikResponseFormatError / OpikConfigError / MissingProjectIdsError
    # raised here must propagate to the caller completely unchanged.
    result = get_project_metrics(
        project_ids,
        metric_type,
        interval=interval,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=breakdown,
    )

    try:
        _metrics_cache.set(key, result)
    except Exception:
        pass  # write failure must not affect the result just obtained (AC5)

    return result


def invalidate_project_metrics_cache() -> None:
    """Manual invalidation hook (clears all cached entries). Exposed for
    tests and for any future admin/debug entry point; not wired to any
    HTTP route in this Story (no such route exists yet)."""
    _metrics_cache.invalidate_all()
