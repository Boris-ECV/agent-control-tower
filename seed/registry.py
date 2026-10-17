"""Agent registry: a read-only projection of catalog.AGENTS for governance queries (SDLCCT-12).

    uv run python registry.py      # export seed/out/registry.json

catalog.py is the single source of truth. This module never writes back into
catalog.py; it only reads catalog.AGENTS and exports a derived JSON snapshot
for any future (possibly non-Python) BFF to consume.
"""

import argparse
import sys
from pathlib import Path

from catalog import AGENTS
from client import save

FIELDS = ("key", "display", "dept", "dept_code", "owner", "budget", "registered")


def load_registry() -> tuple[dict, ...]:
    """Return one dict per Agent in catalog.AGENTS, with exactly the six
    governance fields (key/display/dept/dept_code/owner/budget/registered),
    taken directly from the same-named Agent dataclass attributes."""
    return tuple({field: getattr(a, field) for field in FIELDS} for a in AGENTS)


def get_agent(key: str) -> dict | None:
    """Look up a single registry record by key; None if no such Agent exists."""
    for record in load_registry():
        if record["key"] == key:
            return record
    return None


def export_registry() -> Path:
    """Write the full registry to seed/out/registry.json (derived, not source of truth)."""
    return save("registry", list(load_registry()))


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    print("->", export_registry())
    return 0


if __name__ == "__main__":
    sys.exit(main())
