"""Governance-gap (unregistered agent) anomaly detection rule (SDLCCT-31).

Cross-references seed/registry.py's registration status (registered/owner/
budget) against Opik daily cost records, flagging any Agent that is
unregistered, has no owner, or has no budget while still producing spend.

Flag condition (decided, zero false positives, verified against the 9
catalog.AGENTS entries): registered is False or owner is None or budget
is None; any one of the three is sufficient. Only temp_supplier_scraper
satisfies it among the 9 current Agents.
"""

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "seed"))
from registry import get_agent  # noqa: E402

from opik_metrics import MetricPoint, MissingProjectIdsError  # noqa: E402
from opik_workspace import get_workspace_daily_costs  # noqa: E402


@dataclass(frozen=True)
class GovernanceGapFinding:
    key: str
    display: str
    owner: str | None
    budget: float | None
    registered: bool
    daily_costs: tuple[MetricPoint, ...]
    first_day_cost: float | None
    last_day_cost: float | None


def find_governance_gaps(
    project_ids: Sequence[str],
    *,
    interval_start: datetime,
    interval_end: datetime,
) -> tuple[GovernanceGapFinding, ...]:
    """For each key in project_ids, look up registry.get_agent(key) and flag
    those for which registered is False or owner is None or budget is None.
    Calls get_workspace_daily_costs() exactly once, only for the flagged
    subset, to attach each finding's daily cost numbers.

    - project_ids empty -> MissingProjectIdsError, checked before any
      get_agent() call (see module docstring / design doc decision).
    - A key with no registry record (get_agent() returns None) is silently
      skipped: there is no factual basis to say "this Agent has no
      governance gap" for a record that does not exist.
    - If the flagged subset is empty, returns an empty tuple without ever
      calling get_workspace_daily_costs() (avoids misinterpreting "zero
      governance gaps" as the empty-input error case).
    - first_day_cost/last_day_cost are the first/last MetricPoint.value of
      daily_costs, in the order returned by get_workspace_daily_costs();
      None (never 0.0) when daily_costs is empty or the value itself is
      unknown.
    """
    if not project_ids:
        raise MissingProjectIdsError(
            "project_ids must be non-empty: explicit project id(s) are required"
        )

    flagged: list[dict] = []
    for key in project_ids:
        record = get_agent(key)
        if record is None:
            continue
        if record["registered"] is False or record["owner"] is None or record["budget"] is None:
            flagged.append(record)

    if not flagged:
        return ()

    costs_map = get_workspace_daily_costs(
        [record["key"] for record in flagged],
        interval_start=interval_start,
        interval_end=interval_end,
    )

    findings = []
    for record in flagged:
        daily_costs = costs_map.get(record["key"], ())
        first_day_cost = daily_costs[0].value if daily_costs else None
        last_day_cost = daily_costs[-1].value if daily_costs else None
        findings.append(
            GovernanceGapFinding(
                key=record["key"],
                display=record["display"],
                owner=record["owner"],
                budget=record["budget"],
                registered=record["registered"],
                daily_costs=daily_costs,
                first_day_cost=first_day_cost,
                last_day_cost=last_day_cost,
            )
        )
    return tuple(findings)
