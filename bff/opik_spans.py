"""Read-only Opik client for the spans endpoint (SDLCCT-53):
/v1/private/spans, plus a network-free function to assemble a flat span
list into a tree (root + orphan top-level nodes).

Reuses opik_metrics's _client()/exception hierarchy directly -- this
module does not redefine any of them. Field-shape note: only `id` and
`parent_span_id` are given typed attributes (verified on the read side
by seed/verify.py's count assertion and on the write side by
seed/generate.py's _span() helper); every other field is preserved
verbatim via `raw` -- see docs/design/SDLCCT-53.md decision #1.
"""

from collections.abc import Sequence
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

DEFAULT_TRACE_SPANS_SIZE = 200  # matches the validated seed/verify.py call shape


@dataclass(frozen=True)
class SpanSummary:
    id: str
    parent_span_id: str | None  # verified field; None marks the trace's root span
    raw: dict[str, Any] = field(repr=False, compare=False)
    # raw holds the full /spans content entry as returned by the backend,
    # so fields this Story's AC does not pin (name, start_time/end_time,
    # type, model/provider/usage, error_info, ...) are never silently
    # discarded -- same escape-hatch pattern as opik_traces.TraceSummary.


@dataclass(frozen=True)
class SpanNode:
    span: SpanSummary
    children: tuple["SpanNode", ...]
    # Child order == order of first appearance in the input sequence to
    # build_span_tree() (AC6); orphan spans are returned as additional
    # top-level SpanNode entries, same level as the root (AC7) -- see
    # decision #2.


def get_trace_spans(
    project_name: str,
    trace_id: str,
    *,
    size: int = DEFAULT_TRACE_SPANS_SIZE,
) -> tuple[SpanSummary, ...]:
    """GET /v1/private/spans for a single (project_name, trace_id) pair.

    - project_name and trace_id must both be non-empty strings ->
      MissingProjectIdsError otherwise (reusing the existing exception
      class, not a new one -- see decision #3); no request is sent in
      that case (AC1, AC2).
    - size caps the number of returned spans (passed straight through to
      the backend's size param); no multi-page loop, same precedent as
      opik_traces.get_top_traces_by_cost (SDLCCT-17 decision #4).
    - Returned tuple order is exactly the backend's response order; this
      function does not reorder.
    - Any backend failure raises OpikHTTPError / OpikTimeoutError /
      OpikResponseFormatError with endpoint+status; never returns an
      empty tuple on failure (AC4, AC5).
    """
    if not project_name or not trace_id:
        raise MissingProjectIdsError(
            "project_name and trace_id must both be non-empty: "
            "explicit identifiers are required"
        )
    endpoint = "/v1/private/spans"
    params = {"project_name": project_name, "trace_id": trace_id, "size": size}
    with _client() as c:
        try:
            r = c.get(endpoint, params=params)
        except httpx.TimeoutException as exc:
            raise OpikTimeoutError("request timed out", endpoint=endpoint) from exc
        except httpx.HTTPError as exc:
            raise OpikHTTPError(f"request failed: {exc}", endpoint=endpoint) from exc
        if r.status_code != 200:
            raise OpikHTTPError("non-2xx response", endpoint=endpoint, status_code=r.status_code)
        return _parse_spans_response(r, endpoint)


def _parse_spans_response(r: httpx.Response, endpoint: str) -> tuple[SpanSummary, ...]:
    try:
        payload = r.json()
        return tuple(
            SpanSummary(id=item["id"], parent_span_id=item.get("parent_span_id"), raw=item)
            for item in payload["content"]
        )
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OpikResponseFormatError(
            f"unexpected response shape: {exc}", endpoint=endpoint, status_code=r.status_code
        ) from exc


def build_span_tree(spans: Sequence[SpanSummary]) -> tuple[SpanNode, ...]:
    """Assemble a flat span list (same trace_id) into a tree.

    Pure, network-free, no backend errors possible. Returns one SpanNode
    per top-level span: the single root (parent_span_id is None) plus,
    at the same level, any orphan span whose parent_span_id does not
    match any id present in `spans` (AC7) -- e.g. because a size-capped
    get_trace_spans() call truncated the parent out of the list. Within
    every node, children are ordered by first appearance in `spans`
    (AC6). Does not assume there is exactly one root-like span; if
    `spans` is empty, returns an empty tuple.
    """
    by_id = {s.id: s for s in spans}
    children_of: dict[str | None, list[SpanSummary]] = {}
    for s in spans:
        parent_key = s.parent_span_id if s.parent_span_id in by_id else None
        children_of.setdefault(parent_key, []).append(s)

    def make_node(s: SpanSummary) -> SpanNode:
        return SpanNode(
            span=s,
            children=tuple(make_node(c) for c in children_of.get(s.id, [])),
        )

    return tuple(make_node(s) for s in children_of.get(None, []))
