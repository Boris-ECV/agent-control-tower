// Display-layer-only grouping of sibling spans for the Execution detail
// screen (SDLCCT-56 Scenario 3): groups consecutive-by-name-identity
// siblings so 2+ same-name children under one parent render as a single
// collapsible row with a "× N" badge instead of N separate rows the user
// has to count themselves. See docs/design/SDLCCT-56.md "資料模型" and
// decision #2 (grouping key is `name` only, not `name`+`type`).
//
// groupSiblings() operates on one level's children array at a time (the
// render component calls it recursively per level, see SpanTreeRow) -- it
// never flattens or reorders the whole tree. Output order is the input
// array's "first occurrence" order per group (stable), matching SDLCCT-55
// decision 2's guarantee that duplicate same-name siblings are preserved in
// order, never deduped or reordered.

import type { SpanTreeNode } from "@/lib/trace-spans-api";

export type SpanGroup =
  | { kind: "single"; node: SpanTreeNode }
  | { kind: "group"; name: string | null; type: string | null; nodes: SpanTreeNode[] };

export function groupSiblings(nodes: SpanTreeNode[]): SpanGroup[] {
  const order: string[] = [];
  const byName = new Map<string, SpanTreeNode[]>();

  for (const node of nodes) {
    // `name` can be null (see docs/design/SDLCCT-55.md); group null-named
    // spans together under a distinct key so they don't collide with the
    // literal string "null" if that ever appeared as an actual name.
    const key = node.name === null ? "\0__null__\0" : node.name;
    if (!byName.has(key)) {
      byName.set(key, []);
      order.push(key);
    }
    byName.get(key)!.push(node);
  }

  return order.map((key): SpanGroup => {
    const group = byName.get(key)!;
    if (group.length === 1) {
      return { kind: "single", node: group[0] };
    }
    return { kind: "group", name: group[0].name, type: group[0].type, nodes: group };
  });
}
