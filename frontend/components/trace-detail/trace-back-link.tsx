"use client";

import { BackLink } from "@/components/common/back-link";
import { useAgentDisplayName } from "@/lib/agent-display";
import { t } from "@/lib/i18n/t";

export function TraceBackLink({ agentKey }: { agentKey: string }) {
  const name = useAgentDisplayName(agentKey);
  return (
    <BackLink href={`/agents/${agentKey}`} label={t("traceDetail.header.backToAgent")(name)} />
  );
}
