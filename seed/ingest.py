"""POST traces and spans to Opik in batches, with retries on transient errors."""

import time

import httpx


def post_all(c: httpx.Client, path: str, key: str, rows: list[dict], size: int = 500, label: str = "") -> None:
    total = len(rows)
    for n, i in enumerate(range(0, total, size)):
        chunk = rows[i:i + size]
        for attempt in range(5):
            try:
                r = c.post(path, json={key: chunk})
            except httpx.TransportError:
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (200, 204):
                break
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{path} failed with {r.status_code}: {r.text[:300]}")
        else:
            raise RuntimeError(f"{path} gave up after retries at row {i}")
        if n % 20 == 0 or i + size >= total:
            print(f"  {label or key}: {min(i + size, total)}/{total}")
