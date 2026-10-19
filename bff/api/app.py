"""FastAPI app for the bff's first HTTP surface (SDLCCT-32): the Cost
overview screen's two endpoints. See docs/design/SDLCCT-32.md "介面/API
契約" for the exact route/response contract and the error-mapping table.
"""

import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .cost_overview import get_period_comparison, get_summary
from .schemas import CostOverviewSummary, PeriodComparison

_BFF_ROOT = Path(__file__).resolve().parent.parent
if str(_BFF_ROOT) not in sys.path:
    sys.path.insert(0, str(_BFF_ROOT))

from opik_metrics import MissingProjectIdsError, OpikClientError, OpikConfigError  # noqa: E402

app = FastAPI(title="Agent Control Tower BFF")

# Local Next.js dev server (frontend/, SDLCCT-32); no deployed origin yet
# (deployment module not enabled per project-profile.yaml).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.exception_handler(OpikClientError)
async def _opik_client_error_handler(request: Request, exc: OpikClientError) -> JSONResponse:
    """OpikHTTPError / OpikTimeoutError / OpikResponseFormatError -> 502,
    message taken verbatim from the exception (already includes
    endpoint/status per opik_metrics.OpikClientError.__init__)."""
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "message": str(exc),
                "endpoint": exc.endpoint,
                "status_code": exc.status_code,
            }
        },
    )


@app.exception_handler(OpikConfigError)
async def _opik_config_error_handler(request: Request, exc: OpikConfigError) -> JSONResponse:
    """Config problem detected before any backend call was attempted -- no
    endpoint/status to report, but still an explicit 502, never 0/blank."""
    return JSONResponse(
        status_code=502,
        content={"error": {"message": str(exc), "endpoint": None, "status_code": None}},
    )


@app.exception_handler(MissingProjectIdsError)
async def _missing_project_ids_error_handler(
    request: Request, exc: MissingProjectIdsError
) -> JSONResponse:
    """Should never happen in practice (registry is a fixed 9 entries) --
    a logic error, not an external-dependency failure, so 500."""
    return JSONResponse(status_code=500, content={"error": {"message": str(exc)}})


@app.get("/api/cost-overview/summary", response_model=CostOverviewSummary)
def cost_overview_summary() -> dict:
    return get_summary()


@app.get("/api/cost-overview/period-comparison", response_model=PeriodComparison)
def cost_overview_period_comparison() -> dict:
    return get_period_comparison()
