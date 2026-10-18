"""Business logic for the Cost overview screen (SDLCCT-32): combines
seed/registry.py budget data with bff/opik_metrics.py cost queries and
computes the derived numbers (budget consumption %, projected month-end
spend/overspend, month-over-month period comparison).

Reuses the sys.path.insert(..., "seed") technique already established by
bff/anomaly_governance_gap.py to import registry.load_registry() -- this
module does not invent a second import mechanism (see design doc decision).
"""

import calendar
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


def _month_bounds(anchor_date: date) -> tuple[date, int, int]:
    """Return (month_start, days_elapsed, days_in_month) for anchor_date."""
    month_start = anchor_date.replace(day=1)
    days_in_month = calendar.monthrange(anchor_date.year, anchor_date.month)[1]
    days_elapsed = anchor_date.day
    return month_start, days_elapsed, days_in_month


def _add_months(d: date, delta_months: int) -> date:
    """Return the first day of the month that is delta_months away from d's
    month, using actual calendar month arithmetic (never timedelta(30)) so
    28/29/30/31-day months never drift."""
    total = d.month - 1 + delta_months
    year = d.year + total // 12
    month = total % 12 + 1
    return date(year, month, 1)


def _to_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _total_cost(metrics_map: dict, key: str) -> float:
    """Sum every MetricPoint.value across every series returned for `key`.
    None values (unknown) contribute 0 to the sum; an entirely absent key
    (metrics_map.get(key, ())) also contributes 0 -- both are legitimate
    "no cost observed" cases for a *successful* response, not failures
    (a failure already raised an OpikClientError before we get here)."""
    total = 0.0
    for series in metrics_map.get(key, ()):
        for point in series.points:
            if point.value is not None:
                total += point.value
    return total


def _query_total_costs(keys: list[str], *, start: date, end_exclusive: date) -> dict[str, float]:
    metrics_map = get_project_metrics_cached(
        keys,
        MetricType.COST,
        interval=Interval.TOTAL,
        interval_start=_to_utc_midnight(start),
        interval_end=_to_utc_midnight(end_exclusive),
    )
    return {key: _total_cost(metrics_map, key) for key in keys}


def get_summary() -> dict:
    """GET /api/cost-overview/summary business logic. See design doc
    docs/design/SDLCCT-32.md section "介面/API 契約" for the exact contract.
    """
    anchor_dt = get_anchor_date()
    anchor_date = anchor_dt.date()
    month_start, days_elapsed, days_in_month = _month_bounds(anchor_date)

    registry_records = load_registry()
    keys = [r["key"] for r in registry_records]

    costs = _query_total_costs(keys, start=month_start, end_exclusive=anchor_date + timedelta(days=1))
    total_spend = sum(costs.values())

    total_budget = sum(
        r["budget"] for r in registry_records if r["registered"] is True and r["budget"] is not None
    )

    budget_consumed_pct = (total_spend / total_budget * 100) if total_budget else None
    projected_month_end_spend = (
        total_spend / days_elapsed * days_in_month if days_elapsed else None
    )
    projected_overspend = (
        projected_month_end_spend - total_budget if projected_month_end_spend is not None else None
    )

    unregistered_agents = [
        {"key": r["key"], "display": r["display"], "spend": costs.get(r["key"], 0.0)}
        for r in registry_records
        if r["registered"] is False
    ]
    unregistered_spend = sum(a["spend"] for a in unregistered_agents)

    return {
        "anchor_date": anchor_date.isoformat(),
        "month_start": month_start.isoformat(),
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "total_spend": total_spend,
        "total_budget": total_budget,
        "budget_consumed_pct": budget_consumed_pct,
        "projected_month_end_spend": projected_month_end_spend,
        "projected_overspend": projected_overspend,
        "unregistered": {
            "spend": unregistered_spend,
            "agents": unregistered_agents,
        },
    }


def get_period_comparison() -> dict:
    """GET /api/cost-overview/period-comparison business logic: month-over-
    month comparison for all 9 Agents (unregistered Agents included -- see
    design doc decision), ranked by delta (current - previous, in dollar
    terms) descending ("who went up the most" is the primary sort key;
    delta_pct is returned but never used for sorting)."""
    anchor_dt = get_anchor_date()
    anchor_date = anchor_dt.date()
    month_start = anchor_date.replace(day=1)
    days_elapsed = anchor_date.day

    previous_month_start = _add_months(month_start, -1)
    previous_period_end = previous_month_start + timedelta(days=days_elapsed - 1)

    registry_records = load_registry()
    keys = [r["key"] for r in registry_records]

    current_costs = _query_total_costs(keys, start=month_start, end_exclusive=anchor_date + timedelta(days=1))
    previous_costs = _query_total_costs(
        keys, start=previous_month_start, end_exclusive=previous_period_end + timedelta(days=1)
    )

    agents = []
    for r in registry_records:
        key = r["key"]
        current_cost = current_costs.get(key, 0.0)
        previous_cost = previous_costs.get(key, 0.0)
        delta = current_cost - previous_cost
        delta_pct = (delta / previous_cost * 100) if previous_cost else None
        agents.append(
            {
                "key": key,
                "display": r["display"],
                "current_cost": current_cost,
                "previous_cost": previous_cost,
                "delta": delta,
                "delta_pct": delta_pct,
            }
        )

    agents.sort(key=lambda a: a["delta"], reverse=True)

    return {
        "anchor_date": anchor_date.isoformat(),
        "current_period": {"start": month_start.isoformat(), "end": anchor_date.isoformat()},
        "previous_period": {
            "start": previous_month_start.isoformat(),
            "end": previous_period_end.isoformat(),
        },
        "agents": agents,
    }
