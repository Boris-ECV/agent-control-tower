"""Pricing preflight: write one span per (model, provider) into a throwaway project and compare Opik's cost."""

import sys
import time
from datetime import UTC, datetime, timedelta

import httpx

from catalog import MODELS
from client import api, iso, load_prices, uuid7_at

PROJECT = "preflight_pricing"
PROMPT, COMPLETION = 24000, 1500


def pricing_cases() -> list[tuple[str, str]]:
    """Pure, no I/O. Same case list the script has always exercised: all
    MODELS plus the gemini-2.5-pro/flash "google_ai" provider alias plus the
    deliberately-unpriced "unknown-model-x"."""
    return list(MODELS.items()) + [("gemini-2.5-pro", "google_ai"), ("gemini-2.5-flash", "google_ai"),
                                    ("unknown-model-x", "openai")]


def seed_and_collect(
    c: httpx.Client, cases: list[tuple[str, str]],
    *, attempts: int = 20, delay: float = 3.0,
) -> dict[str, dict]:
    """Write trace+span batches for `cases` (write failures raise), then poll
    GET /v1/private/spans up to `attempts` times until every case shows up or
    attempts run out. Returns {f"{model}@{provider}": span_dict}."""
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
    for _ in range(attempts):
        r = c.get("/v1/private/spans", params={"project_name": PROJECT, "size": 50})
        got = {s["name"]: s for s in r.json().get("content", [])} if r.status_code == 200 else {}
        if len(got) == len(cases):
            break
        time.sleep(delay)
    return got


def evaluate_case(
    model: str, provider: str, got: dict[str, dict], prices: dict,
) -> tuple[float | None, float | None, bool]:
    """Pure, no I/O. Returns (cost, expected, ok)."""
    s = got.get(f"{model}@{provider}")
    cost = s.get("total_estimated_cost") if s else None
    if model in prices:
        p_in, p_out = prices[model]
        exp = float(p_in * PROMPT + p_out * COMPLETION)
        ok = cost is not None and abs(float(cost) - exp) < 1e-9
    else:
        exp, ok = None, cost in (None, 0)
    return cost, exp, ok


def delete_project(c: httpx.Client, name: str) -> int | None:
    """Look up the project id by name; no-op (returns None, never raises) if
    it isn't found. Otherwise calls /v1/private/projects/delete and returns
    that call's status code."""
    pid = {p["name"]: p["id"] for p in c.get("/v1/private/projects", params={"size": 200}).json()["content"]}.get(name)
    if pid is None:
        return None
    return c.post("/v1/private/projects/delete", json={"ids": [pid]}).status_code


def main() -> int:
    c = api()
    prices = load_prices(MODELS)
    cases = pricing_cases()
    try:
        got = seed_and_collect(c, cases)

        ok_all = True
        for model, provider in cases:
            cost, exp, ok = evaluate_case(model, provider, got, prices)
            ok_all &= ok
            print(f"[{'OK ' if ok else 'BAD'}] {model:<20}{provider:<18} cost={cost} expected={exp}")
    finally:
        status = delete_project(c, PROJECT)
        print("delete preflight project:", status)

    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
