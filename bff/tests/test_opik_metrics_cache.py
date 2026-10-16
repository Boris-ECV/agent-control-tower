"""Tests for the caching layer around get_project_metrics() (SDLCCT-11).

Scope: bff/opik_metrics.py's get_project_metrics_cached() /
_metrics_cache_key() / invalidate_project_metrics_cache() and their
interaction with bff/cache.py's TTLCache. get_project_metrics() itself is
mocked -- no live Opik backend in this environment. Covers all 6 Gherkin
acceptance criteria from docs/design/SDLCCT-11.md.
"""

from datetime import UTC, datetime

import pytest

import opik_metrics
from cache import TTLCache
from opik_metrics import (
    BASE_URL_ENV_VAR,
    Breakdown,
    BreakdownField,
    Interval,
    MetricSeries,
    MetricType,
    OpikHTTPError,
    get_project_metrics_cached,
    invalidate_project_metrics_cache,
)

START = datetime(2026, 10, 1, tzinfo=UTC)
END = datetime(2026, 10, 15, tzinfo=UTC)


@pytest.fixture(autouse=True)
def opik_base_url_and_clean_cache(monkeypatch):
    monkeypatch.setenv(BASE_URL_ENV_VAR, "https://opik.example.com/api")
    invalidate_project_metrics_cache()
    yield
    invalidate_project_metrics_cache()


def _fake_result(tag="v1"):
    return {"p1": (MetricSeries(key=tag, points=()),)}


def _counting_backend(monkeypatch, result=None):
    calls = []

    def fake(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        calls.append((tuple(project_ids), metric_type, interval, interval_start, interval_end, breakdown))
        return result if result is not None else _fake_result()

    monkeypatch.setattr(opik_metrics, "get_project_metrics", fake)
    return calls


def _call(**overrides):
    kwargs = dict(
        project_ids=["p1"],
        metric_type=MetricType.COST,
        interval=Interval.DAILY,
        interval_start=START,
        interval_end=END,
        breakdown=None,
    )
    kwargs.update(overrides)
    return get_project_metrics_cached(
        kwargs["project_ids"],
        kwargs["metric_type"],
        interval=kwargs["interval"],
        interval_start=kwargs["interval_start"],
        interval_end=kwargs["interval_end"],
        breakdown=kwargs["breakdown"],
    )


# AC1: cache miss calls backend and populates the cache.
def test_cache_miss_calls_backend_and_populates_cache(monkeypatch):
    calls = _counting_backend(monkeypatch)

    result = _call()

    assert len(calls) == 1
    assert result == _fake_result()
    # A second identical call must now hit the cache (not re-call backend).
    result2 = _call()
    assert len(calls) == 1
    assert result2 == result


# AC2: identical params hit cache without calling backend again.
def test_identical_params_hit_cache_without_calling_backend(monkeypatch):
    calls = _counting_backend(monkeypatch)

    first = _call()
    second = _call()

    assert len(calls) == 1
    assert first == second


# AC3: different params (vary each field) do not cross-hit the cache.
def test_different_project_ids_do_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(project_ids=["p1"])
    _call(project_ids=["p2"])

    assert len(calls) == 2


def test_different_metric_type_does_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(metric_type=MetricType.COST)
    _call(metric_type=MetricType.TRACE_COUNT)

    assert len(calls) == 2


def test_different_interval_does_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(interval=Interval.DAILY)
    _call(interval=Interval.HOURLY)

    assert len(calls) == 2


def test_different_interval_start_does_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(interval_start=START)
    _call(interval_start=datetime(2026, 9, 1, tzinfo=UTC))

    assert len(calls) == 2


def test_different_interval_end_does_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(interval_end=END)
    _call(interval_end=datetime(2026, 11, 1, tzinfo=UTC))

    assert len(calls) == 2


def test_different_breakdown_does_not_cross_hit(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call(breakdown=None)
    _call(breakdown=Breakdown(field=BreakdownField.TAGS))

    assert len(calls) == 2


def test_project_ids_order_is_normalized_and_still_hits_cache(monkeypatch):
    """Not an AC on its own, but confirms the documented design decision
    that project_ids ordering does not affect cache key equality."""
    calls = _counting_backend(monkeypatch)

    _call(project_ids=["p1", "p2"])
    _call(project_ids=["p2", "p1"])

    assert len(calls) == 1


# AC4: TTL expiry or invalidate_all() causes a re-call.
def test_invalidate_all_causes_recall(monkeypatch):
    calls = _counting_backend(monkeypatch)

    _call()
    invalidate_project_metrics_cache()
    _call()

    assert len(calls) == 2


def test_ttl_expiry_causes_recall(monkeypatch):
    short_ttl_cache = TTLCache(ttl_seconds=0.01)
    monkeypatch.setattr(opik_metrics, "_metrics_cache", short_ttl_cache)
    calls = _counting_backend(monkeypatch)

    _call()
    import time

    time.sleep(0.02)
    _call()

    assert len(calls) == 2


# AC5: cache write failure doesn't affect the returned result.
def test_cache_write_failure_does_not_affect_result(monkeypatch):
    calls = _counting_backend(monkeypatch)

    def broken_set(key, value):
        raise RuntimeError("boom")

    monkeypatch.setattr(opik_metrics._metrics_cache, "set", broken_set)

    result = _call()

    assert len(calls) == 1
    assert result == _fake_result()


# AC6: cache read failure treated as a miss; real backend exception
# propagates unchanged through the cached wrapper.
def test_cache_read_failure_treated_as_miss(monkeypatch):
    calls = _counting_backend(monkeypatch)

    def broken_get(key):
        raise RuntimeError("boom")

    monkeypatch.setattr(opik_metrics._metrics_cache, "get", broken_get)

    result = _call()

    assert len(calls) == 1
    assert result == _fake_result()


def test_backend_exception_propagates_unchanged_through_cached_wrapper(monkeypatch):
    def failing(project_ids, metric_type, *, interval, interval_start, interval_end, breakdown=None):
        raise OpikHTTPError("boom", endpoint="/v1/private/projects/p1/metrics", status_code=500)

    monkeypatch.setattr(opik_metrics, "get_project_metrics", failing)

    with pytest.raises(OpikHTTPError) as exc_info:
        _call()

    assert exc_info.value.endpoint == "/v1/private/projects/p1/metrics"
    assert exc_info.value.status_code == 500
