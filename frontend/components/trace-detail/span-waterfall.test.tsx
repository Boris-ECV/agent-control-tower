import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { flattenSpans, SpanWaterfall } from "@/components/trace-detail/span-waterfall";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

afterEach(cleanup);

function node(
  id: string,
  type: string | null,
  start: string | null,
  end: string | null,
  children: SpanTreeNode[] = [],
): SpanTreeNode {
  return { id, parent_span_id: null, name: id, type, start_time: start, end_time: end, children };
}

describe("flattenSpans", () => {
  it("returns an empty array for an empty tree", () => {
    expect(flattenSpans([])).toEqual([]);
  });

  it("flattens a pre-order traversal preserving sibling order and depth", () => {
    const grandchild = node("3", "tool", null, null);
    const child = node("2", "tool", null, null, [grandchild]);
    const sibling = node("4", "tool", null, null);
    const root = node("1", "general", null, null, [child]);
    const result = flattenSpans([root, sibling]);
    expect(result.map((f) => [f.node.id, f.depth])).toEqual([
      ["1", 0],
      ["2", 1],
      ["3", 2],
      ["4", 0],
    ]);
  });
});

describe("SpanWaterfall (SDLCCT-118)", () => {
  it("renders Scenario 1: a gridline every 2 elapsed seconds and each span's duration text", () => {
    const nodes = [
      node("1", "general", "2026-10-01T08:00:00Z", "2026-10-01T08:00:08Z"),
      node("2", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:03Z"),
    ];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    const gridlines = container.querySelectorAll("[data-gridline]");
    // 0s..8s elapsed => 5 gridlines at 0,2,4,6,8s.
    expect(gridlines).toHaveLength(5);
    expect(container.textContent).toContain("8.0s");
    expect(container.textContent).toContain("3.0s");
  });

  it("renders Scenario 2: llm/tool/general bars colored purple/cyan/gray, matching the type badge hue", () => {
    const nodes = [
      node("1", "llm", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z"),
      node("2", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z"),
      node("3", "general", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z"),
    ];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    const rect1 = container.querySelector('[data-span-row="1"] rect');
    const rect2 = container.querySelector('[data-span-row="2"] rect');
    const rect3 = container.querySelector('[data-span-row="3"] rect');
    expect(rect1?.getAttribute("class")).toContain("fill-purple-700");
    expect(rect2?.getAttribute("class")).toContain("fill-cyan-700");
    expect(rect3?.getAttribute("class")).toContain("fill-gray-400");
  });

  it("falls back to the gray fill for an unrecognized type string", () => {
    const nodes = [node("1", "unknown-type", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    const rect = container.querySelector('[data-span-row="1"] rect');
    expect(rect?.getAttribute("class")).toContain("fill-gray-400");
  });

  it("Scenario 3: omits a span with a null start_time from the waterfall entirely", () => {
    const nodes = [
      node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:03Z"),
      node("2", "general", null, "2026-10-01T08:00:05Z"),
    ];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelector('[data-span-row="1"]')).not.toBeNull();
    expect(container.querySelector('[data-span-row="2"]')).toBeNull();
  });

  it("Scenario 3: omits a span with a null end_time from the waterfall entirely", () => {
    const nodes = [
      node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:03Z"),
      node("2", "general", "2026-10-01T08:00:00Z", null),
    ];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelector('[data-span-row="1"]')).not.toBeNull();
    expect(container.querySelector('[data-span-row="2"]')).toBeNull();
  });

  it("Scenario 4: shows the empty-state text and renders no <svg> when spans is empty", () => {
    const { container, getByText } = render(<SpanWaterfall nodes={[]} />);
    expect(getByText("沒有可顯示的資料")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows the empty-state text and renders no <svg> when spans is non-empty but every entry lacks valid times (decision 5)", () => {
    const nodes = [node("1", "tool", null, null), node("2", "general", "2026-10-01T08:00:00Z", null)];
    const { container, getByText } = render(<SpanWaterfall nodes={nodes} />);
    expect(getByText("沒有可顯示的資料")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("uses the waterfall title as the svg's aria-label and shows the section title", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z")];
    const { container, getByText } = render(<SpanWaterfall nodes={nodes} />);
    expect(getByText("Span 耗時時間軸")).toBeInTheDocument();
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("Span 耗時時間軸");
  });
});
