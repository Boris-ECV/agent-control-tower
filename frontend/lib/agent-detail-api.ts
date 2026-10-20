// Client for the bff's Agent detail screen endpoint (SDLCCT-47/SDLCCT-48).
// See docs/design/SDLCCT-48.md "介面/API 契約" for the exact response shape
// this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) -- this file holds only this screen's
// types and endpoint function.

import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type AgentCostBreakdownResponse =
  components["schemas"]["AgentCostBreakdownResponse"];
export type VersionCostSeriesEntry =
  components["schemas"]["VersionCostSeriesEntry"];
export type VersionCostPoint = components["schemas"]["VersionCostPoint"];
export type ModelCostBreakdownEntry =
  components["schemas"]["ModelCostBreakdownEntry"];
export type TopTraceItem = components["schemas"]["TopTraceItem"];

export function fetchAgentCostBreakdown(
  key: string,
): Promise<AgentCostBreakdownResponse> {
  return fetchJson<AgentCostBreakdownResponse>(
    `/api/agents/${encodeURIComponent(key)}/cost-breakdown`,
  );
}
