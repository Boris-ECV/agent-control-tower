"use client";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { useAgentDisplayName } from "@/lib/agent-display";
import { buildTraceBreadcrumbs } from "@/lib/breadcrumbs";

export function TraceBreadcrumbs({
  agentKey,
  traceId,
}: {
  agentKey: string;
  traceId: string;
}) {
  const name = useAgentDisplayName(agentKey);
  return <Breadcrumbs items={buildTraceBreadcrumbs({ agentKey, agentName: name, traceId })} />;
}
