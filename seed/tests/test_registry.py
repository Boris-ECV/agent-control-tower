"""Tests for the agent registry store (SDLCCT-12).

Scope: seed/registry.py only -- registry seed data is read directly from
catalog.AGENTS (no backend connection, no environment variables). Anomaly
detection, budget-overrun alerts and write/update APIs are out of scope
(see docs/design/SDLCCT-12.md).
"""

from catalog import AGENTS
from registry import FIELDS, export_registry, get_agent, load_registry


def test_load_registry_returns_all_nine_agents_with_full_fields():
    """Scenario: 讀取 registry 回傳全部 9 個 Agent 及其完整欄位."""
    records = load_registry()

    assert len(records) == 9
    assert len(AGENTS) == 9

    for record in records:
        assert set(record.keys()) == set(FIELDS)

    by_key = {record["key"]: record for record in records}
    for agent in AGENTS:
        record = by_key[agent.key]
        assert record["key"] == agent.key
        assert record["display"] == agent.display
        assert record["dept"] == agent.dept
        assert record["dept_code"] == agent.dept_code
        assert record["owner"] == agent.owner
        assert record["budget"] == agent.budget


def test_temp_supplier_scraper_is_an_unregistered_governance_gap():
    """Scenario: 可查詢並區分出「有花費但未登錄」的治理缺口案例（temp_supplier_scraper）."""
    record = get_agent("temp_supplier_scraper")

    assert record is not None
    assert record["registered"] is False
    assert record["owner"] is None
    assert record["budget"] is None
    assert record["dept"] == "未登錄"
    assert record["dept_code"] == "none"


def test_a_registered_agent_has_registered_true():
    """Scenario (same scenario, registered contrast case): 查詢其他任一已登錄 Agent 時 registered 為 true."""
    record = get_agent("maintenance_copilot")

    assert record is not None
    assert record["registered"] is True


def test_get_agent_returns_none_for_unknown_key():
    assert get_agent("no_such_agent") is None


def test_export_is_sourced_from_catalog_not_hand_maintained(tmp_path, monkeypatch):
    """Scenario: registry 的種子資料是由 catalog.py 匯出而非手動重複維護.

    Compares load_registry()'s output against catalog.AGENTS directly (not
    against a separately hand-written expected list), and exercises the
    export mechanism end-to-end via export_registry() -> seed/out/registry.json.
    """
    import client

    monkeypatch.setattr(client, "OUT_DIR", tmp_path)
    import registry as registry_module

    monkeypatch.setattr(registry_module, "save", client.save)

    path = export_registry()

    assert path == tmp_path / "registry.json"
    assert path.exists()

    import json

    exported = json.loads(path.read_text(encoding="utf-8"))

    assert len(exported) == len(AGENTS) == 9
    for entry, agent in zip(exported, AGENTS, strict=True):
        assert entry["key"] == agent.key
        assert entry["display"] == agent.display
        assert entry["dept"] == agent.dept
        assert entry["dept_code"] == agent.dept_code
        assert entry["owner"] == agent.owner
        assert entry["budget"] == agent.budget
        assert entry["registered"] == agent.registered


def test_load_registry_reflects_catalog_changes(monkeypatch):
    """If catalog.AGENTS changes, re-running load_registry() reflects the new values
    (load_registry is a pure projection, not a separately maintained copy)."""
    from dataclasses import replace

    import catalog

    changed = tuple(replace(a, owner="測試新任") if a.key == "maintenance_copilot" else a for a in AGENTS)
    monkeypatch.setattr(catalog, "AGENTS", changed)
    import registry as registry_module

    monkeypatch.setattr(registry_module, "AGENTS", changed)

    record = get_agent("maintenance_copilot")
    assert record["owner"] == "測試新任"
