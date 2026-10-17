"""Tests for client.py's pure helpers and the base_url() required-env-var contract (SDLCCT-24).

Scope: seed/client.py's iso(), uuid7_at(), load_prices() and base_url() only
(see docs/design/SDLCCT-24.md). save()/load()/project_ids()/api() are
exercised indirectly by other tests (test_registry.py, test_generate_guard.py)
or intentionally left out of this story's scope. Covers all 6 Gherkin
acceptance criteria from the design doc.
"""

import random
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal

import pytest

import client
from client import base_url, iso, load_prices, uuid7_at

# --- AC1: iso() ---------------------------------------------------------


def test_iso_formats_example_datetime_to_millisecond_utc_z_string():
    """AC1: 帶時區的 datetime 轉為毫秒精度、Z 結尾的 UTC ISO8601 字串."""
    ts = datetime(2024, 1, 15, 10, 30, 0, 123456, tzinfo=timezone(timedelta(hours=9)))

    result = iso(ts)

    assert result == "2024-01-15T01:30:00.123Z"


def test_iso_round_trips_via_fromisoformat():
    """AC1: 結果可用 fromisoformat 解析回等值的（截斷到毫秒的）UTC datetime."""
    ts = datetime(2024, 1, 15, 10, 30, 0, 123456, tzinfo=timezone(timedelta(hours=9)))

    result = iso(ts)
    parsed = datetime.fromisoformat(result)

    expected = ts.astimezone(UTC).replace(microsecond=123000)
    assert parsed == expected


# --- AC2: uuid7_at() -----------------------------------------------------


def _gap_pairs():
    """50 組固定種子隨機 (ts1, gap_ms) 配對，gap_ms >= 2ms 避開浮點截斷邊界."""
    rng = random.Random(20241024)
    base = datetime(2024, 1, 1, tzinfo=UTC)
    pairs = []
    for _ in range(50):
        offset_ms = rng.randint(0, 10_000_000)
        ts1 = base + timedelta(milliseconds=offset_ms)
        gap_ms = rng.randint(2, 5000)
        pairs.append((ts1, gap_ms))
    return pairs


@pytest.mark.parametrize("ts1,gap_ms", _gap_pairs())
def test_uuid7_at_is_lexicographically_increasing_with_time(ts1, gap_ms):
    """AC2: 傳入較晚的時間時，uuid7_at() 回傳值字典序較大，不因隨機位元翻轉."""
    ts2 = ts1 + timedelta(milliseconds=gap_ms)

    uuid1 = uuid7_at(ts1)
    uuid2 = uuid7_at(ts2)

    assert uuid1 < uuid2


# --- AC3: load_prices() ---------------------------------------------------


def test_load_prices_reads_real_snapshot_and_returns_decimal_tuple():
    """AC3: 正確解析 model_prices.snapshot.json，回傳值為 Decimal 而非 float."""
    result = load_prices(["claude-sonnet-4-5"])

    assert result == {"claude-sonnet-4-5": (Decimal("0.000003"), Decimal("0.000015"))}
    input_cost, output_cost = result["claude-sonnet-4-5"]
    assert isinstance(input_cost, Decimal)
    assert isinstance(output_cost, Decimal)


# --- AC4 + AC5: base_url() required-env-var contract -----------------------


def _forbid_httpx_client(monkeypatch):
    """Actively prove base_url() never constructs an httpx.Client (no network I/O)."""

    def _must_not_construct(*_args, **_kwargs):
        raise AssertionError("must not construct httpx.Client")

    monkeypatch.setattr(client.httpx, "Client", _must_not_construct)


def test_base_url_raises_system_exit_when_unset(monkeypatch):
    """AC4: OPIK_BASE_URL 未設定時以 SystemExit 失敗，且不送出任何網路請求."""
    monkeypatch.delenv("OPIK_BASE_URL", raising=False)
    _forbid_httpx_client(monkeypatch)

    with pytest.raises(SystemExit, match="OPIK_BASE_URL is not set"):
        base_url()


@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_base_url_raises_system_exit_when_blank(monkeypatch, value):
    """AC5: OPIK_BASE_URL 為空字串或僅含空白時同樣以 SystemExit 失敗."""
    monkeypatch.setenv("OPIK_BASE_URL", value)
    _forbid_httpx_client(monkeypatch)

    with pytest.raises(SystemExit, match="OPIK_BASE_URL is not set"):
        base_url()


def test_base_url_returns_value_with_trailing_slash_stripped(monkeypatch):
    """AC6: 設定有效值時原樣回傳，去除尾端斜線."""
    monkeypatch.setenv("OPIK_BASE_URL", "https://example.com/api/")

    result = base_url()

    assert result == "https://example.com/api"
