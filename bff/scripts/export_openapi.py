"""Offline OpenAPI schema export (SDLCCT-38): writes bff/openapi.json
from the FastAPI app's own app.openapi(), so frontend type generation
(frontend's `npm run generate:types`) never needs a live BFF server or
a Python toolchain -- CI's frontend job has neither. Run this whenever
bff/api/app.py's routes or bff/api/schemas.py's response models
change, then re-run `npm run generate:types` in frontend/, and commit
both generated files. See docs/design/SDLCCT-38.md.
"""

import json
import sys
from pathlib import Path

_BFF_ROOT = Path(__file__).resolve().parent.parent
if str(_BFF_ROOT) not in sys.path:
    sys.path.insert(0, str(_BFF_ROOT))

from api.app import app  # noqa: E402

_OUTPUT = _BFF_ROOT / "openapi.json"


def main() -> None:
    schema = app.openapi()
    _OUTPUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
