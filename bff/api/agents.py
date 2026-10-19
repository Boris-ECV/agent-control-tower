"""Business logic for the Agent registry screen (SDLCCT-43): combines
seed/registry.py's full 9-Agent registry with bff/opik_metrics.py cost
queries (current-period total + 7-day daily trend) and computes the
derived numbers (budget_consumed_pct) plus an inline governance-gap flag.

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/cost_overview.py to import registry.load_registry() -- this
module does not invent a second import mechanism (see design doc
docs/design/SDLCCT-43.md "新增模組位置").

Deliberately does NOT call bff/anomaly_governance_gap.py::
find_governance_gaps(): that function only returns the *flagged subset*
(Agents with a governance gap), so using its return value as this
endpoint's data source would silently drop the 8 non-flagged Agents,
violating AC1's "all 9 Agents" requirement. Instead this module applies
the exact same three-condition OR test inline against the full registry
(see docs/design/SDLCCT-43.md decision 2).
"""

import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

_BFF_ROOT = Path(__file__).resolve().parent.parent
_SEED_ROOT = _BFF_ROOT.parent / "seed"
for _path in (_BFF_ROOT, _SEED_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from registry import load_registry  # noqa: E402

from anchor import get_anchor_date  # noqa: E402
from opik_metrics import Interval, MetricType, get_project_metrics_cached  # noqa: E402


def _to_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _total_cost(metrics_map: dict, key: str) -> float:
    """Sum every MetricPoint.value across every series returned for `key`.
    None values (unknown) contribute 0 to the sum; an entirely absent key
    also contributes 0 -- same convention as
    bff/api/cost_overview.py::_total_cost()."""
    total = 0.0
    for series in metrics_map.get(key, ()):
        for point in series.points:
            if point.value is not None:
                total += point.value
    return total


def _trend_points(metrics_map: dict, key: str) -> list[dict]:
    """Build this key's 7-day trend as a list of {date, value} dicts, one
    per MetricPoint actually returned, in the order returned. `value` is
    passed through verbatim (including None) -- never coerced to 0 (see
    docs/design/SDLCCT-43.md decision 1)."""
    points = []
    for series in metrics_map.get(key, ()):
        for point in series.points:
            points.append({"date": point.time.date().isoformat(), "value": point.value})
    return points


def get_agent_registry() -> dict:
    """GET /api/agents business logic. See design doc
    docs/design/SDLCCT-43.md section "介面/API 契約" for the exact
    contract."""
    anchor_dt = get_anchor_date()
    anchor_date = anchor_dt.date()
    period_start = anchor_date.replace(day=1)
    trend_start = anchor_date - timedelta(days=6)

    registry_records = load_registry()
    keys = [r["key"] for r in registry_records]

    current_period_costs_map = get_project_metrics_cached(
        keys,
        MetricType.COST,
        interval=Interval.TOTAL,
        interval_start=_to_utc_midnight(period_start),
        interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
    )
    trend_costs_map = get_project_metrics_cached(
        keys,
        MetricType.COST,
        interval=Interval.DAILY,
        interval_start=_to_utc_midnight(trend_start),
        interval_end=_to_utc_midnight(anchor_date + timedelta(days=1)),
    )

    agents = []
    for r in registry_records:
        key = r["key"]
        budget = r["budget"]
        current_period_spend = _total_cost(current_period_costs_map, key)
        budget_consumed_pct = (
            current_period_spend / budget * 100 if budget else None
        )
        has_governance_gap = (
            r["registered"] is False or r["owner"] is None or r["budget"] is None
        )
        agents.append(
            {
                "key": key,
                "display": r["display"],
                "dept": r["dept"],
                "owner": r["owner"],
                "budget": budget,
                "registered": r["registered"],
                "current_period_spend": current_period_spend,
                "budget_consumed_pct": budget_consumed_pct,
                "trend": _trend_points(trend_costs_map, key),
                "has_governance_gap": has_governance_gap,
            }
        )

    return {
        "anchor_date": anchor_date.isoformat(),
        "period_start": period_start.isoformat(),
        "agents": agents,
    }
