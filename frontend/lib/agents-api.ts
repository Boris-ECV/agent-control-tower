// Client for the bff's Agent registry screen endpoint (SDLCCT-43). See
// docs/design/SDLCCT-43.md "介面/API 契約" for the exact response shape
// this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) -- this file holds only this screen's
// types and endpoint function.

import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type AgentTrendPoint = components["schemas"]["AgentTrendPoint"];
export type AgentRegistryEntry = components["schemas"]["AgentRegistryEntry"];
export type AgentsListResponse = components["schemas"]["AgentsListResponse"];

export function fetchAgentsList(): Promise<AgentsListResponse> {
  return fetchJson<AgentsListResponse>("/api/agents");
}
