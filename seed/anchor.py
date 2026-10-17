"""Demo anchor-date configuration: a single stable 'today' for all
seed/ time-window queries (SDLCCT-9).
"""

import os
from datetime import UTC, date, datetime

ANCHOR_ENV_VAR = "DEMO_ANCHOR_DATE"

# Human-confirmed demo anchor (2026-10-15). Fixed literal -- never derive
# this from datetime.now() or any other computation.
DEFAULT_ANCHOR_DATE: date = date(2026, 10, 15)


class InvalidAnchorDateError(ValueError):
    """Raised when DEMO_ANCHOR_DATE is set but is not a valid ISO date
    string (e.g. "not-a-date"). Never silently falls back to the default.
    """


def get_anchor_date() -> datetime:
    """Return the demo anchor date as a UTC-aware datetime at 00:00:00.

    - DEMO_ANCHOR_DATE unset or empty -> DEFAULT_ANCHOR_DATE.
    - DEMO_ANCHOR_DATE set to a valid ISO date string (YYYY-MM-DD) ->
      that date, at 00:00:00 UTC.
    - DEMO_ANCHOR_DATE set to anything else -> InvalidAnchorDateError.
    """
    raw = os.environ.get(ANCHOR_ENV_VAR, "").strip()
    d = DEFAULT_ANCHOR_DATE
    if raw:
        try:
            d = date.fromisoformat(raw)
        except ValueError as exc:
            raise InvalidAnchorDateError(
                f"{ANCHOR_ENV_VAR}={raw!r} is not a valid ISO date (YYYY-MM-DD)"
            ) from exc
    return datetime.combine(d, datetime.min.time(), tzinfo=UTC)
