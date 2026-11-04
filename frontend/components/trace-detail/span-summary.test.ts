import { describe, expect, it } from "vitest";

import { computeSpanSummary } from "@/components/trace-detail/span-summary";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

function node(
  id: string,
  start: string | null,
  end: string | null,
  children: SpanTreeNode[] = [],
): SpanTreeNode {
  return {
    id,
    parent_span_id: null,
    name: id,
    type: "tool",
    start_time: start,
    end_time: end,
    children,
  };
}

describe("computeSpanSummary", () => {
  it("returns startIso null, durationSeconds null, count 0 for an empty tree", () => {
    expect(computeSpanSummary([])).toEqual({ startIso: null, durationSeconds: null, count: 0 });
  });

  it("finds the earliest start_time and latest end_time across top-level siblings", () => {
    const nodes = [
      node("1", "2026-01-01T00:00:02Z", "2026-01-01T00:00:05Z"),
      node("2", "2026-01-01T00:00:01Z", "2026-01-01T00:00:08Z"),
    ];
    const result = computeSpanSummary(nodes);
    expect(result.startIso).toBe("2026-01-01T00:00:01.000Z");
    expect(result.durationSeconds).toBe(7);
    expect(result.count).toBe(2);
  });

  it("counts every level of nested children, not just top-level nodes", () => {
    const grandchild = node("3", "2026-01-01T00:00:03Z", "2026-01-01T00:00:04Z");
    const child = node("2", "2026-01-01T00:00:01Z", "2026-01-01T00:00:06Z", [grandchild]);
    const root = node("1", "2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z", [child]);
    const result = computeSpanSummary([root]);
    expect(result.count).toBe(3);
    expect(result.startIso).toBe("2026-01-01T00:00:00.000Z");
    expect(result.durationSeconds).toBe(10);
  });

  it("skips a node's own null start_time/end_time without poisoning the overall result", () => {
    const nodes = [
      node("1", null, null),
      node("2", "2026-01-01T00:00:01Z", "2026-01-01T00:00:03Z"),
    ];
    const result = computeSpanSummary(nodes);
    expect(result.startIso).toBe("2026-01-01T00:00:01.000Z");
    expect(result.durationSeconds).toBe(2);
    expect(result.count).toBe(2);
  });

  it("returns null startIso/durationSeconds when every node's times are null, but still counts nodes", () => {
    const nodes = [node("1", null, null), node("2", null, null)];
    const result = computeSpanSummary(nodes);
    expect(result).toEqual({ startIso: null, durationSeconds: null, count: 2 });
  });
});
