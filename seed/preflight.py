"""Pricing preflight: write one span per (model, provider) into a throwaway project and compare Opik's cost."""

import sys
import time
from datetime import UTC, datetime, timedelta

from catalog import MODELS
from client import api, iso, load_prices, uuid7_at

PROJECT = "preflight_pricing"
PROMPT, COMPLETION = 24000, 1500


def main() -> int:
    c = api()
    prices = load_prices(MODELS)
    cases = list(MODELS.items()) + [("gemini-2.5-pro", "google_ai"), ("gemini-2.5-flash", "google_ai"),
                                    ("unknown-model-x", "openai")]
    base = datetime.now(UTC) - timedelta(minutes=5)
    traces, spans = [], []
    for i, (model, provider) in enumerate(cases):
        start = base + timedelta(seconds=i * 3)
        tid = uuid7_at(start)
        name = f"{model}@{provider}"
        traces.append({"id": tid, "project_name": PROJECT, "name": name, "start_time": iso(start),
                       "end_time": iso(start + timedelta(seconds=2))})
        spans.append({"id": uuid7_at(start), "project_name": PROJECT, "trace_id": tid, "name": name, "type": "llm",
                      "start_time": iso(start), "end_time": iso(start + timedelta(seconds=2)), "model": model,
                      "provider": provider,
                      "usage": {"prompt_tokens": PROMPT, "completion_tokens": COMPLETION,
                                "total_tokens": PROMPT + COMPLETION}})
    assert c.post("/v1/private/traces/batch", json={"traces": traces}).status_code == 204
    assert c.post("/v1/private/spans/batch", json={"spans": spans}).status_code == 204

    got = {}
    for _ in range(20):
        r = c.get("/v1/private/spans", params={"project_name": PROJECT, "size": 50})
        got = {s["name"]: s for s in r.json().get("content", [])} if r.status_code == 200 else {}
        if len(got) == len(cases):
            break
        time.sleep(3)

    ok_all = True
    for model, provider in cases:
        s = got.get(f"{model}@{provider}")
        cost = s.get("total_estimated_cost") if s else None
        if model in prices:
            p_in, p_out = prices[model]
            exp = float(p_in * PROMPT + p_out * COMPLETION)
            ok = cost is not None and abs(float(cost) - exp) < 1e-9
        else:
            exp, ok = None, cost in (None, 0)
        ok_all &= ok
        print(f"[{'OK ' if ok else 'BAD'}] {model:<20}{provider:<18} cost={cost} expected={exp}")

    pid = {p["name"]: p["id"] for p in c.get("/v1/private/projects", params={"size": 200}).json()["content"]}[PROJECT]
    print("delete preflight project:", c.post("/v1/private/projects/delete", json={"ids": [pid]}).status_code)
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
