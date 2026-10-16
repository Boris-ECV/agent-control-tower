"""Tests for the vendored demo anchor-date configuration in bff/anchor.py
(SDLCCT-9 contract, independent copy per docs/design/SDLCCT-10.md decision #3).

Scope: bff/anchor.py only -- reads DEMO_ANCHOR_DATE from the environment,
no backend connection. Mirrors seed/tests/test_anchor.py's coverage.
"""

from datetime import UTC, datetime

import pytest

from anchor import ANCHOR_ENV_VAR, DEFAULT_ANCHOR_DATE, InvalidAnchorDateError, get_anchor_date


def test_unset_env_var_returns_default_anchor_date(monkeypatch):
    """AC2 (unset branch): DEMO_ANCHOR_DATE 未設定時回傳預設值 2026-10-15."""
    monkeypatch.delenv(ANCHOR_ENV_VAR, raising=False)

    result = get_anchor_date()

    assert result == datetime(2026, 10, 15, tzinfo=UTC)
    assert result == datetime.combine(DEFAULT_ANCHOR_DATE, datetime.min.time(), tzinfo=UTC)


def test_empty_env_var_returns_default_anchor_date(monkeypatch):
    """AC2 (empty-string branch): 空字串視同未設定."""
    monkeypatch.setenv(ANCHOR_ENV_VAR, "")

    result = get_anchor_date()

    assert result == datetime(2026, 10, 15, tzinfo=UTC)


def test_valid_override_returns_that_date_at_utc_midnight(monkeypatch):
    """AC3: 設定為合法 ISO 日期字串時，回傳該日期的 UTC 00:00:00."""
    monkeypatch.setenv(ANCHOR_ENV_VAR, "2027-01-02")

    result = get_anchor_date()

    assert result == datetime(2027, 1, 2, tzinfo=UTC)


def test_invalid_format_raises_invalid_anchor_date_error(monkeypatch):
    """AC4: 設定為無法解析的字串時，拋出 InvalidAnchorDateError，不回退預設值."""
    monkeypatch.setenv(ANCHOR_ENV_VAR, "not-a-date")

    with pytest.raises(InvalidAnchorDateError):
        get_anchor_date()


def test_return_type_is_utc_aware_datetime_at_midnight(monkeypatch):
    """AC1: 回傳值一律是帶 tzinfo=UTC、時間部分為 00:00:00 的 datetime."""
    monkeypatch.setenv(ANCHOR_ENV_VAR, "2026-12-31")

    result = get_anchor_date()

    assert isinstance(result, datetime)
    assert result.tzinfo == UTC
    assert result.hour == 0
    assert result.minute == 0
    assert result.second == 0
    assert result.microsecond == 0
