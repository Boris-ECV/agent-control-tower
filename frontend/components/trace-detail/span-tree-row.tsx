"use client";

import { useState } from "react";

import { groupSiblings } from "@/components/trace-detail/group-spans";
import { formatTaiwanDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

// Recursive tree renderer (docs/design/SDLCCT-56.md decision #4): CSS
// padding-left by depth, no new tree/table package dependency -- matches
// this repo's existing "no new package unless an existing tool can't do
// it" pattern (same judgement as version-cost-chart.tsx's hand-rolled SVG).
const INDENT_PX = 20;

function SpanLine({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-b-0"
      style={{ paddingLeft: depth * INDENT_PX }}
    >
      {children}
    </div>
  );
}

function SpanLabel({ node }: { node: SpanTreeNode }) {
  return (
    <>
      <span className="font-medium text-text-primary">{node.name ?? t("agentDetail.unknown")}</span>
      {node.type !== null && (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary">
          {node.type}
        </span>
      )}
    </>
  );
}

function SingleSpanRow({ node, depth }: { node: SpanTreeNode; depth: number }) {
  return (
    <>
      <SpanLine depth={depth}>
        <SpanLabel node={node} />
        <span className="text-xs text-text-secondary">
          {formatTaiwanDateTime(node.start_time)}–{formatTaiwanDateTime(node.end_time)}
        </span>
      </SpanLine>
      {node.children.length > 0 && <SpanTreeRow nodes={node.children} depth={depth + 1} />}
    </>
  );
}

function GroupSpanRow({
  name,
  type,
  nodes,
  depth,
}: {
  name: string | null;
  type: string | null;
  nodes: SpanTreeNode[];
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <SpanLine depth={depth}>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 rounded hover:bg-gray-50"
        >
          <span className="font-medium text-text-primary">{name ?? t("agentDetail.unknown")}</span>
          {type !== null && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary">
              {type}
            </span>
          )}
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
            {t("traceDetail.repeatBadge")(nodes.length)}
          </span>
          <span className="text-xs text-text-secondary underline">
            {expanded ? t("traceDetail.collapse") : t("traceDetail.expand")}
          </span>
        </button>
      </SpanLine>
      {expanded &&
        nodes.map((node) => <SingleSpanRow key={node.id} node={node} depth={depth + 1} />)}
    </>
  );
}

export function SpanTreeRow({ nodes, depth }: { nodes: SpanTreeNode[]; depth: number }) {
  const groups = groupSiblings(nodes);

  return (
    <>
      {groups.map((group) =>
        group.kind === "single" ? (
          <SingleSpanRow key={group.node.id} node={group.node} depth={depth} />
        ) : (
          <GroupSpanRow
            key={group.nodes[0].id}
            name={group.name}
            type={group.type}
            nodes={group.nodes}
            depth={depth}
          />
        ),
      )}
    </>
  );
}
