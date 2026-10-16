"""Reconcile Opik's numbers with out/manifest.json and time the queries the portal screens will need."""

import json
import sys
import time
from datetime import datetime, timedelta
from decimal import Decimal

from client import api, iso, load, project_ids, save

TOL_DAY = 1e-7
TOL_TOTAL = 1e-5
SLOW_MS = 3000


class Report:
    def __init__(self, title):
        self.items = []
        print(f"\n=== {title} ===")

    def check(self, cid, desc, ok, detail=""):
        self.items.append({"id": cid, "desc": desc, "result": "PASS" if ok else "FAIL", "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {cid} {desc}" + (f" -- {detail}" if detail else ""))

    def note(self, cid, desc, detail=""):
        self.items.append({"id": cid, "desc": desc, "result": "NOTE", "detail": detail})
        print(f"[NOTE] {cid} {desc}" + (f" -- {detail}" if detail else ""))

    def failed(self):
        return sum(1 for i in self.items if i["result"] == "FAIL")


TIMINGS: dict[str, float] = {}


def timed(label, fn):
    t0 = time.perf_counter()
    out = fn()
    TIMINGS[label] = round((time.perf_counter() - t0) * 1000)
    return out


def parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def by_day(resp_json):
    out = {}
    for res in resp_json.get("results") or []:
        out[res.get("project_id") or res.get("name")] = {p["time"][:10]: (p["value"] or 0) for p in res["data"]}
    return out


def series_totals(resp_json):
    return {r["name"]: sum((p["value"] or 0) for p in r["data"]) for r in resp_json.get("results") or []}


def metric(c, pid, mt, start, end, interval="DAILY", breakdown=None):
    body = {"metric_type": mt, "interval": interval, "interval_start": iso(start), "interval_end": iso(end)}
    if breakdown:
        body["breakdown"] = breakdown
    return c.post(f"/v1/private/projects/{pid}/metrics", json=body)


def main() -> int:
    r = Report("Phase 1 reconciliation")
    c = api()
    m = load("manifest")
    anchor = parse(m["anchor"])
    start, end = anchor - timedelta(days=m["history_days"] + 1), anchor
    ids = project_ids(c)
    keys = [p["project"] for p in m["registry"]]
    r.check("P.1", "all agent projects exist", all(k in ids for k in keys), f"missing={[k for k in keys if k not in ids]}")
    pid = {k: ids[k] for k in keys if k in ids}

    # Wait for the writes to become visible.
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        counts = {k: c.get("/v1/private/traces", params={"project_name": k, "size": 1}).json().get("total", 0) for k in pid}
        if sum(counts.values()) >= m["totals"]["traces"]:
            break
        time.sleep(5)
    for k in keys:
        exp = sum(s["traces"] for s in m["projects"][k]["daily"].values())
        r.check(f"P.2.{k}", "trace count equals manifest", counts.get(k) == exp, f"got={counts.get(k)} expected={exp}")

    # Daily cost per project (workspace endpoint with explicit project ids).
    body = {"project_ids": list(pid.values()), "interval_start": iso(start), "interval_end": iso(end)}
    resp = timed("workspace_costs_daily_9_projects", lambda: c.post("/v1/private/workspaces/costs", json=body))
    got = by_day(resp.json()) if resp.status_code == 200 else {}
    for k in keys:
        exp = {d: float(s["cost"]) for d, s in m["projects"][k]["daily"].items()}
        have = got.get(pid[k], {})
        bad = {d: (have.get(d, 0), e) for d, e in exp.items() if abs(have.get(d, 0) - e) > TOL_DAY}
        r.check(f"V.cost.{k}", "daily cost equals manifest", resp.status_code == 200 and not bad,
                f"mismatches={dict(list(bad.items())[:2])}")

    # Per-project totals and counts through projects/stats.
    resp = timed("projects_stats_30d", lambda: c.get("/v1/private/projects/stats", params={
        "size": 100, "from_time": iso(start), "to_time": iso(end)}))
    stats = {x["project_id"]: x for x in resp.json().get("content", [])} if resp.status_code == 200 else {}
    for k in keys:
        exp = sum(float(s["cost"]) for s in m["projects"][k]["daily"].values())
        have = stats.get(pid[k], {}).get("total_estimated_cost_sum")
        r.check(f"V.stats.{k}", "projects/stats cost sum equals manifest", have is not None and abs(have - exp) < TOL_TOTAL,
                f"got={have} expected={exp:.6f}")

    # Breakdowns: version, plant (metadata keys), model (tag), per project.
    for k in keys:
        for field, key, tree, label in (("metadata", "deployed_version", "by_version", "version"),
                                        ("metadata", "plant", "by_plant", "plant")):
            resp = timed(f"cost_by_{label}", lambda k=k, field=field, key=key: metric(
                c, pid[k], "COST", start, end, "TOTAL", {"field": field, "metadata_key": key}))
            got_t = series_totals(resp.json()) if resp.status_code == 200 else {}
            exp_t = {v: sum(float(s["cost"]) for s in days.values()) for v, days in m["projects"][k][tree].items()}
            ok = resp.status_code == 200 and set(exp_t) <= set(got_t) and all(abs(got_t[v] - exp_t[v]) < TOL_TOTAL for v in exp_t)
            r.check(f"V.{label}.{k}", f"cost by {label} equals manifest", ok, f"got={got_t} expected={ {a: round(b, 4) for a, b in exp_t.items()} }")
        resp = metric(c, pid[k], "COST", start, end, "TOTAL", {"field": "tags"})
        got_t = series_totals(resp.json()) if resp.status_code == 200 else {}
        exp_t = {f"model:{mo}": sum(float(s["cost"]) for s in days.values()) for mo, days in m["projects"][k]["by_model"].items()}
        ok = resp.status_code == 200 and all(abs(got_t.get(t, -1) - v) < TOL_TOTAL for t, v in exp_t.items())
        r.check(f"V.model.{k}", "cost by model tag equals manifest", ok, f"got={ {a: round(b, 4) for a, b in got_t.items() if a.startswith('model:')} }")

    # Hourly shape of the night burst.
    hourly = m["projects"]["procurement_rfq"]["hourly_cost"]
    peak_hour = max(hourly, key=lambda h: Decimal(hourly[h]))
    h0 = parse(peak_hour) - timedelta(hours=3)
    resp = timed("cost_hourly_6h", lambda: metric(c, pid["procurement_rfq"], "COST", h0, h0 + timedelta(hours=6), "HOURLY"))
    pts = {p["time"][:13]: p["value"] or 0 for res in resp.json().get("results", []) for p in res["data"]} if resp.status_code == 200 else {}
    exp_h = {h[:13]: float(v) for h, v in hourly.items() if h0 <= parse(h) < h0 + timedelta(hours=6)}
    r.check("V.hourly", "hourly cost around the night burst equals manifest",
            resp.status_code == 200 and all(abs(pts.get(h, 0) - v) < TOL_DAY for h, v in exp_h.items()), f"peak={peak_hour}")

    # Error pattern for the retry-loop incident.
    resp = metric(c, pid["quality_rca"], "TRACE_ERROR_RATE", start, end, "DAILY")
    rates = {p["time"][:10]: p["value"] or 0 for res in resp.json().get("results", []) for p in res["data"]} if resp.status_code == 200 else {}
    loop_days = [d for d in rates if (anchor - parse(d + "T00:00:00Z")).days <= 6]
    clean_days = [d for d in rates if (anchor - parse(d + "T00:00:00Z")).days > 6]
    r.check("V.errors", "error rate is zero before v3.1 and positive during the loop days",
            resp.status_code == 200 and all(rates[d] == 0 for d in clean_days) and sum(1 for d in loop_days if rates[d] > 0) >= 4,
            f"loop_days_with_errors={sum(1 for d in loop_days if rates[d] > 0)}/{len(loop_days)}")

    # Screens that need an expensive-run list and a span tree.
    sort = json.dumps([{"field": "total_estimated_cost", "direction": "DESC"}])
    resp = timed("top_traces_by_cost", lambda: c.get("/v1/private/traces", params={
        "project_name": "quality_rca", "size": 10, "sorting": sort}))
    top = resp.json().get("content", []) if resp.status_code == 200 else []
    r.check("V.top", "top expensive traces are the loop runs", len(top) == 10 and all(
        (t.get("metadata") or {}).get("deployed_version") == "v3.1" for t in top), f"status={resp.status_code}")
    if top:
        sp = timed("trace_span_tree", lambda: c.get("/v1/private/spans", params={
            "project_name": "quality_rca", "trace_id": top[0]["id"], "size": 200}))
        n = len(sp.json().get("content", [])) if sp.status_code == 200 else 0
        r.check("V.tree", "loop trace has root plus 45 tool and 45 llm spans", n == 91, f"spans={n}")

    r.note("T.timings", "query latency in ms", json.dumps(TIMINGS))
    slow = {k: v for k, v in TIMINGS.items() if v > SLOW_MS}
    r.check("T.slow", f"all timed queries under {SLOW_MS} ms", not slow, str(slow))

    save("verify", {"items": r.items, "timings_ms": TIMINGS})
    print(f"--- {len(r.items)} items, {r.failed()} failed")
    return 1 if r.failed() else 0


if __name__ == "__main__":
    sys.exit(main())
