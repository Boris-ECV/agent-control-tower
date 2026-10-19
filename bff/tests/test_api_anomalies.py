"""Tests for the unified Anomaly feed endpoint (SDLCCT-51, split from
SDLCCT-45): api/app.py's GET /api/anomalies + api/anomalies.py.

Scope: this is a BFF pure-logic test (consistent with the other
bff/tests/test_api_*.py files) -- the 5 underlying rule functions
(detect_tool_retry_loop/detect_context_bloat/detect_night_batch_burst/
detect_model_switch/find_governance_gaps) are monkeypatched on the
api.anomalies module; this does not re-test each rule's own internal
logic (already covered by bff/tests/test_anomaly_*.py), only the
aggregation/combination contract in docs/design/SDLCCT-51.md.

Covers all 7 Gherkin acceptance criteria.
"""

from datetime import date

from fastapi.testclient import TestClient

import api.anomalies as anomalies_module
from anchor import DEFAULT_ANCHOR_DATE
from anomaly_context_bloat import ContextBloatFinding
from anomaly_governance_gap import GovernanceGapFinding
from anomaly_model_switch import ModelSwitchFinding
from anomaly_night_batch_burst import NightBatchBurstFinding
from anomaly_tool_retry_loop import ToolRetryLoopFinding
from api.app import app
from baseline import BaselineComparison

client = TestClient(app)

ANCHOR_DATE = DEFAULT_ANCHOR_DATE  # date(2026, 10, 15)
ANCHOR_DATE_ISO = ANCHOR_DATE.isoformat()

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


def _not_anomalous_context_bloat(project_id, **kw):
    return ContextBloatFinding(
        project_id=project_id,
        is_anomalous=False,
        deviation_threshold=1.30,
        comparison=BaselineComparison(
            target_date=ANCHOR_DATE,
            baseline_window_days=21,
            baseline_days_used=21,
            baseline_value=100.0,
            actual_value=100.0,
            deviation_ratio=1.0,
            deviation_pct=0.0,
        ),
    )


def _not_anomalous_tool_retry_loop(project_id, **kw):
    return ToolRetryLoopFinding(
        project_id=project_id,
        is_anomalous=False,
        co_occurred=False,
        ratio_threshold=1.5,
        error_rate_threshold=0.01,
        error_rate=0.0,
        comparison=BaselineComparison(
            target_date=ANCHOR_DATE,
            baseline_window_days=21,
            baseline_days_used=21,
            baseline_value=1.0,
            actual_value=1.0,
            deviation_ratio=1.0,
            deviation_pct=0.0,
        ),
    )


def _not_anomalous_night_batch_burst(project_id, **kw):
    return NightBatchBurstFinding(
        project_id=project_id,
        is_anomalous=False,
        ratio_threshold=10.0,
        off_hours_window_utc=(17, 19),
        off_hours_trace_count=1,
        baseline_hourly_rate=1.0,
        ratio=1.0,
        corroborating_workflow=None,
    )


def _no_switch_model_switch(project_id, **kw):
    return ModelSwitchFinding(
        project_id=project_id,
        is_anomalous=False,
        deviation_threshold=3.0,
        switch_date=None,
        before_model_tag=None,
        after_model_tag=None,
        before_cost_per_trace=None,
        after_cost_per_trace=None,
        deviation_ratio=None,
    )


def _patch_all_no_findings(monkeypatch):
    monkeypatch.setattr(anomalies_module, "detect_tool_retry_loop", _not_anomalous_tool_retry_loop)
    monkeypatch.setattr(anomalies_module, "detect_context_bloat", _not_anomalous_context_bloat)
    monkeypatch.setattr(anomalies_module, "detect_night_batch_burst", _not_anomalous_night_batch_burst)
    monkeypatch.setattr(anomalies_module, "detect_model_switch", _no_switch_model_switch)
    monkeypatch.setattr(anomalies_module, "find_governance_gaps", lambda *a, **kw: ())


