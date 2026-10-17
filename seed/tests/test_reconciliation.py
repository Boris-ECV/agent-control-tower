"""Reconciliation integration tests against a live Opik backend (SDLCCT-8).

These tests compare numbers the backend actually returns with a dry-run
manifest freshly produced by `generate.generate(anchor, scale)` (no CLI, no
`seed/out/` files). They require a real backend: skipped entirely, with no
HTTP request attempted, whenever `OPIK_BASE_URL` is not set.

Scope: daily cost, by-version/by-plant/by-model cost breakdowns, the
nightly-batch hourly shape (`procurement_rfq`), and the error-rate pattern
(`quality_rca`), each reconciled against the manifest; plus a latency check
that is independent of (and does not influence, nor is influenced by) the
correctness checks. Out of scope (see docs/design/SDLCCT-8.md): writes/
deletes against the backend, generator scenario content, host performance
tuning, trace-count/top-trace/span-tree reconciliation, running this file in
CI, and `preflight.py`.
"""

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest

from catalog import SCALE
from client import api, iso, project_ids
from generate import generate
from verify import SLOW_MS, TIMINGS, TOL_DAY, TOL_TOTAL, by_day, metric, parse, series_totals, timed

# Scenario: 未設定 OPIK_BASE_URL 時乾淨略過. This is a pure string check (never
# `client.base_url()`, which raises SystemExit and would turn this into an
# ERROR instead of a SKIPPED), and it runs before any fixture in this module
# is instantiated, so no HTTP request is ever attempted when unset.
pytestmark = pytest.mark.skipif(
    not os.environ.get("OPIK_BASE_URL", "").strip(),
    reason="OPIK_BASE_URL not set",
)

PROCUREMENT_PROJECT = "procurement_rfq"
ERROR_PROJECT = "quality_rca"

QUERY_LABELS = (
    "workspace_costs_daily",
    "cost_by_version",
    "cost_by_plant",
    "cost_by_model",
    "cost_hourly_nightly_batch",
    "error_rate",
)


@dataclass
class TimedResult:
    response: httpx.Response | None
    elapsed_ms: float | None
    error: Exception | None


def _anchor() -> datetime:
    """Default matches generate.py's own CLI default: today's UTC midnight."""
    value = os.environ.get("OPIK_SEED_ANCHOR", "").strip()
    if value:
        return datetime.fromisoformat(value).replace(tzinfo=UTC)
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _scale() -> int:
    value = os.environ.get("OPIK_SEED_SCALE", "").strip()
    return int(value) if value else SCALE


@pytest.fixture(scope="module")
def manifest():
    _, manifest = generate(_anchor(), _scale())
    return manifest


@pytest.fixture(scope="module")
def opik_client():
    return api()


@pytest.fixture(scope="module")
def project_id_map(opik_client):
    return project_ids(opik_client)


def _hourly_query(c, pid, manifest):
    hourly = manifest["projects"][PROCUREMENT_PROJECT]["hourly_cost"]
    peak_hour = max(hourly, key=lambda h: Decimal(hourly[h]))
    window_start = parse(peak_hour) - timedelta(hours=3)
    return metric(c, pid[PROCUREMENT_PROJECT], "COST", window_start, window_start + timedelta(hours=6), "HOURLY")


@pytest.fixture(scope="module")
def backend_queries(opik_client, project_id_map, manifest):
    """Query every reconciliation scenario exactly once and cache
    (response, elapsed_ms, error) per label. Correctness tests read only
    `.response`; the latency test reads only `.elapsed_ms` -- no asserts here,
    so neither kind of test can affect the other's result.
    """
    c = opik_client
    pid = {k: project_id_map[k] for k in (PROCUREMENT_PROJECT, ERROR_PROJECT) if k in project_id_map}

    anchor = parse(manifest["anchor"])
    start, end = anchor - timedelta(days=manifest["history_days"] + 1), anchor

    queries = {
        "workspace_costs_daily": lambda: c.post(
            "/v1/private/workspaces/costs",
            json={"project_ids": [pid[PROCUREMENT_PROJECT]], "interval_start": iso(start), "interval_end": iso(end)},
        ),
        "cost_by_version": lambda: metric(
            c, pid[PROCUREMENT_PROJECT], "COST", start, end, "TOTAL",
            {"field": "metadata", "metadata_key": "deployed_version"},
        ),
        "cost_by_plant": lambda: metric(
            c, pid[PROCUREMENT_PROJECT], "COST", start, end, "TOTAL",
            {"field": "metadata", "metadata_key": "plant"},
        ),
        "cost_by_model": lambda: metric(c, pid[PROCUREMENT_PROJECT], "COST", start, end, "TOTAL", {"field": "tags"}),
        "cost_hourly_nightly_batch": lambda: _hourly_query(c, pid, manifest),
        "error_rate": lambda: metric(c, pid[ERROR_PROJECT], "TRACE_ERROR_RATE", start, end, "DAILY"),
    }

    results: dict[str, TimedResult] = {}
    for label, fn in queries.items():
        try:
            response = timed(label, fn)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            results[label] = TimedResult(None, TIMINGS.get(label), exc)
        else:
            results[label] = TimedResult(response, TIMINGS[label], None)
    return results


