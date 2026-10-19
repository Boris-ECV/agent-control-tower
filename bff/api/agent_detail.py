"""Business logic for the Agent detail cost-breakdown endpoint (SDLCCT-47,
split from SDLCCT-44): combines a single Agent's seed/registry.py record
with three read-only Opik queries -- a version-split 7-day daily cost
series (Breakdown(METADATA, metadata_key="deployed_version")), a
model-split current-period cost breakdown (Breakdown(TAGS)), and a
top-N cost-sorted trace list (opik_traces.get_top_traces_by_cost()).

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/agents.py / bff/api/cost_overview.py. See docs/design/SDLCCT-47.md
"介面/API 契約" and "關鍵技術決策" for the exact contract and the reasoning
behind the time windows and null-handling rules below.
"""

import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

_BFF_ROOT = Path(__file__).resolve().parent.parent
_SEED_ROOT = _BFF_ROOT.parent / "seed"
for _path in (_BFF_ROOT, _SEED_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from registry import get_agent  # noqa: E402

from anchor import get_anchor_date  # noqa: E402
from opik_metrics import (  # noqa: E402
    Breakdown,
    BreakdownField,
    Interval,
    MetricSeries,
    MetricType,
    get_project_metrics_cached,
)
from opik_traces import DEFAULT_TOP_TRACES_SIZE, get_top_traces_by_cost  # noqa: E402


def _to_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _series_cost(series: MetricSeries) -> float | None:
    """Sum every non-None MetricPoint.value in `series`. If every point is
    None (or there are no points at all), return None -- never 0.0 (see
    docs/design/SDLCCT-47.md decision #2: this endpoint's null-handling is
    deliberately stricter than cost_overview.py/agents.py's _total_cost(),
    which coerce "no data" to 0.0 for a different use case)."""
    values = [p.value for p in series.points if p.value is not None]
    if not values:
        return None
    return sum(values)


def get_agent_cost_breakdown(key: str, *, top_n: int = DEFAULT_TOP_TRACES_SIZE) -> dict | None:
    """GET /api/agents/{key}/cost-breakdown business logic. See design doc
    docs/design/SDLCCT-47.md section "介面/API 契約" for the exact contract.

    Returns None when `key` is not present in the registry (caller maps
    this to 404, AC5) -- checked before any Opik call is made, so an
    unknown key never triggers a wasted backend query.

    Any OpikClientError/OpikConfigError raised by one of the three
    underlying queries propagates unchanged (not caught here): the caller
    (bff/api/app.py's existing exception handlers) maps it to an explicit
    502 for the whole request (AC4) -- never a partial 0/empty result.
    """
    record = get_agent(key)
    if record is None:
        return None

    anchor_dt = get_anchor_date()
    anchor_date = anchor_dt.date()
    period_start = anchor_date.replace(day=1)
    trend_start = anchor_date - timedelta(days=6)

    version_metrics_map = get_project_metrics_cached(
        [key],
        MetricType.COST,
        interval=Interval.DAILY,
        interval_start=_to_utc_midnight(trend_start),
        interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
        breakdown=Breakdown(field=BreakdownField.METADATA, metadata_key="deployed_version"),
    )
    model_metrics_map = get_project_metrics_cached(
        [key],
        MetricType.COST,
        interval=Interval.TOTAL,
        interval_start=_to_utc_midnight(period_start),
        interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
        breakdown=Breakdown(field=BreakdownField.TAGS),
    )
    top_traces = get_top_traces_by_cost(key, size=top_n)

    version_cost_series = [
        {
            "version": series.key,
            "points": [
                {"date": point.time.date().isoformat(), "value": point.value}
                for point in series.points
            ],
        }
        for series in version_metrics_map.get(key, ())
    ]

    model_cost_breakdown = [
        {"model": series.key, "cost": _series_cost(series)}
        for series in model_metrics_map.get(key, ())
    ]

    top_traces_out = []
    for trace in top_traces:
        cost = trace.raw.get("total_estimated_cost")
        if not isinstance(cost, (int, float)):
            cost = None
        top_traces_out.append(
            {"id": trace.id, "total_estimated_cost": cost, "metadata": trace.metadata}
        )

    return {
        "key": key,
        "display": record["display"],
        "anchor_date": anchor_date.isoformat(),
        "period_start": period_start.isoformat(),
        "version_cost_series": version_cost_series,
        "model_cost_breakdown": model_cost_breakdown,
        "top_traces": top_traces_out,
    }
