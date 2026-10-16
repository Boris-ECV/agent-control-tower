"""Generate the manufacturing demo data set deterministically; optionally write it into Opik.

    uv run python generate.py              # dry run: compute everything, write only out/manifest_dryrun.json
    uv run python generate.py --write      # write into Opik and save out/manifest.json (ground truth)
"""

import argparse
import random
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from catalog import (
    AGENTS,
    COST_CENTERS,
    HISTORY_DAYS,
    INCIDENTS,
    MODELS,
    SCALE,
    SEED,
    Agent,
)
from client import api, iso, load_prices, project_ids, save, uuid7_at
from ingest import post_all


@dataclass(frozen=True)
class Cohort:
    count: int
    model: str
    calls: int
    prompt: int
    completion: int
    version: str
    hours: tuple[int, int]
    workflow: str
    trigger: str
    tools: tuple[str, ...] = ()
    steps: tuple[str, ...] = ()
    loop: bool = False
    error_rate: float = 0.0


@dataclass
class Stats:
    cost: Decimal = Decimal(0)
    traces: int = 0
    spans: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


def day_count(a: Agent, d: int, day0: datetime, rng: random.Random) -> int:
    if a.key == "temp_supplier_scraper":
        return 0 if d > 12 else round(30 + 120 * (12 - d) / 11)
    factor = a.weekend if day0.weekday() >= 5 else 1.0
    jit = rng.uniform(0.9, 1.1) if a.jitter else 1.0
    return max(1, round(a.base_traces * factor * jit))


def cohorts(a: Agent, d: int, n: int) -> list[Cohort]:
    base = Cohort(n, a.model, a.calls, a.prompt, a.completion, a.version, a.hours, a.workflow, a.trigger)
    if a.key == "quality_rca" and d <= 6:
        loops = round(n * 0.15)
        return [replace(base, count=n - loops, version="v3.1"),
                replace(base, count=loops, version="v3.1", calls=45, prompt=a.prompt * 3 // 2, loop=True,
                        error_rate=0.2, tools=("query_spc",), steps=("analyze_defect_retry",))]
    if a.key == "maintenance_copilot" and d <= 14:
        return [replace(base, version="v1.8", prompt=round(a.prompt * (1 + 2 * (14 - d) / 13)))]
    if a.key == "order_status" and d <= 9:
        return [replace(base, model="claude-sonnet-4-5", version="v2.0")]
    if a.key == "procurement_rfq" and d == 4:
        burst = replace(base, count=600, calls=10, prompt=8000, completion=500, hours=(17, 19),
                        workflow="rfq_batch_rerun", trigger="scheduler")
        return [base, burst]
    return [base]


