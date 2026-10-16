"""Tests for the generic in-process TTL cache (SDLCCT-11)."""

import time

from cache import TTLCache


def test_miss_on_unknown_key():
    cache = TTLCache(ttl_seconds=60.0)

    hit, value = cache.get("missing")

    assert hit is False
    assert value is None


def test_set_then_get_hits_with_same_value():
    cache = TTLCache(ttl_seconds=60.0)
    cache.set("k", {"a": 1})

    hit, value = cache.get("k")

    assert hit is True
    assert value == {"a": 1}


def test_entry_expires_after_ttl():
    cache = TTLCache(ttl_seconds=0.01)
    cache.set("k", "v")
    time.sleep(0.02)

    hit, value = cache.get("k")

    assert hit is False
    assert value is None


def test_invalidate_removes_single_key():
    cache = TTLCache(ttl_seconds=60.0)
    cache.set("k1", "v1")
    cache.set("k2", "v2")

    cache.invalidate("k1")

    assert cache.get("k1") == (False, None)
    assert cache.get("k2") == (True, "v2")


def test_invalidate_all_clears_every_key():
    cache = TTLCache(ttl_seconds=60.0)
    cache.set("k1", "v1")
    cache.set("k2", "v2")

    cache.invalidate_all()

    assert cache.get("k1") == (False, None)
    assert cache.get("k2") == (False, None)
