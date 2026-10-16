"""Guard tests for seed/generate.py::main()'s existing-data overwrite protection
(SDLCCT-23).

These tests call `generate.main()` directly (no subprocess, no CliRunner) with
`sys.argv` monkeypatched, and fake out `generate.api`/`generate.project_ids`/
`generate.post_all` (the names `generate.py` binds into its own module
namespace via `from ... import`) plus `client.OUT_DIR` (so `save()` never
writes to the real `seed/out/`). No real HTTP calls are made, no backend
connection or environment variable is required.

Scope: the four Gherkin ACs of `main()`'s write-guard branch only -- `main()`
itself, `catalog.py` scenario content, manifest/row content, and
`generate()`/`Collector`/`cohorts()` are out of scope (see
docs/design/SDLCCT-23.md).
"""

import sys

import client
import generate
from catalog import AGENTS

ANCHOR = "2026-01-01"
EXISTING_KEY = AGENTS[0].key


def _run(monkeypatch, tmp_path, argv_tail, existing):
    """Run generate.main() with api/project_ids/post_all faked out and OUT_DIR
    redirected to tmp_path. Returns (returncode, api_calls, project_ids_calls,
    post_all_calls), each a list of (args, kwargs) tuples recording every call.
    """
    api_calls: list[tuple[tuple, dict]] = []
    project_ids_calls: list[tuple[tuple, dict]] = []
    post_all_calls: list[tuple[tuple, dict]] = []

    def fake_api(*args, **kwargs):
        api_calls.append((args, kwargs))
        return "FAKE_CLIENT"

    def fake_project_ids(*args, **kwargs):
        project_ids_calls.append((args, kwargs))
        return {EXISTING_KEY: "fake-project-id"} if existing else {}

    def fake_post_all(*args, **kwargs):
        post_all_calls.append((args, kwargs))

    monkeypatch.setattr(generate, "api", fake_api)
    monkeypatch.setattr(generate, "project_ids", fake_project_ids)
    monkeypatch.setattr(generate, "post_all", fake_post_all)
    monkeypatch.setattr(client, "OUT_DIR", tmp_path)
    monkeypatch.setattr(sys, "argv", ["generate.py", "--anchor", ANCHOR, *argv_tail])

    returncode = generate.main()

    return returncode, api_calls, project_ids_calls, post_all_calls


def test_dry_run_without_write_never_calls_api_project_ids_or_post_all(monkeypatch, tmp_path):
    """Scenario: 無 --write,只落 dry-run manifest,api/project_ids/post_all 皆未被呼叫."""
    returncode, api_calls, project_ids_calls, post_all_calls = _run(
        monkeypatch, tmp_path, [], existing=False
    )

    assert returncode == 0
    assert api_calls == []
    assert project_ids_calls == []
    assert post_all_calls == []


def test_existing_project_without_force_refuses_to_write(monkeypatch, tmp_path):
    """Scenario: 有既存 project、未帶 --force,回傳碼 2,post_all 未被呼叫."""
    returncode, api_calls, project_ids_calls, post_all_calls = _run(
        monkeypatch, tmp_path, ["--write"], existing=True
    )

    assert returncode == 2
    assert len(api_calls) == 1
    assert len(project_ids_calls) == 1
    assert post_all_calls == []


def test_existing_project_with_force_writes_traces_and_spans_once_each(monkeypatch, tmp_path):
    """Scenario: 有既存 project、帶 --force,回傳碼 0,post_all 對 traces/spans 各呼叫一次."""
    returncode, api_calls, project_ids_calls, post_all_calls = _run(
        monkeypatch, tmp_path, ["--write", "--force"], existing=True
    )

    assert returncode == 0
    assert len(api_calls) == 1
    assert len(project_ids_calls) == 1
    assert len(post_all_calls) == 2

    traces_call, spans_call = post_all_calls
    traces_args, traces_kwargs = traces_call
    spans_args, spans_kwargs = spans_call

    assert traces_args[1] == "/v1/private/traces/batch"
    assert traces_args[2] == "traces"
    assert traces_kwargs["label"] == "traces"

    assert spans_args[1] == "/v1/private/spans/batch"
    assert spans_args[2] == "spans"
    assert spans_kwargs["label"] == "spans"


def test_force_without_existing_project_is_a_no_op(monkeypatch, tmp_path):
    """Scenario: 無既存 project、帶 --force,no-op,行為與不帶 --force 相同."""
    returncode_no_force, _, _, post_all_calls_no_force = _run(
        monkeypatch, tmp_path, ["--write"], existing=False
    )
    returncode_force, _, _, post_all_calls_force = _run(
        monkeypatch, tmp_path, ["--write", "--force"], existing=False
    )

    assert returncode_no_force == returncode_force == 0

    def call_shape(calls):
        return [(args[1], args[2], kwargs.get("label")) for args, kwargs in calls]

    assert call_shape(post_all_calls_no_force) == call_shape(post_all_calls_force)
    assert len(post_all_calls_no_force) == len(post_all_calls_force) == 2
