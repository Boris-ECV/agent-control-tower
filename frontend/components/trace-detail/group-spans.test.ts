import { describe, expect, it } from "vitest";

import { groupSiblings, sortGroupsByStartTime } from "@/components/trace-detail/group-spans";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

function node(
  id: string,
  name: string | null,
  type: string | null = "tool",
  start_time: string | null = null,
): SpanTreeNode {
  return {
    id,
    parent_span_id: null,
    name,
    type,
    start_time,
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

describe("sortGroupsByStartTime", () => {
  it("sorts single spans by their own start_time ascending", () => {
    const a = node("1", "a", "llm", "2026-01-01T00:00:03Z");
    const b = node("2", "b", "tool", "2026-01-01T00:00:01Z");
    const c = node("3", "c", "general", "2026-01-01T00:00:02Z");
    const groups = sortGroupsByStartTime(groupSiblings([a, b, c]));
    expect(groups.map((g) => (g.kind === "single" ? g.node.id : g.nodes[0].id))).toEqual([
      "2",
      "3",
      "1",
    ]);
  });

  it("uses a group's first node's start_time as the group's sort key, not a min-search", () => {
    const earlierButSecond = node("1", "search", "tool", "2026-01-01T00:00:05Z");
    const laterButFirst = node("2", "search", "tool", "2026-01-01T00:00:10Z");
    const other = node("3", "other", "general", "2026-01-01T00:00:06Z");
    const groups = sortGroupsByStartTime(
      groupSiblings([laterButFirst, earlierButSecond, other]),
    );
    // Group's key is nodes[0].start_time = 00:00:10, so it sorts after "other" (00:00:06)
    // even though the group contains an earlier timestamp (00:00:05) internally.
    expect(groups.map((g) => (g.kind === "single" ? g.node.id : "group"))).toEqual([
      "3",
      "group",
    ]);
  });

  it("sorts spans with a null start_time last, preserving their relative input order", () => {
    const a = node("1", "a", "tool", null);
    const b = node("2", "b", "tool", "2026-01-01T00:00:02Z");
    const c = node("3", "c", "tool", null);
    const d = node("4", "d", "tool", "2026-01-01T00:00:01Z");
    const groups = sortGroupsByStartTime(groupSiblings([a, b, c, d]));
    expect(groups.map((g) => (g.kind === "single" ? g.node.id : g.nodes[0].id))).toEqual([
      "4",
      "2",
      "1",
      "3",
    ]);
  });

  it("returns an empty array for no groups", () => {
    expect(sortGroupsByStartTime([])).toEqual([]);
  });
});
