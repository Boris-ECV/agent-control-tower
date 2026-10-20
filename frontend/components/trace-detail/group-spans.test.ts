import { describe, expect, it } from "vitest";

import { groupSiblings } from "@/components/trace-detail/group-spans";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

function node(id: string, name: string | null, type: string | null = "tool"): SpanTreeNode {
  return {
    id,
    parent_span_id: null,
    name,
    type,
    start_time: null,
    end_time: null,
    children: [],
  };
}

describe("groupSiblings", () => {
  it("keeps single-occurrence names as single entries, in input order", () => {
    const nodes = [node("1", "a"), node("2", "b"), node("3", "c")];
    const groups = groupSiblings(nodes);
    expect(groups).toEqual([
      { kind: "single", node: nodes[0] },
      { kind: "single", node: nodes[1] },
      { kind: "single", node: nodes[2] },
    ]);
  });

  it("groups 2+ same-name siblings into one group, preserving node order", () => {
    const nodes = [node("1", "search"), node("2", "search"), node("3", "summarize")];
    const groups = groupSiblings(nodes);
    expect(groups).toEqual([
      { kind: "group", name: "search", type: "tool", nodes: [nodes[0], nodes[1]] },
      { kind: "single", node: nodes[2] },
    ]);
  });

  it("orders groups by first-occurrence position, not grouping order", () => {
    const nodes = [node("1", "a"), node("2", "b"), node("3", "a"), node("4", "b")];
    const groups = groupSiblings(nodes);
    expect(groups.map((g) => (g.kind === "group" ? g.name : g.node.name))).toEqual(["a", "b"]);
  });

  it("groups same-name siblings even when type differs, using the first node's type", () => {
    const first = node("1", "x", "tool");
    const second = node("2", "x", "llm");
    const groups = groupSiblings([first, second]);
    expect(groups).toEqual([{ kind: "group", name: "x", type: "tool", nodes: [first, second] }]);
  });

  it("groups null-named siblings together distinctly from a literal 'null' name", () => {
    const a = node("1", null);
    const b = node("2", null);
    const groups = groupSiblings([a, b]);
    expect(groups).toEqual([{ kind: "group", name: null, type: "tool", nodes: [a, b] }]);
  });

  it("returns an empty array for no children", () => {
    expect(groupSiblings([])).toEqual([]);
  });
});
