"""Unit tests for ingest.py's retry/backoff logic, using a scripted
httpx transport -- no real Opik backend involved, never skipped.

Scope: see docs/design/SDLCCT-25.md. Out of scope: generate.py/catalog.py
content, Portal/BFF/Agent registry DB, server/deployment, the size-based
chunking logic itself, the print progress output.
"""

import httpx
import pytest

import ingest


class ScriptedTransport(httpx.BaseTransport):
    """Pops one response-or-exception item from `script` per
    `handle_request` call: raises it if it's an Exception, returns it
    otherwise. Tracks call count in `self.calls`."""

    def __init__(self, script: list[httpx.Response | Exception]) -> None:
        self.script = list(script)
        self.calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _client(transport: ScriptedTransport) -> httpx.Client:
    return httpx.Client(transport=transport, base_url="http://opik.test")


@pytest.fixture
def fake_sleep(monkeypatch):
    calls: list[float] = []
    monkeypatch.setattr(ingest.time, "sleep", lambda s: calls.append(s))
    return calls


def test_retries_on_503_then_succeeds(fake_sleep):
    transport = ScriptedTransport(
        [httpx.Response(503), httpx.Response(503), httpx.Response(200)]
    )
    c = _client(transport)
    ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 3
    assert fake_sleep == [1, 2]


def test_non_retryable_status_fails_immediately(fake_sleep):
    transport = ScriptedTransport([httpx.Response(400, text="bad request")])
    c = _client(transport)
    with pytest.raises(RuntimeError, match="400"):
        ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 1


def test_gives_up_after_five_failures(fake_sleep):
    transport = ScriptedTransport([httpx.Response(500)] * 5)
    c = _client(transport)
    with pytest.raises(RuntimeError, match="gave up after retries"):
        ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 5


def test_last_attempt_success_counts(fake_sleep):
    transport = ScriptedTransport([httpx.Response(429)] * 4 + [httpx.Response(204)])
    c = _client(transport)
    ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 5


def test_first_try_success_no_delay(fake_sleep):
    transport = ScriptedTransport([httpx.Response(200)])
    c = _client(transport)
    ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 1
    assert fake_sleep == []


def test_transport_error_shares_retry_with_status_codes(fake_sleep):
    transport = ScriptedTransport([httpx.TransportError("boom"), httpx.Response(200)])
    c = _client(transport)
    ingest.post_all(c, "/v1/private/traces/batch", "traces", [{"id": 1}])
    assert transport.calls == 2
    assert len(fake_sleep) == 1
