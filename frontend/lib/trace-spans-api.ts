// Client for the bff's Trace spans endpoint (SDLCCT-55), consumed by the
// Execution detail screen (SDLCCT-56). See docs/design/SDLCCT-56.md
// "介面/API 契約" for the exact contract this mirrors. Shared fetch/error-
// handling plumbing lives in lib/api-client.ts (SDLCCT-39) -- this file
// holds only this screen's types and endpoint function, same pattern as
// lib/agent-detail-api.ts.

import { fetchJson } from "@/lib/api-client";
import type { components } from "@/lib/generated/bff-types";

export type TraceSpansResponse = components["schemas"]["TraceSpansResponse"];
export type SpanTreeNode = components["schemas"]["SpanTreeNode"];

export function fetchTraceSpans(
  key: string,
  traceId: string,
): Promise<TraceSpansResponse> {
  return fetchJson<TraceSpansResponse>(
    `/api/agents/${encodeURIComponent(key)}/traces/${encodeURIComponent(traceId)}/spans`,
  );
}
