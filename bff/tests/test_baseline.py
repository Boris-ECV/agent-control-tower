"""Tests for the pure baseline-comparison helper (SDLCCT-27).

Scope: bff/baseline.py's compare_to_baseline() -- a pure function, no I/O,
no Opik-specific concepts. Covers AC1 (correct computation), AC5
(explicit failure on insufficient/zero baseline data, never a guessed
number) and AC6 (threshold boundary at the compare_to_baseline() level --
is_anomalous itself is anomaly_context_bloat.py's concern and is covered
there).
"""

from datetime import date, timedelta

import pytest

from baseline import InsufficientBaselineDataError, compare_to_baseline

TARGET = date(2026, 10, 15)


def _flat_baseline(value: float, *, window_days: int = 21, target: date = TARGET) -> dict:
    """window_days calendar dates immediately before target, all == value."""
    return {target - timedelta(days=d): value for d in range(1, window_days + 1)}


# AC1: pure function correctly computes baseline/actual/deviation -- the
# exact example given in the design doc: 21 days all == 100, target == 135.
def test_ac1_flat_baseline_example_from_design_doc():
    daily_values = _flat_baseline(100.0)
    daily_values[TARGET] = 135.0

    result = compare_to_baseline(daily_values, TARGET, baseline_window_days=21)

    assert result.target_date == TARGET
    assert result.baseline_window_days == 21
    assert result.baseline_days_used == 21
    assert result.baseline_value == pytest.approx(100.0)
    assert result.actual_value == pytest.approx(135.0)
    assert result.deviation_ratio == pytest.approx(1.35)
    assert result.deviation_pct == pytest.approx(35.0)


def test_ac1_baseline_days_used_counts_only_non_none_values_in_window():
    daily_values = _flat_baseline(100.0)
    # Knock out 5 of the 21 baseline days (missing key / None value).
    missing_dates = [TARGET - timedelta(days=d) for d in (1, 2, 3)]
    for d in missing_dates:
        del daily_values[d]
    none_dates = [TARGET - timedelta(days=d) for d in (4, 5)]
    for d in none_dates:
        daily_values[d] = None
    daily_values[TARGET] = 120.0

    result = compare_to_baseline(daily_values, TARGET, baseline_window_days=21)

    assert result.baseline_days_used == 16
    assert result.baseline_value == 100.0
    assert result.actual_value == 120.0
    assert result.deviation_ratio == pytest.approx(1.2)
    assert result.deviation_pct == pytest.approx(20.0)


def test_ac1_baseline_window_excludes_target_date_itself():
    # If target_date's own value leaked into its baseline average, the
    # baseline would be pulled toward 135 and deviation would be
    # under-estimated. Confirm it is not.
    daily_values = _flat_baseline(100.0)
    daily_values[TARGET] = 135.0

    result = compare_to_baseline(daily_values, TARGET, baseline_window_days=21)

    assert result.baseline_value == 100.0  # not (100*21+135)/22


# AC5: insufficient/zero baseline data raises InsufficientBaselineDataError,
# never returns a guessed/zero BaselineComparison.
def test_ac5_missing_target_date_raises():
    daily_values = _flat_baseline(100.0)  # no TARGET key at all

    with pytest.raises(InsufficientBaselineDataError):
        compare_to_baseline(daily_values, TARGET, baseline_window_days=21)


def test_ac5_none_target_date_value_raises():
    daily_values = _flat_baseline(100.0)
    daily_values[TARGET] = None

    with pytest.raises(InsufficientBaselineDataError):
        compare_to_baseline(daily_values, TARGET, baseline_window_days=21)


def test_ac5_zero_baseline_days_used_raises():
    # target_date has a value, but nothing at all in the baseline window.
    daily_values = {TARGET: 50.0}

    with pytest.raises(InsufficientBaselineDataError):
        compare_to_baseline(daily_values, TARGET, baseline_window_days=21)


def test_ac5_zero_baseline_value_raises():
    daily_values = _flat_baseline(0.0)
    daily_values[TARGET] = 10.0

    with pytest.raises(InsufficientBaselineDataError):
        compare_to_baseline(daily_values, TARGET, baseline_window_days=21)


def test_baseline_window_days_must_be_positive():
    daily_values = _flat_baseline(100.0)
    daily_values[TARGET] = 100.0

    with pytest.raises(ValueError):
        compare_to_baseline(daily_values, TARGET, baseline_window_days=0)
