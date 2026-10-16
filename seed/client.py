"""HTTP client, ids and price table shared by the seed scripts."""

import json
import os
import sys
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx

sys.stdout.reconfigure(encoding="utf-8")

WORKSPACE = os.environ.get("OPIK_WORKSPACE", "default")
OUT_DIR = Path(__file__).parent / "out"
# Pinned prices for the models used by the scenario, extracted from the backend's published price table.
PRICE_FILE = Path(__file__).parent / "model_prices.snapshot.json"


def base_url() -> str:
    """The backend API address. Required: there is deliberately no default."""
    value = os.environ.get("OPIK_BASE_URL", "").strip()
    if not value:
        raise SystemExit("OPIK_BASE_URL is not set (example: https://<host>/api)")
    return value.rstrip("/")


def api() -> httpx.Client:
    return httpx.Client(base_url=base_url(), headers={"Comet-Workspace": WORKSPACE}, timeout=120.0)


def uuid7_at(ts: datetime) -> str:
    """UUIDv7 carrying `ts`; Opik filters metrics by the time embedded in the id."""
    ms = int(ts.timestamp() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    rand_a = (rand >> 68) & 0xFFF
    rand_b = rand & ((1 << 62) - 1)
    return str(uuid.UUID(int=(ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b))


def iso(ts: datetime) -> str:
    return ts.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_prices(models) -> dict[str, tuple[Decimal, Decimal]]:
    table = json.loads(PRICE_FILE.read_text(encoding="utf-8"), parse_float=Decimal)
    return {
        m: (Decimal(table[m]["input_cost_per_token"]), Decimal(table[m]["output_cost_per_token"]))
        for m in models
    }


def save(name: str, data) -> Path:
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"{name}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return path


def load(name: str):
    return json.loads((OUT_DIR / f"{name}.json").read_text(encoding="utf-8"))


def project_ids(c: httpx.Client) -> dict[str, str]:
    r = c.get("/v1/private/projects", params={"size": 200})
    r.raise_for_status()
    return {p["name"]: p["id"] for p in r.json()["content"]}
