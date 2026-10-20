"""Business logic for the Budget and savings simulation endpoint
(SDLCCT-46): given a registered-or-not Agent and a target model, computes
the Agent's current blended effective token rate, finds a reference Agent
that is already dominated by target_model, and projects the cost/savings
of switching.

Reuses the sys.path.insert(..., "seed") technique already established by
bff/api/agents.py / bff/api/cost_overview.py, and the same dominant-tag
determination TECHNIQUE as bff/anomaly_model_switch.py::_find_switch_date()
(model: prefix + max-by-count) -- but not the function itself, since that
is a private, non-cross-module-importable helper computing a per-day
series rather than a whole-window single value (see docs/design/
SDLCCT-46.md "現狀查核" and decision #1). See docs/design/SDLCCT-46.md
"介面/API 契約" and "關鍵技術決策" for the exact contract.
"""

import json
import sys
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

_BFF_ROOT = Path(__file__).resolve().parent.parent
_SEED_ROOT = _BFF_ROOT.parent / "seed"
for _path in (_BFF_ROOT, _SEED_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from registry import get_agent, load_registry  # noqa: E402

from anchor import get_anchor_date  # noqa: E402
from opik_metrics import (  # noqa: E402
    Breakdown,
    BreakdownField,
    Interval,
    MetricSeries,
    MetricType,
    get_project_metrics_cached,
)

# Independent vendored copy of seed/catalog.py::HISTORY_DAYS (bff/ and seed/
# are separate packages -- see docs/design/SDLCCT-10.md decision #3, and
# bff/anchor.py for the established precedent of this convention).
HISTORY_DAYS = 30

MODEL_TAG_PREFIX = "model:"

_MODEL_PRICES_SNAPSHOT_PATH = _SEED_ROOT / "model_prices.snapshot.json"


class AgentNotFoundError(ValueError):
    """Raised when `agent_key` is not present in seed/registry.py, or when
    the window query for a given agent_key returns zero usable
    SPAN_TOKEN_USAGE data (see docs/design/SDLCCT-46.md decision #3: both
    are the same "this Agent looks like it doesn't exist" experience to
    the caller, not two separate 404 flavors)."""


class UnknownTargetModelError(ValueError):
    """Raised when `target_model` is not one of the keys in
    seed/model_prices.snapshot.json."""


class NoReferenceAgentForModelError(ValueError):
    """Raised when no registered Agent has `target_model` as its dominant
    model tag in the current window (AC4) -- never silently returns
    0/blank pretending a result was computed."""


def _to_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _load_valid_models() -> set[str]:
    """Read just the key set of seed/model_prices.snapshot.json -- not
    seed/client.py::load_prices(), which raises an uncategorized KeyError
    for an unknown model (see docs/design/SDLCCT-46.md decision #2)."""
    with _MODEL_PRICES_SNAPSHOT_PATH.open(encoding="utf-8") as f:
        return set(json.load(f).keys())


def _dominant_model_tag(trace_count_series: tuple[MetricSeries, ...]) -> str | None:
    """Whole-window version of bff/anomaly_model_switch.py::
    _find_switch_date()'s per-day dominant-tag technique: sum each
    `model:`-prefixed series' points (None contributes 0) across the
    *entire* window into one total per model, then take the model with
    the largest total. Returns None if there is no `model:`-prefixed data
    at all."""
    totals: dict[str, float] = defaultdict(float)
    for s in trace_count_series:
        if not s.key.startswith(MODEL_TAG_PREFIX):
            continue
        model_value = s.key[len(MODEL_TAG_PREFIX):]
        for p in s.points:
            if p.value is not None:
                totals[model_value] += p.value
    if not totals:
        return None
    return max(totals.items(), key=lambda kv: kv[1])[0]


def _effective_rate(
    agent_key: str, *, interval_start: datetime, interval_end: datetime
) -> tuple[float, float]:
    """Return (total_cost, total_tokens) for `agent_key` over the window,
    one Interval.TOTAL batch query each for COST and SPAN_TOKEN_USAGE.
    None points contribute 0 (same convention as bff/api/agents.py::
    _total_cost()). Raises AgentNotFoundError if total_tokens is 0 (see
    decision #3: an all-missing/absent result would otherwise divide by
    zero computing the effective rate; this is NOT the AC5 "query failed"
    case -- the query succeeded and returned an empty/zero result)."""
    cost_map = get_project_metrics_cached(
        [agent_key],
        MetricType.COST,
        interval=Interval.TOTAL,
        interval_start=interval_start,
        interval_end=interval_end,
    )
    tokens_map = get_project_metrics_cached(
        [agent_key],
        MetricType.SPAN_TOKEN_USAGE,
        interval=Interval.TOTAL,
        interval_start=interval_start,
        interval_end=interval_end,
    )
    total_cost = _sum_points(cost_map.get(agent_key, ()))
    total_tokens = _sum_points(tokens_map.get(agent_key, ()))
    if total_tokens == 0:
        raise AgentNotFoundError(
            f"Agent '{agent_key}' has no usable SPAN_TOKEN_USAGE data in the current window"
        )
    return total_cost, total_tokens


def _sum_points(series: tuple[MetricSeries, ...]) -> float:
    total = 0.0
    for s in series:
        for p in s.points:
            if p.value is not None:
                total += p.value
    return total


def simulate_budget(agent_key: str, target_model: str) -> dict:
    """GET /api/budget-simulation business logic. See design doc
    docs/design/SDLCCT-46.md section "介面/API 契約" for the exact
    contract.

    - agent_key not found in the registry -> AgentNotFoundError (404),
      checked before any Opik call is made (same convention as
      bff/api/agent_detail.py::get_agent_cost_breakdown()).
    - target_model not one of the 7 known models -> UnknownTargetModelError
      (400), also checked before any Opik call.
    - Any OpikClientError/OpikConfigError from an underlying query
      propagates unchanged (AC5) -- not caught here.
    """
    if get_agent(agent_key) is None:
        raise AgentNotFoundError(f"Agent '{agent_key}' not found")

    valid_models = _load_valid_models()
    if target_model not in valid_models:
        raise UnknownTargetModelError(f"Unknown target_model '{target_model}'")

    anchor_date = get_anchor_date().date()
    window_start = anchor_date - timedelta(days=HISTORY_DAYS - 1)
    window_end = anchor_date
    interval_start = _to_utc_midnight(window_start)
    interval_end = _to_utc_midnight(window_end + timedelta(days=1))

    own_trace_count_map = get_project_metrics_cached(
        [agent_key],
        MetricType.TRACE_COUNT,
        interval=Interval.TOTAL,
        interval_start=interval_start,
        interval_end=interval_end,
        breakdown=Breakdown(field=BreakdownField.TAGS),
    )
    own_dominant_model = _dominant_model_tag(own_trace_count_map.get(agent_key, ()))

    total_cost, total_tokens = _effective_rate(
        agent_key, interval_start=interval_start, interval_end=interval_end
    )
    current_effective_rate = total_cost / total_tokens

    if own_dominant_model == target_model:
        # AC6 short-circuit: see docs/design/SDLCCT-46.md decision #1 --
        # this guarantees equality as a mathematical fact, independent of
        # AC2's "lexicographically smallest candidate" tie-break, which
        # could otherwise pick a *different* Agent with a different
        # blended rate even though it shares the same dominant model.
        reference_agent_key = agent_key
        target_effective_rate = current_effective_rate
    else:
        registered_keys = sorted(
            r["key"] for r in load_registry() if r["registered"] is True
        )
        trace_count_map = get_project_metrics_cached(
            registered_keys,
            MetricType.TRACE_COUNT,
            interval=Interval.TOTAL,
            interval_start=interval_start,
            interval_end=interval_end,
            breakdown=Breakdown(field=BreakdownField.TAGS),
        )
        reference_agent_key = None
        for key in registered_keys:  # sorted ascending -> first match wins
            if _dominant_model_tag(trace_count_map.get(key, ())) == target_model:
                reference_agent_key = key
                break
        if reference_agent_key is None:
            raise NoReferenceAgentForModelError(
                f"No registered agent found with '{target_model}' as its dominant model"
            )
        ref_cost, ref_tokens = _effective_rate(
            reference_agent_key, interval_start=interval_start, interval_end=interval_end
        )
        target_effective_rate = ref_cost / ref_tokens

    projected_cost = total_tokens * target_effective_rate
    estimated_monthly_savings = (current_effective_rate - target_effective_rate) * total_tokens

    return {
        "agent_key": agent_key,
        "target_model": target_model,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "total_tokens": total_tokens,
        "current_effective_rate": current_effective_rate,
        "target_effective_rate": target_effective_rate,
        "reference_agent_key": reference_agent_key,
        "projected_cost": projected_cost,
        "estimated_monthly_savings": estimated_monthly_savings,
        "is_estimate": True,
        "explanation": (
            "此為混合後的單一 token 有效費率估算(總成本 ÷ 總 token 數),"
            "非依 input/output 個別計價的精確試算。"
        ),
    }
