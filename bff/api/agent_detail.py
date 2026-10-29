"""Business logic for the Agent detail cost-breakdown endpoint (SDLCCT-47,
split from SDLCCT-44): combines a single Agent's seed/registry.py record
with read-only Opik queries -- a version-split 7-day daily cost series
(Breakdown(METADATA, metadata_key="deployed_version")), a model-split
current-period cost breakdown (Breakdown(TAGS)), a top-N cost-sorted
trace list (opik_traces.get_top_traces_by_cost()), and (SDLCCT-76) a
no-breakdown 7-day daily cost total used to detect/append a synthetic
"其他／未標記版本" entry for cost not attributable to any
deployed_version tag.

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/agents.py / bff/api/cost_overview.py. See docs/design/SDLCCT-47.md
and docs/design/SDLCCT-76.md "介面/API 契約" and "關鍵技術決策" for the
exact contract and the reasoning behind the time windows and
null-handling rules below.
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


_OTHER_VERSION_LABEL = "其他／未標記版本"
_OTHER_VERSION_GAP_THRESHOLD = 0.01  # 1 cent, see docs/design/SDLCCT-76.md decision #3


def _by_date(series_tuple: tuple[MetricSeries, ...]) -> dict[str, float | None]:
    """Merge every point across every series in `series_tuple` into a single
    {date_iso: value} map. For a given date, if any series has a non-None
    value that day, the result is the sum of all non-None values that day;
    if every series is None (or has no point) for that day, the result is
    None -- never 0.0 (see docs/design/SDLCCT-76.md decision #3: "unknown"
    is always represented as null, never coerced to 0)."""
    by_date: dict[str, float | None] = {}
    for series in series_tuple:
        for point in series.points:
            date_iso = point.time.date().isoformat()
            if point.value is None:
                by_date.setdefault(date_iso, None)
                continue
            current = by_date.get(date_iso)
            by_date[date_iso] = point.value if current is None else current + point.value
    return by_date


def _compute_other_entry(
    total_by_date: dict[str, float | None], version_series: list[dict]
) -> dict | None:
    """Return the {"version": "其他／未標記版本", "points": [...]} entry to
    append to version_cost_series, or None if no entry is needed. The date
    set/order is taken from `total_by_date` (the no-breakdown total query),
    not from `version_series` -- see docs/design/SDLCCT-76.md decision #4;
    this matters when `version_series` is empty (Scenario 3).
    """
    version_sums_by_date: dict[str, float] = {}
    for entry in version_series:
        for p in entry["points"]:
            value = p["value"] or 0.0
            version_sums_by_date[p["date"]] = version_sums_by_date.get(p["date"], 0.0) + value

    points = []
    any_gap = False
    for date_iso, total in total_by_date.items():
        if total is None:
            points.append({"date": date_iso, "value": None})
            continue
        gap = total - version_sums_by_date.get(date_iso, 0.0)
        if gap > _OTHER_VERSION_GAP_THRESHOLD:
            any_gap = True
            points.append({"date": date_iso, "value": gap})
        else:
            points.append({"date": date_iso, "value": None})

    if not any_gap:
        return None
    return {"version": _OTHER_VERSION_LABEL, "points": points}


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
    total_daily_metrics_map = get_project_metrics_cached(
        [key],
        MetricType.COST,
        interval=Interval.DAILY,
        interval_start=_to_utc_midnight(trend_start),
        interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
        # breakdown omitted -> None: the real daily total for this window,
        # same query shape as bff/api/agents.py::_trend_points() (see
        # docs/design/SDLCCT-76.md decision #1/#4).
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

    other_entry = _compute_other_entry(
        _by_date(total_daily_metrics_map.get(key, ())), version_cost_series
    )
    if other_entry is not None:
        version_cost_series.append(other_entry)

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
