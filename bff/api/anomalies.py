"""Business logic for the unified Anomaly feed endpoint (SDLCCT-51, split
from SDLCCT-45): runs all 5 approved anomaly rules (SDLCCT-27/28/29/30/31)
across the full Agent registry and combines them into a single response.

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/agents.py/bff/api/cost_overview.py to import registry.load_registry(),
and the same anchor.get_anchor_date() this bff already uses everywhere else.

See docs/design/SDLCCT-51.md "介面/API 契約" and "關鍵技術決策" for the exact
contract and the reasoning behind each decision below -- in particular:
decision #1 (catch Exception per rule call, never let one rule's failure
502 the whole request -- AC6), decision #3 (the `date` key is always
present, `null` when unknown, uniformly across all 5 anomaly_type values
and status="error" rows), decision #4 (`agent` is null for a failed
find_governance_gaps() batch call, since that call has no single Agent to
attribute the failure to), and decision #5 (one shared interval_start/
interval_end window, reusing the existing 22-day convention established by
anomaly_context_bloat.py and friends -- not a new window).

See also docs/design/SDLCCT-69.md for the "insufficient data is not an
error" exception classification: `_run_target_date_rule`/`_run_model_switch`
catch a deliberate tuple of "cannot compute, not a rule-engine failure"
exception types BEFORE the generic `except Exception` below, returning `[]`
(no row) instead of a `status="error"` row.
"""

import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

