"""Pydantic response models for bff/api/app.py's two Cost overview
endpoints (SDLCCT-38): mirror the dict shapes get_summary()/
get_period_comparison() already return (bff/api/cost_overview.py).
Declared here only so FastAPI's app.openapi() emits a concrete response
schema -- without a response_model, FastAPI cannot know the shape of a
`-> dict` return. This is a type declaration only; it does not change
what the endpoints compute or return (see docs/design/SDLCCT-38.md
decision 1)."""

from pydantic import BaseModel


class UnregisteredAgentSpend(BaseModel):
    key: str
    display: str
    spend: float


class Unregistered(BaseModel):
    spend: float
    agents: list[UnregisteredAgentSpend]


class CostOverviewSummary(BaseModel):
    anchor_date: str
    month_start: str
    days_elapsed: int
    days_in_month: int
    total_spend: float
    total_budget: float
    budget_consumed_pct: float | None
    projected_month_end_spend: float | None
    projected_overspend: float | None
    unregistered: Unregistered


class PeriodRange(BaseModel):
    start: str
    end: str


class PeriodComparisonAgent(BaseModel):
    key: str
    display: str
    current_cost: float
    previous_cost: float
    delta: float
    delta_pct: float | None


class PeriodComparison(BaseModel):
    anchor_date: str
    current_period: PeriodRange
    previous_period: PeriodRange
    agents: list[PeriodComparisonAgent]
