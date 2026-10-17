"""Generic in-process TTL cache (SDLCCT-11).

Thread-safe, single-process cache keyed by an arbitrary hashable key.
Read/write failures are isolated inside this module's own methods: a
caller using _cache.get()/_cache.set() never has an exception raised
from cache bookkeeping itself propagate past the try/except the caller
wraps around them (see bff/opik_metrics.py for the usage pattern).
"""

import threading
import time
from collections.abc import Hashable
from dataclasses import dataclass
from typing import Any


@dataclass
class _Entry[T]:
    value: T
    expires_at: float  # time.monotonic() timestamp


class TTLCache:
    """Module-level-friendly, lock-protected dict with per-entry TTL.

    Not a decorator: callers build their own cache key (so key
    construction policy stays visible at the call site, see
    opik_metrics.py) and call get()/set()/invalidate_all() explicitly.
    """

    def __init__(self, ttl_seconds: float):
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._entries: dict[Hashable, _Entry[Any]] = {}

    def get(self, key: Hashable) -> tuple[bool, Any]:
        """Returns (hit, value). hit=False on miss OR on expiry."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return False, None
            if time.monotonic() >= entry.expires_at:
                del self._entries[key]
                return False, None
            return True, entry.value

    def set(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._entries[key] = _Entry(value=value, expires_at=time.monotonic() + self._ttl_seconds)

    def invalidate(self, key: Hashable) -> None:
        with self._lock:
            self._entries.pop(key, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._entries.clear()
