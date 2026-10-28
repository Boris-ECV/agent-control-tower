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
from anomaly_model_switch import (  # noqa: E402
    MODEL_TAG_PREFIX,
    InsufficientSwitchWindowDataError,
    detect_model_switch,
)
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


def _format_usd(value: float) -> str:
    """Business-language USD formatting shared by reason builders --
    see docs design decision for SDLCCT-65: whole-dollar, thousands
    separator, no decimals (matches SDLCCT-67's US$ display convention)."""
    return f"US$ {round(value):,}"


def _tool_retry_loop_reason(finding: Any) -> str:
    """SDLCCT-65: business-language reason -- no raw field names/thresholds."""
    c = finding.comparison
    error_rate_pct = round(finding.error_rate * 100)
    ratio = round(c.deviation_ratio)
    return (
        f"此 Agent 近期錯誤率與平均工具呼叫次數同時異常升高："
        f"錯誤率約 {error_rate_pct}%，"
        f"平均每筆對話呼叫工具次數較基準值高出約 {ratio} 倍"
        f"（目前約 {c.actual_value:.1f}、基準約 {c.baseline_value:.1f} 次/trace）"
    )


def _context_bloat_reason(finding: Any) -> str:
    """SDLCCT-65: business-language reason -- no raw field names/thresholds."""
    c = finding.comparison
    pct = round(c.deviation_pct)
    actual = round(c.actual_value)
    baseline = round(c.baseline_value)
    return (
        f"此 Agent 近期每筆對話的 prompt token 使用量較過去 {c.baseline_window_days} "
        f"天基準值高出約 {pct}%（目前約 {actual}、基準約 {baseline} tokens/trace）"
    )


def _night_batch_burst_reason(finding: Any) -> str:
    """SDLCCT-65: business-language reason -- no raw field names/thresholds."""
    window_start, window_end = finding.off_hours_window_utc
    ratio = round(finding.ratio)
    reason = (
        f"此 Agent 於非營業時段（UTC {window_start:02d}:00–{window_end:02d}:00）"
        f"出現異常大量請求，約為平時同時段的 {ratio} 倍"
    )
    if finding.corroborating_workflow:
        reason += f"，可能與批次工作流程「{finding.corroborating_workflow}」相關"
    return reason


def _model_switch_reason(finding: Any) -> str:
    """SDLCCT-65: business-language reason -- no raw field names/thresholds."""
    before = finding.before_model_tag.removeprefix(MODEL_TAG_PREFIX)
    after = finding.after_model_tag.removeprefix(MODEL_TAG_PREFIX)
    switch_date = finding.switch_date
    ratio = round(finding.deviation_ratio)
    return (
        f"模型於 {switch_date.month}/{switch_date.day} 由 {before} 切換為 {after}，"
        f"成本偏離正常值約 {ratio} 倍"
    )


def _governance_gap_reason(finding: Any) -> str:
    """SDLCCT-65: business-language reason -- no raw field names/thresholds."""
    cost_str = "未知" if finding.last_day_cost is None else _format_usd(finding.last_day_cost)
    return f"此 Agent 尚未登錄負責人與預算，過去一日花費約 {cost_str}"


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
