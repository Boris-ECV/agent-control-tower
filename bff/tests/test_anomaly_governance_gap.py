"""Tests for the governance-gap (unregistered agent) anomaly detection rule
(SDLCCT-31): anomaly_governance_gap.find_governance_gaps().

Scope: bff/anomaly_governance_gap.py only. get_workspace_daily_costs() is
monkeypatched -- this is a BFF pure-logic test, not a live-backend
integration test (see docs/design/SDLCCT-31.md). registry.get_agent() is
backed by the real seed/catalog.AGENTS data (imported via the
bff/pyproject.toml `../seed` pythonpath entry, with no manual
sys.path.insert needed in this test file).

Covers all 5 Gherkin acceptance criteria.
"""

from datetime import UTC, datetime

import pytest
import registry

import anomaly_governance_gap
from anomaly_governance_gap import GovernanceGapFinding, find_governance_gaps
from opik_metrics import MetricPoint, MissingProjectIdsError

START = datetime(2026, 10, 1, tzinfo=UTC)
END = datetime(2026, 10, 15, tzinfo=UTC)

# The 9 catalog.AGENTS keys, in catalog order.
REGISTERED_KEYS = (
    "maintenance_copilot",
    "quality_rca",
    "procurement_rfq",
    "order_status",
    "supply_risk_monitor",
    "production_scheduler",
    "ehs_qa",
    "quoting_assistant",
)
UNREGISTERED_KEY = "temp_supplier_scraper"
ALL_KEYS = REGISTERED_KEYS + (UNREGISTERED_KEY,)


def test_import_registry_works_via_pythonpath_without_manual_sys_path_insert():
    """Sanity check for the design doc's decision #3: bff/pyproject.toml's
    pythonpath = [".", "../seed"] lets this test file `import registry`
    directly, with no sys.path.insert of its own."""
    assert registry.get_agent(UNREGISTERED_KEY) is not None


def test_unregistered_agent_is_flagged(monkeypatch):
    """AC 1: temp_supplier_scraper (registered=False, owner=None,
    budget=None) is flagged."""
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: {},
    )

    result = find_governance_gaps([UNREGISTERED_KEY], interval_start=START, interval_end=END)

    assert len(result) == 1
    finding = result[0]
    assert finding.key == UNREGISTERED_KEY
    assert finding.display == "臨時供應商爬蟲"
    assert finding.owner is None
    assert finding.budget is None
    assert finding.registered is False


def test_registered_agents_not_flagged_exactly_one_result(monkeypatch):
    """AC 2: the 8 registered Agents (registered, owner set, budget set)
    are never flagged; querying all 9 catalog keys yields exactly the
    1 unregistered-agent finding."""
    calls = []

    def fake_get_costs(project_ids, **kw):
        calls.append(list(project_ids))
        return {}

    monkeypatch.setattr(anomaly_governance_gap, "get_workspace_daily_costs", fake_get_costs)

    result = find_governance_gaps(ALL_KEYS, interval_start=START, interval_end=END)

    assert len(result) == 1
    assert result[0].key == UNREGISTERED_KEY
    # only the flagged subset is sent to the cost endpoint, not all 9 keys
    assert calls == [[UNREGISTERED_KEY]]


def test_registered_agents_alone_yield_no_findings_and_no_cost_call(monkeypatch):
    """AC 2 (explicit): querying only the 8 registered keys flags nothing,
    and get_workspace_daily_costs is never called (empty flagged subset)."""
    calls = []
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: calls.append(list(project_ids)) or {},
    )

    result = find_governance_gaps(REGISTERED_KEYS, interval_start=START, interval_end=END)

    assert result == ()
    assert calls == []


def test_finding_carries_concrete_daily_cost_numbers(monkeypatch):
    """AC 3: output carries concrete daily_costs / first_day_cost /
    last_day_cost numbers, not just a boolean flag."""
    points = (
        MetricPoint(time=datetime(2026, 10, 1, tzinfo=UTC), value=12.5),
        MetricPoint(time=datetime(2026, 10, 2, tzinfo=UTC), value=40.0),
        MetricPoint(time=datetime(2026, 10, 3, tzinfo=UTC), value=55.25),
    )
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: {UNREGISTERED_KEY: points},
    )

    result = find_governance_gaps([UNREGISTERED_KEY], interval_start=START, interval_end=END)

    assert len(result) == 1
    finding = result[0]
    assert finding.daily_costs == points
    assert finding.first_day_cost == 12.5
    assert finding.last_day_cost == 55.25


def test_empty_project_ids_raises_before_any_registry_or_opik_call(monkeypatch):
    """AC 4: project_ids empty -> MissingProjectIdsError, with zero Opik
    calls."""
    calls = []
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: calls.append(list(project_ids)) or {},
    )

    with pytest.raises(MissingProjectIdsError):
        find_governance_gaps([], interval_start=START, interval_end=END)

    assert calls == []


def test_empty_tuple_from_opik_still_produces_a_finding(monkeypatch):
    """AC 5: an empty-tuple (or absent-key) result from Opik does not
    suppress the finding -- daily_costs=() and both cost fields None."""
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: {},  # key absent entirely from the response
    )

    result = find_governance_gaps([UNREGISTERED_KEY], interval_start=START, interval_end=END)

    assert len(result) == 1
    finding = result[0]
    assert isinstance(finding, GovernanceGapFinding)
    assert finding.daily_costs == ()
    assert finding.first_day_cost is None
    assert finding.last_day_cost is None


def test_unknown_key_with_no_registry_record_is_silently_skipped(monkeypatch):
    """Defensive case from the design doc: a key with no registry.get_agent()
    record is skipped, not treated as flagged or raising."""
    monkeypatch.setattr(
        anomaly_governance_gap,
        "get_workspace_daily_costs",
        lambda project_ids, **kw: {},
    )

    result = find_governance_gaps(["does-not-exist"], interval_start=START, interval_end=END)

    assert result == ()
