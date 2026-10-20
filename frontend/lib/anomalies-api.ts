// Client for the bff's Anomaly feed screen endpoint (SDLCCT-52). See
// docs/design/SDLCCT-52.md "介面/API 契約" for the exact response shape
// this mirrors. Shared fetch/error-handling plumbing lives in
// lib/api-client.ts (SDLCCT-39) -- this file holds only this screen's
// types and endpoint function.

import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type AnomalyRow = components["schemas"]["AnomalyRow"];
export type AnomalyFeedResponse = components["schemas"]["AnomalyFeedResponse"];

export function fetchAnomalyFeed(): Promise<AnomalyFeedResponse> {
  return fetchJson<AnomalyFeedResponse>("/api/anomalies");
}
