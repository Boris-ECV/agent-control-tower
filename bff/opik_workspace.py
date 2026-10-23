"""Read-only Opik client for workspace/project summary endpoints
(SDLCCT-15): /v1/private/workspaces/costs and /v1/private/projects/stats.

Reuses opik_metrics's base_url()/_client()/exception hierarchy/_iso()
directly -- this module does not redefine any of them.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from opik_metrics import (
    MetricPoint,
    MissingProjectIdsError,
    OpikHTTPError,
    OpikResponseFormatError,
    OpikTimeoutError,
    _client,
    _iso,
    resolve_project_ids,
)

DEFAULT_PROJECTS_STATS_PAGE_SIZE = 100  # see decision below


@dataclass(frozen=True)
class ProjectStats:
    project_id: str
    total_estimated_cost_sum: float | None  # verified field; None if backend omits it
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /projects/stats entry as returned by the backend,
    # so fields seed/verify.py has not exercised (and this module therefore
    # does not type) are not silently discarded -- see decision below.


def get_workspace_daily_costs(
    project_ids: Sequence[str],
    *,
    interval_start: datetime,
    interval_end: datetime,
) -> dict[str, tuple[MetricPoint, ...]]:
    """POST /v1/private/workspaces/costs for the given project_ids.

    - project_ids must be non-empty -> MissingProjectIdsError otherwise;
      no request is sent in that case.
    - interval_start/interval_end are required (no default): callers pass
      SDLCCT-9's anchor date themselves (see bff.anchor.get_anchor_date()),
      this function never reads the system clock.
    - Backend scopes the response to the requested project_ids itself
      (verified in seed/verify.py); the returned dict's keys are exactly
      the project_ids the backend actually returned data for.
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns 0/empty
      on failure.
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    name_to_id = resolve_project_ids(project_ids)
    id_to_name = {v: k for k, v in name_to_id.items()}

    endpoint = "/v1/private/workspaces/costs"
    body = {
        "project_ids": list(name_to_id.values()),
        "interval_start": _iso(interval_start),
        "interval_end": _iso(interval_end),
    }
    with _client() as c:
        try:
            r = c.post(endpoint, json=body)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        return _parse_workspace_costs_response(r, endpoint, id_to_name)


def _parse_workspace_costs_response(
    r: httpx.Response, endpoint: str, id_to_name: dict[str, str]
) -> dict[str, tuple[MetricPoint, ...]]:
    try:
        payload = r.json()
        out: dict[str, tuple[MetricPoint, ...]] = {}
        for res in payload["results"]:
            pid = res["project_id"]
            if pid not in id_to_name:
                raise OpikResponseFormatError(
                    f"backend returned project_id '{pid}' not among the requested ids",
                    endpoint=endpoint,
                    status_code=r.status_code,
                )
            name = id_to_name[pid]
            points = tuple(
                MetricPoint(
                    time=datetime.fromisoformat(p["time"].replace("Z", "+00:00")),
                    value=p["value"],
                )
                for p in res["data"]
            )
            out[name] = points
        return out
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def get_project_stats(
    project_ids: Sequence[str],
    *,
    from_time: datetime,
    to_time: datetime,
    page_size: int = DEFAULT_PROJECTS_STATS_PAGE_SIZE,
) -> dict[str, ProjectStats]:
    """GET /v1/private/projects/stats, then filter to the given project_ids
    on the client side (the backend has no project-id filter parameter).

    - project_ids must be non-empty -> MissingProjectIdsError otherwise;
      no request is sent in that case.
    - from_time/to_time are required (no default): same anchor-date
      contract as get_workspace_daily_costs().
    - Single page, page_size=100 by default (see decision below): the
      response is NOT looped over multiple pages.
    - The returned dict contains ONLY entries whose project_id is in
      project_ids -- any other project present in the single fetched page
      is dropped, never leaked into the result (AC: client-side filtering).
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status.
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )
    name_to_id = resolve_project_ids(project_ids)
    id_to_name = {v: k for k, v in name_to_id.items()}

    endpoint = "/v1/private/projects/stats"
    params = {
        "size": page_size,
        "from_time": _iso(from_time),
        "to_time": _iso(to_time),
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
        all_stats = _parse_projects_stats_response(r, endpoint)

    wanted_ids = set(name_to_id.values())
    return {id_to_name[pid]: s for pid, s in all_stats.items() if pid in wanted_ids}


def _parse_projects_stats_response(r: httpx.Response, endpoint: str) -> dict[str, ProjectStats]:
    try:
        payload = r.json()
        out: dict[str, ProjectStats] = {}
        for item in payload["content"]:
            pid = item["project_id"]
            out[pid] = ProjectStats(
                project_id=pid,
                total_estimated_cost_sum=item.get("total_estimated_cost_sum"),
                raw=item,
            )
        return out
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc
