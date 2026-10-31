import { t } from "@/lib/i18n/t";

export type BreadcrumbItem = {
  label: string;
  href?: string;
  title?: string;
};

export const TRACE_ID_VISIBLE_CHARS = 8;

/**
 * The "governance" sidebar group has no landing page; link to the group's
 * first navigable item (Agent list). See docs/design/SDLCCT-97.md decision 1.
 */
export const GOVERNANCE_CRUMB_HREF = "/agents";

/** First 8 code points + "…" when longer than 8; otherwise unchanged. */
export function truncateTraceId(id: string): string {
  const chars = Array.from(id);
  if (chars.length <= TRACE_ID_VISIBLE_CHARS) return id;
  return chars.slice(0, TRACE_ID_VISIBLE_CHARS).join("") + "…";
}

function resolveName(agentKey: string, agentName: string): string {
  return agentName.trim() === "" ? agentKey : agentName;
}

function baseCrumbs(): BreadcrumbItem[] {
  return [
    { label: t("sidebar.groups.governance"), href: GOVERNANCE_CRUMB_HREF },
    { label: t("sidebar.items.agentList"), href: "/agents" },
  ];
}

export function buildAgentBreadcrumbs(a: {
  agentKey: string;
  agentName: string;
}): BreadcrumbItem[] {
  return [...baseCrumbs(), { label: resolveName(a.agentKey, a.agentName) }];
}

export function buildTraceBreadcrumbs(a: {
  agentKey: string;
  agentName: string;
  traceId: string;
}): BreadcrumbItem[] {
  return [
    ...baseCrumbs(),
    { label: resolveName(a.agentKey, a.agentName), href: `/agents/${a.agentKey}` },
    { label: truncateTraceId(a.traceId), title: a.traceId },
  ];
}
