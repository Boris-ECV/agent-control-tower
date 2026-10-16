"""Read-only Opik client for the trace search endpoint, sorted by cost
(SDLCCT-17): /v1/private/traces.

Reuses opik_metrics's base_url()/_client()/exception hierarchy directly --
this module does not redefine any of them. Trace-tree (span) assembly is
explicitly out of scope -- see decision below; this module returns only a
flat, cost-sorted list.
"""

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from opik_metrics import (
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    _client,
)

DEFAULT_TOP_TRACES_SIZE = 10  # matches the validated seed/verify.py call shape


@dataclass(frozen=True)
class TraceSummary:
    id: str
    metadata: dict[str, Any] | None  # verified field; backend may return null
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /traces content entry as returned by the backend,
    # so fields seed/verify.py has not exercised are not silently discarded
    # -- same escape-hatch pattern as SDLCCT-15's ProjectStats.raw.


def get_top_traces_by_cost(
    project_name: str,
    *,
    size: int = DEFAULT_TOP_TRACES_SIZE,
) -> tuple[TraceSummary, ...]:
    """GET /v1/private/traces, sorted by total_estimated_cost DESC, for a
    single project_name.

    - project_name must be a non-empty string -> MissingProjectIdsError
      otherwise; no request is sent in that case (AC2). Reusing
      MissingProjectIdsError here (not a new exception class) because its
      existing semantics -- "a required identifying parameter was not
      supplied, caller-side contract violation, no query-all fallback" --
      apply identically to a missing project_name; see decision below.
    - size caps the number of returned traces (passed straight through to
      the backend's size param); no multi-page loop (see decision below).
    - Returned tuple order is exactly the backend's response order (backend
      already sorts DESC by total_estimated_cost per the validated request;
      this function does not re-sort client-side).
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns an empty
      tuple on failure (AC3).
    """
    if not project_name:
        raise MissingProjectIdsError(
            "project_name must be non-empty: an explicit project name is required"
        )
    endpoint = "/v1/private/traces"
    params = {
        "project_name": project_name,
        "size": size,
        "sorting": json.dumps([{"field": "total_estimated_cost", "direction": "DESC"}]),
    }
    with _client() as c:
        try:
            r = c.get(endpoint, params=params)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        return _parse_traces_response(r, endpoint)


def _parse_traces_response(r: httpx.Response, endpoint: str) -> tuple[TraceSummary, ...]:
    try:
        payload = r.json()
        return tuple(
            TraceSummary(id=item["id"], metadata=item.get("metadata"), raw=item)
            for item in payload["content"]
        )
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc
