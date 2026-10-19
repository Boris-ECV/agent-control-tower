// Client for the bff's Cost overview screen endpoints (SDLCCT-32).
// See docs/design/SDLCCT-32.md "介面/API 契約" for the exact response
// shapes this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) — this file holds only this screen's
// types and endpoint functions.

import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type UnregisteredAgentSpend = components["schemas"]["UnregisteredAgentSpend"];
export type CostOverviewSummary = components["schemas"]["CostOverviewSummary"];
export type PeriodComparisonAgent = components["schemas"]["PeriodComparisonAgent"];
export type PeriodComparison = components["schemas"]["PeriodComparison"];

export function fetchCostOverviewSummary(): Promise<CostOverviewSummary> {
  return fetchJson<CostOverviewSummary>("/api/cost-overview/summary");
}

export function fetchPeriodComparison(): Promise<PeriodComparison> {
  return fetchJson<PeriodComparison>("/api/cost-overview/period-comparison");
}
