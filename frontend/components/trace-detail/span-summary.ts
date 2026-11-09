// Pure data-shape computation for the Execution detail screen's summary row
// (SDLCCT-117): recursively visits every node of the `spans` tree (all
// levels, not just top-level siblings) to find the earliest start_time, the
// latest end_time, and the total node count. This is a one-time reshaping
// of the tree's data, completely independent from group-spans.ts's
// "display-layer-only" sibling grouping (docs/design/SDLCCT-117.md decision
// 3) -- group-spans.ts only changes how many rows render, never the tree
// structure or node count this function reports.
//
// node.start_time/end_time can individually be null (existing SpanTreeNode
// contract, see span-tree-row.tsx); a null on one node is skipped rather
// than poisoning the whole earliest/latest calculation.

import type { SpanTreeNode } from "@/lib/trace-spans-api";

export function computeSpanSummary(nodes: SpanTreeNode[]): {
  startIso: string | null;
  durationSeconds: number | null;
  count: number;
} {
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  let count = 0;

  const visit = (list: SpanTreeNode[]) => {
    for (const node of list) {
      count += 1;
      if (node.start_time) {
        const t = new Date(node.start_time).getTime();
        if (!Number.isNaN(t) && (earliestStart === null || t < earliestStart)) {
          earliestStart = t;
        }
      }
      if (node.end_time) {
        const t = new Date(node.end_time).getTime();
        if (!Number.isNaN(t) && (latestEnd === null || t > latestEnd)) {
          latestEnd = t;
        }
      }
      if (node.children.length > 0) visit(node.children);
    }
  };
  visit(nodes);

  return {
    startIso: earliestStart !== null ? new Date(earliestStart).toISOString() : null,
    durationSeconds:
      earliestStart !== null && latestEnd !== null ? (latestEnd - earliestStart) / 1000 : null,
    count,
  };
}
