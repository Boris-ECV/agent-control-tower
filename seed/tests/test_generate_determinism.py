"""Determinism tests for the seed data generator (SDLCCT-7).

These tests call `generate(anchor, scale)` twice with the same fixed `anchor` and
`scale` (no backend connection, no environment variables) and compare the two
resulting manifests. Scope: dry-run determinism of `seed/generate.py` only;
`catalog.py` scenario content is not modified, individual trace/span records are
not compared, and no performance/load assertions are made.
"""

from datetime import datetime
from decimal import Decimal

from catalog import SCALE
from generate import generate

ANCHOR = datetime.fromisoformat("2026-01-01T00:00:00+00:00")


def _run_twice():
    _, manifest_a = generate(ANCHOR, SCALE)
    _, manifest_b = generate(ANCHOR, SCALE)
    return manifest_a, manifest_b


def test_manifest_is_fully_equal_across_runs():
    """Scenario: 相同參數下兩次乾跑產生完全相同的 manifest."""
    manifest_a, manifest_b = _run_twice()

    assert manifest_a == manifest_b


def test_traces_and_spans_counts_are_equal_across_runs():
    """Scenario: 每個 Agent 的 trace 數與 span 數在重複執行下一致."""
    manifest_a, manifest_b = _run_twice()

    assert manifest_a["totals"]["traces"] == manifest_b["totals"]["traces"]
    assert manifest_a["totals"]["spans"] == manifest_b["totals"]["spans"]

    projects_a, projects_b = manifest_a["projects"], manifest_b["projects"]
    assert projects_a.keys() == projects_b.keys()
    for agent_key, project_a in projects_a.items():
        daily_a, daily_b = project_a["daily"], projects_b[agent_key]["daily"]
        assert daily_a.keys() == daily_b.keys()
        for date, stats_a in daily_a.items():
            stats_b = daily_b[date]
            assert stats_a["traces"] == stats_b["traces"], (agent_key, date)
            assert stats_a["spans"] == stats_b["spans"], (agent_key, date)


def test_daily_cost_is_equal_across_runs():
    """Scenario: 每日成本在重複執行下一致."""
    manifest_a, manifest_b = _run_twice()

    projects_a, projects_b = manifest_a["projects"], manifest_b["projects"]
    assert projects_a.keys() == projects_b.keys()
    for agent_key, project_a in projects_a.items():
        daily_a, daily_b = project_a["daily"], projects_b[agent_key]["daily"]
        assert daily_a.keys() == daily_b.keys()
        for date, stats_a in daily_a.items():
            assert stats_a["cost"] == daily_b[date]["cost"], (agent_key, date)


def _totals_vs_budget(manifest: dict) -> dict[str, dict]:
    """Sum each agent's 30-day cost from the manifest and compare it to its budget,
    plus the registered/unregistered fleet totals -- recomputed from the manifest
    itself (not from generate.summarize(), which only prints to stdout).
    """
    budget_by_agent = {entry["project"]: entry["budget_usd"] for entry in manifest["registry"]}
    registered_by_agent = {entry["project"]: entry["registered"] for entry in manifest["registry"]}

    per_agent: dict[str, dict] = {}
    registered_total = Decimal(0)
    fleet_total = Decimal(0)
    for agent_key, project in manifest["projects"].items():
        agent_cost = sum((Decimal(day["cost"]) for day in project["daily"].values()), Decimal(0))
        budget = budget_by_agent[agent_key]
        per_agent[agent_key] = {
            "cost": agent_cost,
            "budget": budget,
            "over_budget": budget is not None and agent_cost > Decimal(str(budget)),
        }
        fleet_total += agent_cost
        if registered_by_agent[agent_key]:
            registered_total += agent_cost

    registered_budget_total = sum(
        Decimal(str(budget_by_agent[agent_key]))
        for agent_key, registered in registered_by_agent.items()
        if registered and budget_by_agent[agent_key] is not None
    )

    return {
        "per_agent": per_agent,
        "registered_total": registered_total,
        "registered_budget_total": registered_budget_total,
        "fleet_total": fleet_total,
    }


def test_total_cost_vs_budget_comparison_is_equal_across_runs():
    """Scenario: 總成本與預算比較在重複執行下一致."""
    manifest_a, manifest_b = _run_twice()

    comparison_a = _totals_vs_budget(manifest_a)
    comparison_b = _totals_vs_budget(manifest_b)

    assert comparison_a == comparison_b
