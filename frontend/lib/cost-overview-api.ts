// Client for the bff's Cost overview screen endpoints (SDLCCT-32).
// See docs/design/SDLCCT-32.md "介面/API 契約" for the exact response
// shapes this mirrors.

if (!process.env.NEXT_PUBLIC_BFF_URL) {
  throw new Error("NEXT_PUBLIC_BFF_URL is not set");
}

export const BFF_BASE_URL = process.env.NEXT_PUBLIC_BFF_URL;

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

export interface ApiError {
  endpoint: string;
  status: number;
  message: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BFF_BASE_URL}${path}`);
  } catch (cause) {
    const err: ApiError = {
      endpoint: path,
      status: 0,
      message: cause instanceof Error ? cause.message : "network error",
    };
    throw err;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
    } catch {
      // body wasn't JSON -- keep the generic message, never blank.
    }
    const err: ApiError = { endpoint: path, status: response.status, message };
    throw err;
  }

  return (await response.json()) as T;
}

export function fetchCostOverviewSummary(): Promise<CostOverviewSummary> {
  return fetchJson<CostOverviewSummary>("/api/cost-overview/summary");
}

export function fetchPeriodComparison(): Promise<PeriodComparison> {
  return fetchJson<PeriodComparison>("/api/cost-overview/period-comparison");
}