class Collector:
    def __init__(self, scale: int, prices):
        self.scale = scale
        self.prices = prices
        self.traces: list[dict] = []
        self.spans: list[dict] = []
        self.daily = defaultdict(lambda: defaultdict(Stats))              # project -> date -> Stats
        self.by_model = defaultdict(lambda: defaultdict(lambda: defaultdict(Stats)))  # project -> model -> date
        self.by_version = defaultdict(lambda: defaultdict(lambda: defaultdict(Stats)))
        self.by_plant = defaultdict(lambda: defaultdict(lambda: defaultdict(Stats)))
        self.hourly = defaultdict(lambda: defaultdict(Decimal))           # project -> hour -> cost

    def jitter(self, rng: random.Random, tokens: int) -> int:
        return max(1, round(tokens * self.scale * rng.uniform(0.92, 1.08)))

    def emit(self, a: Agent, co: Cohort, start: datetime, rng: random.Random):
        plant = rng.choice(("台中廠", "高雄廠"))
        inp, out = a.io(rng, plant)
        date = start.date().isoformat()
        trace_id, root_id = uuid7_at(start), uuid7_at(start)
        provider = MODELS[co.model]
        p_in, p_out = self.prices[co.model]
        tools, steps = co.tools or a.tools, co.steps or a.llm_steps
        failed = co.loop and rng.random() < co.error_rate
        err = {"exception_type": "MaxIterationsExceeded", "traceback": "Traceback (most recent call last): ...",
               "message": f"tool '{tools[0]}' called {co.calls} times without convergence"}

        cursor = start + timedelta(milliseconds=80)
        children: list[dict] = []
        t_cost, t_pt, t_ct = Decimal(0), 0, 0
        for k in range(co.calls):
            if tools:
                dur = rng.uniform(0.4, 1.8)
                children.append(self._span(a, trace_id, root_id, tools[k % len(tools)], "tool", cursor, dur))
                cursor += timedelta(seconds=dur)
            pt, ct = self.jitter(rng, co.prompt), self.jitter(rng, co.completion)
            dur = 1.0 + pt / 25000 + ct / 90
            cost = p_in * pt + p_out * ct
            span = self._span(a, trace_id, root_id, steps[k % len(steps)], "llm", cursor, dur)
            span.update(model=co.model, provider=provider,
                        usage={"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct})
            if failed and k == co.calls - 1:
                span["error_info"] = err
            children.append(span)
            cursor += timedelta(seconds=dur)
            t_cost += cost
            t_pt += pt
            t_ct += ct
            m = self.by_model[a.key][co.model][date]
            m.cost += cost
            m.calls += 1
            m.spans += 1
            m.prompt_tokens += pt
            m.completion_tokens += ct

        end = cursor + timedelta(milliseconds=200)
        root = self._span(a, trace_id, root_id, co.workflow, "general", start, (end - start).total_seconds())
        root["parent_span_id"] = None
        self.spans.append(root)
        self.spans.extend(children)
        trace = {
            "id": trace_id, "project_name": a.key, "name": co.workflow, "start_time": iso(start), "end_time": iso(end),
            "input": inp, "output": out,
            "metadata": {"plant": plant, "deployed_version": co.version, "cost_center": COST_CENTERS[a.dept_code],
                         "workflow": co.workflow, "trigger": co.trigger, "dept": a.dept},
            "tags": ["env:prod", f"team:{a.dept_code}", f"model:{co.model}"],
        }
        if failed:
            trace["error_info"] = err
        self.traces.append(trace)

        n_spans = len(children) + 1
        d = self.daily[a.key][date]
        d.cost += t_cost
        d.traces += 1
        d.spans += n_spans
        d.calls += co.calls
        d.prompt_tokens += t_pt
        d.completion_tokens += t_ct
        for bucket, key in ((self.by_version, co.version), (self.by_plant, plant)):
            s = bucket[a.key][key][date]
            s.cost += t_cost
            s.traces += 1
        self.hourly[a.key][iso(start.replace(minute=0, second=0, microsecond=0))] += t_cost

    @staticmethod
    def _span(a, trace_id, parent_id, name, kind, start, seconds) -> dict:
        return {"id": uuid7_at(start), "project_name": a.key, "trace_id": trace_id, "parent_span_id": parent_id,
                "name": name, "type": kind, "start_time": iso(start),
                "end_time": iso(start + timedelta(seconds=seconds)), "input": {"step": name}, "output": {"ok": True}}


def generate(anchor: datetime, scale: int) -> tuple[Collector, dict]:
    prices = load_prices(MODELS)
    col = Collector(scale, prices)
    for d in range(HISTORY_DAYS, 0, -1):
        day0 = anchor - timedelta(days=d)
        for a in AGENTS:
            rng = random.Random(f"{SEED}|{a.key}|{d}")
            n = day_count(a, d, day0, rng)
            for co in cohorts(a, d, n) if n else []:
                window_end = min(co.hours[1] * 3600, 86400 - 900)
                width = window_end - co.hours[0] * 3600
                slot = width / co.count
                for i in range(co.count):
                    offset = co.hours[0] * 3600 + (i + rng.random()) * slot
                    col.emit(a, co, day0 + timedelta(seconds=offset), rng)

    def dump(tree):
        return {k: {d: _stats(s) for d, s in v.items()} for k, v in tree.items()}

    manifest = {
        "anchor": iso(anchor), "scale": scale, "seed": SEED, "history_days": HISTORY_DAYS,
        "totals": {"traces": len(col.traces), "spans": len(col.spans)},
        "incidents": list(INCIDENTS),
        "registry": [{"project": a.key, "display": a.display, "dept": a.dept, "dept_code": a.dept_code,
                      "owner": a.owner, "budget_usd": a.budget, "registered": a.registered,
                      "cost_center": COST_CENTERS[a.dept_code]} for a in AGENTS],
        "projects": {
            a.key: {
                "daily": {d: _stats(s) for d, s in sorted(col.daily[a.key].items())},
                "by_model": dump(col.by_model[a.key]),
                "by_version": dump(col.by_version[a.key]),
                "by_plant": dump(col.by_plant[a.key]),
                "hourly_cost": {h: str(c) for h, c in sorted(col.hourly[a.key].items())},
            } for a in AGENTS
        },
    }
    return col, manifest


def _stats(s: Stats) -> dict:
    d = asdict(s)
    d["cost"] = str(s.cost)
    return d


def summarize(col: Collector, manifest: dict) -> None:
    print(f"\ntraces={manifest['totals']['traces']:,} spans={manifest['totals']['spans']:,} scale=x{manifest['scale']}")
    print(f"{'agent':<24}{'traces':>8}{'spans':>9}{'30d cost':>11}{'budget':>9}{'%':>7}")
    reg = fleet = 0.0
    budget = 0.0
    for a in AGENTS:
        days = col.daily[a.key].values()
        cost = float(sum(s.cost for s in days))
        tr, sp = sum(s.traces for s in days), sum(s.spans for s in days)
        pct = f"{cost / a.budget * 100:5.0f}%" if a.budget else "   n/a"
        print(f"{a.key:<24}{tr:>8,}{sp:>9,}{cost:>11,.2f}{(a.budget or 0):>9,.0f}{pct:>7}")
        fleet += cost
        if a.registered:
            reg += cost
            budget += a.budget
    print(f"registered agents: ${reg:,.2f} vs budget ${budget:,.0f} ({reg / budget * 100 - 100:+.0f}%)")
    print(f"including unregistered: ${fleet:,.2f} ({fleet / budget * 100 - 100:+.0f}% vs budget)")
    per_day: dict[str, float] = defaultdict(float)
    for a in AGENTS:
        for d, s in col.daily[a.key].items():
            per_day[d] += float(s.cost)
    top = sorted(per_day.items(), key=lambda kv: -kv[1])[:5]
    print("top fleet days:", ", ".join(f"{d} ${v:,.0f}" for d, v in top))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--anchor", help="demo 'today' (UTC date, YYYY-MM-DD); default is today")
    ap.add_argument("--scale", type=int, default=SCALE)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--force", action="store_true", help="write even if the agent projects already exist")
    args = ap.parse_args()

    now = datetime.now(UTC)
    anchor = (datetime.fromisoformat(args.anchor).replace(tzinfo=UTC) if args.anchor
              else now.replace(hour=0, minute=0, second=0, microsecond=0))
    col, manifest = generate(anchor, args.scale)
    summarize(col, manifest)

    if not args.write:
        print("->", save("manifest_dryrun", manifest))
        return 0

    c = api()
    existing = set(project_ids(c)) & {a.key for a in AGENTS}
    if existing and not args.force:
        print(f"refusing to write: projects already exist: {sorted(existing)}")
        return 2
    col.traces.sort(key=lambda t: t["start_time"])
    col.spans.sort(key=lambda s: s["start_time"])
    post_all(c, "/v1/private/traces/batch", "traces", col.traces, label="traces")
    post_all(c, "/v1/private/spans/batch", "spans", col.spans, label="spans")
    print("->", save("manifest", manifest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
