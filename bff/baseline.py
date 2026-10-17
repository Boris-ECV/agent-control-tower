"""Day-over-day baseline comparison helper (SDLCCT-27): a pure function,
no I/O, no Opik-specific concepts -- reusable by any future anomaly rule
that needs to compare an actual value against a trailing N-day baseline.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta


class InsufficientBaselineDataError(ValueError):
    """Raised by compare_to_baseline() when there is no usable data to
    compute a meaningful comparison:
    - the target_date itself has no value (missing key or None), or
    - zero days in the baseline window have a non-None value
      (baseline_days_used == 0), or
    - the baseline average is exactly 0 (deviation ratio undefined --
      division by zero).
    compare_to_baseline() never performs I/O, so this is always a
    caller-side/data-contract issue, never a backend failure -- there is
    deliberately no fallback to 0 or a guessed ratio (see decision below
    for why this is a new class, not a reused bff.opik_metrics exception).
    """


@dataclass(frozen=True)
class BaselineComparison:
    target_date: date
    baseline_window_days: int
    baseline_days_used: int
    baseline_value: float
    actual_value: float
    deviation_ratio: float
    deviation_pct: float


def compare_to_baseline(
    daily_values: Mapping[date, float | None],
    target_date: date,
    baseline_window_days: int,
) -> BaselineComparison:
    """Compare daily_values[target_date] against the average of the
    baseline_window_days calendar dates immediately BEFORE target_date
    (target_date itself is never part of its own baseline).

    - A date missing from daily_values, or present with value None, is
      treated as "no data for that date" -- never coerced to 0.
    - baseline_days_used counts only the baseline-window dates that have
      a non-None value; baseline_value is their average.
    - Raises InsufficientBaselineDataError if: target_date has no usable
      value, baseline_days_used == 0, or baseline_value == 0. Never
      returns a BaselineComparison with a 0/guessed baseline_value or
      deviation_ratio in these cases.
    - deviation_ratio = actual_value / baseline_value;
      deviation_pct = (deviation_ratio - 1.0) * 100.0.
    """
    if baseline_window_days <= 0:
        raise ValueError("baseline_window_days must be positive")

    actual_value = daily_values.get(target_date)
    if actual_value is None:
        raise InsufficientBaselineDataError(
            f"no usable value for target_date={target_date} (missing or null)"
        )

    baseline_dates = [target_date - timedelta(days=d) for d in range(1, baseline_window_days + 1)]
    baseline_points = [
        v for d in baseline_dates if (v := daily_values.get(d)) is not None
    ]
    baseline_days_used = len(baseline_points)
    if baseline_days_used == 0:
        raise InsufficientBaselineDataError(
            f"no usable baseline data in the {baseline_window_days}-day "
            f"window before {target_date}"
        )

    baseline_value = sum(baseline_points) / baseline_days_used
    if baseline_value == 0:
        raise InsufficientBaselineDataError(
            f"baseline_value is 0 over {baseline_days_used} day(s): "
            "deviation ratio is undefined"
        )

    deviation_ratio = actual_value / baseline_value
    return BaselineComparison(
        target_date=target_date,
        baseline_window_days=baseline_window_days,
        baseline_days_used=baseline_days_used,
        baseline_value=baseline_value,
        actual_value=actual_value,
        deviation_ratio=deviation_ratio,
        deviation_pct=(deviation_ratio - 1.0) * 100.0,
    )