_BFF_ROOT = Path(__file__).resolve().parent.parent
_SEED_ROOT = _BFF_ROOT.parent / "seed"
for _path in (_BFF_ROOT, _SEED_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from registry import load_registry  # noqa: E402

from anchor import get_anchor_date  # noqa: E402
from anomaly_context_bloat import detect_context_bloat  # noqa: E402
from anomaly_governance_gap import find_governance_gaps  # noqa: E402
from anomaly_model_switch import InsufficientSwitchWindowDataError, detect_model_switch  # noqa: E402
from anomaly_night_batch_burst import detect_night_batch_burst  # noqa: E402
from anomaly_tool_retry_loop import MissingErrorRateDataError, detect_tool_retry_loop  # noqa: E402
from baseline import InsufficientBaselineDataError  # noqa: E402

# Reuses the existing, already-validated window convention established by
# bff/tests/test_anomaly_context_bloat.py and friends: 21-day baseline +
# target_date itself (see design doc decision #5) -- not a new window
# invented for this endpoint.
_WINDOW_DAYS = 22

# SDLCCT-69: these two exception classes are the deliberate "cannot
# compute, not a rule-engine failure" signal (see docs/design/SDLCCT-69.md
# decision #1) for the 3 target_date rules (tool_retry_loop raises both;
# context_bloat raises only InsufficientBaselineDataError via
# compare_to_baseline(); night_batch_burst raises neither, so these
# branches are simply never hit for it). If a 4th "insufficient data"
# exception class is introduced in the future, it must be added here
# manually -- see design doc decision #1 for why there is no shared base
# class to catch instead.
_NORMAL_RULE_NO_DATA_ERRORS = (InsufficientBaselineDataError, MissingErrorRateDataError)


def _to_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _tool_retry_loop_reason(finding: Any) -> str:
    c = finding.comparison
    return (
        f"error_rate={finding.error_rate} (threshold={finding.error_rate_threshold}), "
        f"spans/trace deviation_ratio={c.deviation_ratio} "
        f"(baseline={c.baseline_value}, actual={c.actual_value}, "
        f"ratio_threshold={finding.ratio_threshold})"
    )


def _context_bloat_reason(finding: Any) -> str:
    c = finding.comparison
    return (
        f"tokens/trace deviation_ratio={c.deviation_ratio} "
        f"(baseline={c.baseline_value}, actual={c.actual_value}, "
        f"threshold={finding.deviation_threshold})"
    )


def _night_batch_burst_reason(finding: Any) -> str:
    return (
        f"off_hours_window_utc={finding.off_hours_window_utc}, ratio={finding.ratio} "
        f"(off_hours_trace_count={finding.off_hours_trace_count}, "
        f"baseline_hourly_rate={finding.baseline_hourly_rate}, "
        f"ratio_threshold={finding.ratio_threshold}), "
        f"corroborating_workflow={finding.corroborating_workflow!r}"
    )


def _model_switch_reason(finding: Any) -> str:
    return (
        f"model switched from {finding.before_model_tag} to {finding.after_model_tag} "
        f"on {finding.switch_date}, deviation_ratio={finding.deviation_ratio} "
        f"(threshold={finding.deviation_threshold})"
    )


def _governance_gap_reason(finding: Any) -> str:
    return (
        f"registered={finding.registered}, owner={finding.owner!r}, "
        f"budget={finding.budget!r}, first_day_cost={finding.first_day_cost!r}, "
        f"last_day_cost={finding.last_day_cost!r}"
    )


def _row(*, agent: str | None, anomaly_type: str, row_date: date | None, status: str, reason: str) -> dict:
    """Build one `anomalies[]` row. `date` key is always present (never
    omitted) regardless of value -- see design doc decision #3."""
    return {
        "agent": agent,
        "anomaly_type": anomaly_type,
        "date": row_date.isoformat() if row_date is not None else None,
        "status": status,
        "reason": reason,
    }


def get_anomaly_feed() -> dict:
    """GET /api/anomalies business logic. See design doc
    docs/design/SDLCCT-51.md section "介面/API 契約" for the exact
    contract."""
    anchor_dt = get_anchor_date()
    anchor_date = anchor_dt.date()
    target_date = anchor_date
    interval_start = _to_utc_midnight(target_date - timedelta(days=_WINDOW_DAYS))
    interval_end = _to_utc_midnight(target_date)

    registry_records = load_registry()
    registered_keys = [r["key"] for r in registry_records if r["registered"] is True]
    all_keys = [r["key"] for r in registry_records]

    anomalies: list[dict] = []

    for key in registered_keys:
        anomalies.extend(
            _run_target_date_rule(
                key,
                anomaly_type="tool_retry_loop",
                target_date=target_date,
                interval_start=interval_start,
                interval_end=interval_end,
                detect_fn=detect_tool_retry_loop,
                reason_fn=_tool_retry_loop_reason,
            )
        )
        anomalies.extend(
            _run_target_date_rule(
                key,
                anomaly_type="context_bloat",
                target_date=target_date,
                interval_start=interval_start,
                interval_end=interval_end,
                detect_fn=detect_context_bloat,
                reason_fn=_context_bloat_reason,
            )
        )
        anomalies.extend(
            _run_target_date_rule(
                key,
                anomaly_type="night_batch_burst",
                target_date=target_date,
                interval_start=interval_start,
                interval_end=interval_end,
                detect_fn=detect_night_batch_burst,
                reason_fn=_night_batch_burst_reason,
            )
        )
        anomalies.extend(
            _run_model_switch(
                key,
                interval_start=interval_start,
                interval_end=interval_end,
            )
        )

    anomalies.extend(
        _run_governance_gaps(
            all_keys,
            interval_start=interval_start,
            interval_end=interval_end,
        )
    )

    return {
        "anchor_date": anchor_date.isoformat(),
        "anomalies": anomalies,
    }


def _run_target_date_rule(
    key: str,
    *,
    anomaly_type: str,
    target_date: date,
    interval_start: datetime,
    interval_end: datetime,
    detect_fn,
    reason_fn,
) -> list[dict]:
    """AC1/AC2/AC6 for the 3 "normal" target_date rules (tool_retry_loop/
    context_bloat/night_batch_burst): one call per rule per registered
    Agent, each independently wrapped in try/except Exception so one
    rule/Agent failure never drops the rest (AC6/AC7)."""
    try:
        finding = detect_fn(
            key,
            target_date=target_date,
            interval_start=interval_start,
            interval_end=interval_end,
        )
    except _NORMAL_RULE_NO_DATA_ERRORS:
        return []  # SDLCCT-69 AC1/AC2: insufficient data -> treat as "no anomaly", not an error row
    except Exception as exc:  # noqa: BLE001 -- AC6: any OTHER rule exception, not a specific family
        return [
            _row(
                agent=key,
                anomaly_type=anomaly_type,
                row_date=None,
                status="error",
                reason=str(exc),
            )
        ]

    if not finding.is_anomalous:
        return []  # AC2: not anomalous -> no row

    return [
        _row(
            agent=key,
            anomaly_type=anomaly_type,
            row_date=target_date,
            status="ok",
            reason=reason_fn(finding),
        )
    ]


def _run_model_switch(key: str, *, interval_start: datetime, interval_end: datetime) -> list[dict]:
    """AC3/AC4/AC6 for model_switch: self-date rule (switch_date, not
    target_date), one call per registered Agent."""
    try:
        finding = detect_model_switch(
            key,
            interval_start=interval_start,
            interval_end=interval_end,
        )
    except InsufficientSwitchWindowDataError:
        return []  # SDLCCT-69 AC3: insufficient switch-window data -> no row
    except Exception as exc:  # noqa: BLE001 -- AC6
        return [
            _row(
                agent=key,
                anomaly_type="model_switch",
                row_date=None,
                status="error",
                reason=str(exc),
            )
        ]

    if finding.switch_date is None or not finding.is_anomalous:
        return []  # AC4: no switch_date -> no row

    return [
        _row(
            agent=key,
            anomaly_type="model_switch",
            row_date=finding.switch_date,
            status="ok",
            reason=_model_switch_reason(finding),
        )
    ]


def _run_governance_gaps(
    all_keys: list[str], *, interval_start: datetime, interval_end: datetime
) -> list[dict]:
    """AC5/AC6/AC7: find_governance_gaps() is a single batch call across
    all registry keys (registered + unregistered), called exactly once.
    A failure here has no single Agent to attribute it to, so `agent` is
    null (design doc decision #4)."""
    try:
        findings = find_governance_gaps(
            all_keys,
            interval_start=interval_start,
            interval_end=interval_end,
        )
    except Exception as exc:  # noqa: BLE001 -- AC6
        return [
            _row(
                agent=None,
                anomaly_type="governance_gap",
                row_date=None,
                status="error",
                reason=str(exc),
            )
        ]

    return [
        _row(
            agent=finding.key,
            anomaly_type="governance_gap",
            row_date=None,  # AC5: date is always null for governance_gap
            status="ok",
            reason=_governance_gap_reason(finding),
        )
        for finding in findings
    ]
