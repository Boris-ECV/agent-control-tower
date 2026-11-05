// Metadata tag row for the Execution detail screen (SDLCCT-117): Agent /
// 廠別 / 版本 / 部門 / 觸發方式, in that order. Agent always renders --
// useAgentDisplayName() never returns null/empty (see lib/agent-display.ts,
// falls back to the raw key), so it has no "hide when null" branch. The
// other four skip rendering entirely when their value is null -- never a
// "部門：—" placeholder or an empty tag (docs/design/SDLCCT-117.md decision
// 1-2). Visual style reuses span-tree-row.tsx's existing neutral "type" tag
// class, not StatusBadge (that component's success/danger/warning variants
// express binary/ternary status semantics this plain metadata doesn't have).

import { t } from "@/lib/i18n/t";

// `max-w-[12rem] truncate` guards against a very long (possibly
// space-less) agent display name or metadata value forcing the whole page
// to overflow horizontally on narrow viewports -- same technique as the
// header breadcrumbs' long-name handling (components/layout/breadcrumbs.tsx
// LINK_CLASS), applied here because this tag row sits in a flex-wrap
// container where a single unbreakable long word can't otherwise wrap.
const TAG_CLASS =
  "max-w-[12rem] truncate rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary";

function Tag({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null;
  const text = `${label}：${value}`;
  return (
    <span className={TAG_CLASS} title={text}>
      {text}
    </span>
  );
}

export function TraceMetaTags({
  agentName,
  plant,
  deployedVersion,
  dept,
  trigger,
}: {
  agentName: string;
  plant: string | null;
  deployedVersion: string | null;
  dept: string | null;
  trigger: string | null;
}) {
  return (
    <div data-testid="trace-meta-tags" className="flex flex-wrap items-center gap-1.5">
      <span className={TAG_CLASS} title={agentName}>
        {agentName}
      </span>
      <Tag label={t("traceDetail.metaTags.plant")} value={plant} />
      <Tag label={t("traceDetail.metaTags.deployedVersion")} value={deployedVersion} />
      <Tag label={t("traceDetail.metaTags.dept")} value={dept} />
      <Tag label={t("traceDetail.metaTags.trigger")} value={trigger} />
    </div>
  );
}