def test_daily_cost_reconciles_with_manifest(backend_queries, manifest, project_id_map):
    """Scenario: 各專案每日成本對帳."""
    result = backend_queries["workspace_costs_daily"]
    assert result.error is None
    assert result.response.status_code == 200

    got = by_day(result.response.json())
    have = got.get(project_id_map[PROCUREMENT_PROJECT], {})
    expected = {day: float(stats["cost"]) for day, stats in manifest["projects"][PROCUREMENT_PROJECT]["daily"].items()}
    mismatches = {day: (have.get(day, 0), cost) for day, cost in expected.items() if abs(have.get(day, 0) - cost) > TOL_DAY}
    assert not mismatches


def test_cost_by_version_and_plant_reconciles_with_manifest(backend_queries, manifest):
    """Scenario: 依版本與依廠區（plant）的成本對帳."""
    for label, tree in (("cost_by_version", "by_version"), ("cost_by_plant", "by_plant")):
        result = backend_queries[label]
        assert result.error is None, label
        assert result.response.status_code == 200, label

        got_totals = series_totals(result.response.json())
        expected_totals = {
            key: sum(float(stats["cost"]) for stats in days.values())
            for key, days in manifest["projects"][PROCUREMENT_PROJECT][tree].items()
        }
        assert set(expected_totals) <= set(got_totals), (label, got_totals)
        mismatches = {k: (got_totals[k], v) for k, v in expected_totals.items() if abs(got_totals[k] - v) > TOL_TOTAL}
        assert not mismatches, (label, mismatches)


def test_cost_by_model_reconciles_with_manifest(backend_queries, manifest):
    """Scenario: 依模型的成本對帳."""
    result = backend_queries["cost_by_model"]
    assert result.error is None
    assert result.response.status_code == 200

    got_totals = series_totals(result.response.json())
    expected_totals = {
        f"model:{model}": sum(float(stats["cost"]) for stats in days.values())
        for model, days in manifest["projects"][PROCUREMENT_PROJECT]["by_model"].items()
    }
    mismatches = {
        tag: (got_totals.get(tag), value)
        for tag, value in expected_totals.items()
        if abs(got_totals.get(tag, float("-inf")) - value) > TOL_TOTAL
    }
    assert not mismatches


def test_nightly_batch_hourly_cost_reconciles_with_manifest(backend_queries, manifest):
    """Scenario: 夜間批次時段分布對帳."""
    result = backend_queries["cost_hourly_nightly_batch"]
    assert result.error is None
    assert result.response.status_code == 200

    hourly = manifest["projects"][PROCUREMENT_PROJECT]["hourly_cost"]
    peak_hour = max(hourly, key=lambda h: Decimal(hourly[h]))
    window_start = parse(peak_hour) - timedelta(hours=3)
    window_end = window_start + timedelta(hours=6)

    points = {p["time"][:13]: p["value"] or 0 for res in result.response.json().get("results", []) for p in res["data"]}
    expected = {h[:13]: float(v) for h, v in hourly.items() if window_start <= parse(h) < window_end}
    mismatches = {h: (points.get(h, 0), v) for h, v in expected.items() if abs(points.get(h, 0) - v) > TOL_DAY}
    assert not mismatches


def test_error_rate_pattern_reconciles_with_manifest(backend_queries, manifest):
    """Scenario: 錯誤率型態對帳."""
    result = backend_queries["error_rate"]
    assert result.error is None
    assert result.response.status_code == 200

    anchor = parse(manifest["anchor"])
    rates = {p["time"][:10]: p["value"] or 0 for res in result.response.json().get("results", []) for p in res["data"]}
    loop_days = [d for d in rates if (anchor - parse(d + "T00:00:00Z")).days <= 6]
    clean_days = [d for d in rates if (anchor - parse(d + "T00:00:00Z")).days > 6]

    assert all(rates[d] == 0 for d in clean_days)
    assert sum(1 for d in loop_days if rates[d] > 0) >= 4


@pytest.mark.parametrize("label", QUERY_LABELS)
def test_query_latency_is_under_threshold(backend_queries, label):
    """Scenario: 延遲檢查與正確性檢查可分開判讀.

    Reads only `elapsed_ms` from the cached query result -- never the
    response body -- so this test's PASS/FAIL cannot be affected by, and
    cannot affect, any of the correctness tests above sharing the same
    cached query.
    """
    result = backend_queries[label]
    assert result.error is None, f"{label} failed to connect: {result.error}"
    assert result.elapsed_ms is not None
    assert result.elapsed_ms < SLOW_MS, f"{label} took {result.elapsed_ms} ms"
