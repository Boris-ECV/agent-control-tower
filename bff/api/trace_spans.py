"""Business logic for the Trace spans endpoint (SDLCCT-55): wraps
bff/opik_spans.py (SDLCCT-53)'s get_trace_spans()/build_span_tree() to
assemble a single trace's full span tree for the Agent detail screen's
execution-detail view (SDLCCT-56). See docs/design/SDLCCT-55.md
"介面/API 契約" and "關鍵技術決策" for the exact contract.

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/agent_detail.py / bff/api/agents.py / bff/api/cost_overview.py.
"""

import sys
from pathlib import Path

_BFF_ROOT = Path(__file__).resolve().parent.parent
_SEED_ROOT = _BFF_ROOT.parent / "seed"
for _path in (_BFF_ROOT, _SEED_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from registry import get_agent  # noqa: E402

from opik_spans import SpanNode, build_span_tree, get_trace_spans  # noqa: E402
from opik_traces import get_trace_summary_by_id  # noqa: E402


def _to_tree_node(node: SpanNode) -> dict:
    """Recursively convert an immutable SpanNode (dataclass, tuple
    children) into the plain-dict tree shape FastAPI's response_model
    serializes (see docs/design/SDLCCT-55.md decision #3). name/type/
    start_time/end_time are pulled from SpanSummary.raw via .get() --
    these fields are not typed attributes on SpanSummary (only id/
    parent_span_id are, per opik_spans.py's docstring), so they are
    read defensively and may be None if missing."""
    span = node.span
    return {
        "id": span.id,
        "parent_span_id": span.parent_span_id,
        "name": span.raw.get("name"),
        "type": span.raw.get("type"),
        "start_time": span.raw.get("start_time"),
        "end_time": span.raw.get("end_time"),
        "children": [_to_tree_node(c) for c in node.children],
    }


def get_trace_span_tree(key: str, trace_id: str) -> dict | None:
    """GET /api/agents/{key}/traces/{trace_id}/spans business logic. See
    design doc docs/design/SDLCCT-55.md section "介面/API 契約" for the
    exact contract.

    Returns None when `key` is not present in the registry (caller maps
    this to 404) -- checked before any Opik call is made, so an unknown
    key never triggers a wasted backend query (Scenario 2).

    If trace_id has no spans, get_trace_spans() returns an empty tuple
    (the backend's normal "no data" response shape, not a failure) and
    build_span_tree() returns an empty tuple in turn; this function
    passes that through as spans: [] with HTTP 200 (Scenario 3) -- not
    conflated with a query failure.

    Any OpikClientError/OpikConfigError raised by get_trace_spans()
    propagates unchanged (not caught here): the caller (bff/api/app.py's
    existing exception handlers) maps it to an explicit 502 for the
    whole request (Scenario 4).

    SDLCCT-116: also looks up this trace's summary (metadata/cost) via
    get_trace_summary_by_id() -- an independent query against a different
    Opik endpoint, called unconditionally after the spans query succeeds.
    If the trace has no metadata, no total_estimated_cost, or falls
    outside the enlarged lookup range, get_trace_summary_by_id() returns
    None and all five new fields are None (not 0/""; see docs/design/
    SDLCCT-116.md Scenario 2). Any query failure from that lookup
    (OpikClientError/OpikConfigError) propagates unchanged here too, same
    502 path as get_trace_spans() failures -- not caught and converted to
    None (decision #2: "no data" vs. "query failed" are distinct).
    """
    record = get_agent(key)
    if record is None:
        return None

    spans = get_trace_spans(project_name=key, trace_id=trace_id)
    tree = build_span_tree(spans)

    summary = get_trace_summary_by_id(project_name=key, trace_id=trace_id)
    metadata = summary.metadata if summary is not None else None
    raw = summary.raw if summary is not None else None

    return {
        "key": key,
        "trace_id": trace_id,
        "spans": [_to_tree_node(node) for node in tree],
        "plant": metadata.get("plant") if metadata is not None else None,
        "deployed_version": metadata.get("deployed_version") if metadata is not None else None,
        "dept": metadata.get("dept") if metadata is not None else None,
        "trigger": metadata.get("trigger") if metadata is not None else None,
        "total_estimated_cost": raw.get("total_estimated_cost") if raw is not None else None,
    }
