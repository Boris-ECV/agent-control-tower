// Client for the bff's Cost overview screen endpoints (SDLCCT-32).
// See docs/design/SDLCCT-32.md "介面/API 契約" for the exact response
// shapes this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) — this file holds only this screen's
// types and endpoint functions.

import { fetchJson } from "@/lib/api-client";

export interface UnregisteredAgentSpend {
  key: string;
  display: string;
  spend: number;
}

export interface CostOverviewSummary {
  anchor_date: string;
  month_start: string;
  days_elapsed: number;
  days_in_month: number;
  total_spend: number;
  total_budget: number;
  budget_consumed_pct: number | null;
  projected_month_end_spend: number | null;
  projected_overspend: number | null;
  unregistered: {
    spend: number;
    agents: UnregisteredAgentSpend[];
  };
}

export interface PeriodComparisonAgent {
  key: string;
  display: string;
  current_cost: number;
  previous_cost: number;
  delta: number;
  delta_pct: number | null;
}

export interface PeriodComparison {
  anchor_date: string;
  current_period: { start: string; end: string };
  previous_period: { start: string; end: string };
  agents: PeriodComparisonAgent[];
}

export function fetchCostOverviewSummary(): Promise<CostOverviewSummary> {
  return fetchJson<CostOverviewSummary>("/api/cost-overview/summary");
}

export function fetchPeriodComparison(): Promise<PeriodComparison> {
  return fetchJson<PeriodComparison>("/api/cost-overview/period-comparison");
}
