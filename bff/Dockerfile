# syntax=docker/dockerfile:1
# Build with: docker build -f bff/Dockerfile .   (context = REPO ROOT, not
# bff/ itself — see docs/design/SDLCCT-62.md 關鍵技術決策 #1: seed/ must
# ship alongside bff/ as siblings under /app/bff and /app/seed, matching
# bff/api/*.py's sys.path.insert(..., _BFF_ROOT.parent / "seed") runtime
# assumption, which mirrors the local checkout's bff/ + seed/ sibling
# layout exactly.)

FROM python:3.12-slim AS builder
WORKDIR /app/bff
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY bff/pyproject.toml bff/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY bff/ .
COPY seed/registry.py seed/anchor.py seed/catalog.py seed/client.py /app/seed/
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runner
WORKDIR /app/bff
COPY --from=builder /app /app
ENV PATH="/app/bff/.venv/bin:$PATH"
EXPOSE 8000
# OPIK_BASE_URL has no default anywhere in this image or in api/app.py
# (CONSTITUTION: "missing value is an error, not a fallback") — the
# process fails fast at startup if the human has not supplied it.
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