def test_ac2_normal_rules_not_anomalous_emit_no_rows(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    resp = client.get("/api/anomalies")
    assert resp.status_code == 200
    body = resp.json()
    assert body["anchor_date"] == ANCHOR_DATE_ISO
    assert body["anomalies"] == []


def test_ac1_normal_rule_anomalous_emits_one_row_with_target_date(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    def anomalous_context_bloat(project_id, *, target_date, **kw):
        if project_id != "maintenance_copilot":
            return _not_anomalous_context_bloat(project_id, target_date=target_date, **kw)
        return ContextBloatFinding(
            project_id=project_id,
            is_anomalous=True,
            deviation_threshold=1.30,
            comparison=BaselineComparison(
                target_date=target_date,
                baseline_window_days=21,
                baseline_days_used=21,
                baseline_value=100.0,
                actual_value=200.0,
                deviation_ratio=2.0,
                deviation_pct=100.0,
            ),
        )

    monkeypatch.setattr(anomalies_module, "detect_context_bloat", anomalous_context_bloat)

    resp = client.get("/api/anomalies")
    assert resp.status_code == 200
    rows = resp.json()["anomalies"]

    assert len(rows) == 1
    row = rows[0]
    assert row["agent"] == "maintenance_copilot"
    assert row["anomaly_type"] == "context_bloat"
    assert row["date"] == ANCHOR_DATE_ISO
    assert row["status"] == "ok"
    assert "2.0" in row["reason"]


def test_ac3_model_switch_with_switch_date_and_anomalous_emits_one_row(monkeypatch):
    _patch_all_no_findings(monkeypatch)
    switch_date = date(2026, 9, 28)

    def switched(project_id, **kw):
        if project_id != "quality_rca":
            return _no_switch_model_switch(project_id, **kw)
        return ModelSwitchFinding(
            project_id=project_id,
            is_anomalous=True,
            deviation_threshold=3.0,
            switch_date=switch_date,
            before_model_tag="model:gpt-cheap",
            after_model_tag="model:gpt-expensive",
            before_cost_per_trace=0.01,
            after_cost_per_trace=0.05,
            deviation_ratio=5.0,
        )

    monkeypatch.setattr(anomalies_module, "detect_model_switch", switched)

    resp = client.get("/api/anomalies")
    rows = resp.json()["anomalies"]

    assert len(rows) == 1
    row = rows[0]
    assert row["agent"] == "quality_rca"
    assert row["anomaly_type"] == "model_switch"
    assert row["date"] == switch_date.isoformat()
    assert row["status"] == "ok"
    assert "model:gpt-cheap" in row["reason"]
    assert "model:gpt-expensive" in row["reason"]
    assert "5.0" in row["reason"]


def test_ac4_model_switch_with_no_switch_date_emits_no_row(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    resp = client.get("/api/anomalies")
    rows = resp.json()["anomalies"]
    assert [r for r in rows if r["anomaly_type"] == "model_switch"] == []


def test_ac5_governance_gaps_flagged_subset_emits_rows_with_null_date(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    finding = GovernanceGapFinding(
        key=UNREGISTERED_KEY,
        display="Temp Supplier Scraper",
        owner=None,
        budget=None,
        registered=False,
        daily_costs=(),
        first_day_cost=None,
        last_day_cost=None,
    )
    monkeypatch.setattr(anomalies_module, "find_governance_gaps", lambda *a, **kw: (finding,))

    resp = client.get("/api/anomalies")
    rows = resp.json()["anomalies"]

    gov_rows = [r for r in rows if r["anomaly_type"] == "governance_gap"]
    assert len(gov_rows) == 1
    row = gov_rows[0]
    assert row["agent"] == UNREGISTERED_KEY
    assert "date" in row  # key always present
    assert row["date"] is None
    assert row["status"] == "ok"
    assert "registered=False" in row["reason"]


def test_ac6_rule_exception_emits_explicit_error_row_and_other_agents_continue(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    def flaky_tool_retry_loop(project_id, **kw):
        if project_id == "procurement_rfq":
            raise ValueError("boom: no usable baseline data")
        return _not_anomalous_tool_retry_loop(project_id, **kw)

    monkeypatch.setattr(anomalies_module, "detect_tool_retry_loop", flaky_tool_retry_loop)

    resp = client.get("/api/anomalies")
    assert resp.status_code == 200  # AC6: single rule failure never 502s the whole request
    rows = resp.json()["anomalies"]

    error_rows = [r for r in rows if r["status"] == "error"]
    assert len(error_rows) == 1
    row = error_rows[0]
    assert row["agent"] == "procurement_rfq"
    assert row["anomaly_type"] == "tool_retry_loop"
    assert row["date"] is None
    assert row["reason"] == "boom: no usable baseline data"

    # Other 7 registered agents' tool_retry_loop calls were unaffected (no
    # row each, since _not_anomalous_tool_retry_loop returns is_anomalous=False)
    # and no other anomaly_type was dropped.
    assert [r for r in rows if r["anomaly_type"] != "tool_retry_loop"] == []


def test_ac6_governance_gap_batch_failure_emits_error_row_with_null_agent(monkeypatch):
    _patch_all_no_findings(monkeypatch)

    def raiser(*a, **kw):
        raise RuntimeError("opik backend unavailable")

    monkeypatch.setattr(anomalies_module, "find_governance_gaps", raiser)

    resp = client.get("/api/anomalies")
    assert resp.status_code == 200
    rows = resp.json()["anomalies"]

    assert len(rows) == 1
    row = rows[0]
    assert row["agent"] is None
    assert row["anomaly_type"] == "governance_gap"
    assert row["date"] is None
    assert row["status"] == "error"
    assert row["reason"] == "opik backend unavailable"


def test_ac7_coverage_one_call_per_rule_per_registered_agent_and_one_batch_governance_call(monkeypatch):
    calls = {
        "tool_retry_loop": [],
        "context_bloat": [],
        "night_batch_burst": [],
        "model_switch": [],
        "governance_gap": [],
    }

    def tracked_tool_retry_loop(project_id, **kw):
        calls["tool_retry_loop"].append(project_id)
        return _not_anomalous_tool_retry_loop(project_id, **kw)

    def tracked_context_bloat(project_id, **kw):
        calls["context_bloat"].append(project_id)
        return _not_anomalous_context_bloat(project_id, **kw)

    def tracked_night_batch_burst(project_id, **kw):
        calls["night_batch_burst"].append(project_id)
        return _not_anomalous_night_batch_burst(project_id, **kw)

    def tracked_model_switch(project_id, **kw):
        calls["model_switch"].append(project_id)
        return _no_switch_model_switch(project_id, **kw)

    def tracked_governance_gaps(project_ids, **kw):
        calls["governance_gap"].append(tuple(project_ids))
        return ()

    monkeypatch.setattr(anomalies_module, "detect_tool_retry_loop", tracked_tool_retry_loop)
    monkeypatch.setattr(anomalies_module, "detect_context_bloat", tracked_context_bloat)
    monkeypatch.setattr(anomalies_module, "detect_night_batch_burst", tracked_night_batch_burst)
    monkeypatch.setattr(anomalies_module, "detect_model_switch", tracked_model_switch)
    monkeypatch.setattr(anomalies_module, "find_governance_gaps", tracked_governance_gaps)

    resp = client.get("/api/anomalies")
    assert resp.status_code == 200

    # Each of the 4 target_date/self-date rules called exactly once per
    # registered Agent (8 registered Agents; unregistered Agent excluded).
    for rule in ("tool_retry_loop", "context_bloat", "night_batch_burst", "model_switch"):
        assert sorted(calls[rule]) == sorted(REGISTERED_KEYS), rule
        assert len(calls[rule]) == len(REGISTERED_KEYS), rule

    # find_governance_gaps called exactly once, as a single batch across
    # ALL Agent ids (registered + unregistered).
    assert len(calls["governance_gap"]) == 1
    assert sorted(calls["governance_gap"][0]) == sorted(ALL_KEYS)
