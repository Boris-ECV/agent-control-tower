import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { flattenSpans, SpanWaterfall } from "@/components/trace-detail/span-waterfall";
import { SPAN_TYPE_COLORS } from "@/lib/span-type-colors";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

// Tester-authored, independent verification of SDLCCT-118. The developer's
// own span-waterfall.test.tsx already covers each Gherkin scenario once;
// these tests target gaps the acceptance criteria imply but the developer's
// suite doesn't exercise directly: a bar-color/badge-color consistency check
// that is *derived* from SPAN_TYPE_COLORS itself (not a second hardcoded
// "fill-purple-700" string, which could pass even if SPAN_TYPE_COLORS
// changed and the implementation's derivation broke), gridline boundary
// counts, mixed valid/invalid rows interleaved (not just one of each),
// cross-branch earliest-start computation, and DOM row-order parity with
// flattenSpans's pre-order traversal.

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

describe("SDLCCT-118 AC2 (tester): bar fill color is actually derived from SPAN_TYPE_COLORS, not a second hardcoded table", () => {
  it.each(Object.keys(SPAN_TYPE_COLORS))(
    "type %s's rendered bar fill hue/shade matches SPAN_TYPE_COLORS's own text-{hue}-{shade} token",
    (type) => {
      const [, hue, shade] = SPAN_TYPE_COLORS[type].match(/text-(\w+)-(\d+)/) ?? [];
      expect(hue).toBeDefined();

      const nodes = [node("1", type, "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z")];
      const { container } = render(<SpanWaterfall nodes={nodes} />);
      const rect = container.querySelector('[data-span-row="1"] rect');

      expect(rect?.getAttribute("class")).toContain(`fill-${hue}-${shade}`);
    },
  );

  it("a type absent from SPAN_TYPE_COLORS (e.g. general, which SDLCCT-115 deliberately omits) falls back to gray, never crashing on a missing lookup", () => {
    expect(SPAN_TYPE_COLORS.general).toBeUndefined();
    const nodes = [node("1", "general", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelector('[data-span-row="1"] rect')?.getAttribute("class")).toContain(
      "fill-gray-400",
    );
  });

  it("a null type falls back to gray without throwing", () => {
    const nodes = [node("1", null, "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelector('[data-span-row="1"] rect')?.getAttribute("class")).toContain(
      "fill-gray-400",
    );
  });
});

describe("SDLCCT-118 AC1 (tester): gridline count at exact 2s-multiple boundaries", () => {
  it("a span lasting exactly 2.0s elapsed produces gridlines at 0s and 2s only (2 total), not a 3rd for the open interval", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:02Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelectorAll("[data-gridline]")).toHaveLength(2);
  });

  it("a span lasting 1.9s elapsed (under one full interval) still produces the 0s gridline only", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:01.900Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelectorAll("[data-gridline]")).toHaveLength(1);
  });

  it("a span lasting 5s elapsed produces gridlines at 0,2,4s (3 total) -- the incomplete trailing interval past 4s is not drawn", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:05Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelectorAll("[data-gridline]")).toHaveLength(3);
  });

  it("a zero-duration span still renders a single gridline at 0s, not zero", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00Z", "2026-10-01T08:00:00Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.querySelectorAll("[data-gridline]")).toHaveLength(1);
    expect(container.textContent).toContain("0.0s");
  });
});

describe("SDLCCT-118 AC3 (tester): mixed valid/invalid spans interleaved, and row order parity with flattenSpans", () => {
  it("3 siblings with valid/null-start/null-end interleaved: only the valid ones become rows, in original pre-order, and the invalid ones never appear", () => {
    const nodes = [
      node("1", "llm", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z"),
      node("2", "tool", null, "2026-10-01T08:00:05Z"),
      node("3", "general", "2026-10-01T08:00:02Z", "2026-10-01T08:00:04Z"),
      node("4", "tool", "2026-10-01T08:00:03Z", null),
    ];
    const { container } = render(<SpanWaterfall nodes={nodes} />);

    const rowIds = Array.from(container.querySelectorAll("[data-span-row]")).map((el) =>
      el.getAttribute("data-span-row"),
    );
    expect(rowIds).toEqual(["1", "3"]);
    expect(container.querySelector('[data-span-row="2"]')).toBeNull();
    expect(container.querySelector('[data-span-row="4"]')).toBeNull();
  });

  it("DOM row order follows flattenSpans's pre-order traversal (parent before its own children) when only some branches have valid times", () => {
    const child = node("2", "tool", "2026-10-01T08:00:01Z", "2026-10-01T08:00:02Z");
    const root = node("1", "general", "2026-10-01T08:00:00Z", "2026-10-01T08:00:03Z", [child]);
    const sibling = node("3", "llm", "2026-10-01T08:00:03Z", "2026-10-01T08:00:04Z");

    const flatOrder = flattenSpans([root, sibling]).map((f) => f.node.id);
    expect(flatOrder).toEqual(["1", "2", "3"]);

    const { container } = render(<SpanWaterfall nodes={[root, sibling]} />);
    const rowIds = Array.from(container.querySelectorAll("[data-span-row]")).map((el) =>
      el.getAttribute("data-span-row"),
    );
    expect(rowIds).toEqual(flatOrder);
  });

  it("earliest start time is computed across the whole tree (including a child that starts before its own parent chronologically speaking is impossible, but a later sibling vs an earlier nested grandchild is), not just top-level siblings", () => {
    // sibling "3" starts earlier in wall-clock time than root "1", even
    // though it appears later in the array -- elapsed time for every row
    // must be relative to the true minimum across all valid spans.
    const child = node("2", "tool", "2026-10-01T08:00:05Z", "2026-10-01T08:00:06Z");
    const root = node("1", "general", "2026-10-01T08:00:04Z", "2026-10-01T08:00:07Z", [child]);
    const earlierSibling = node("3", "llm", "2026-10-01T08:00:00Z", "2026-10-01T08:00:01Z");

    const { container } = render(<SpanWaterfall nodes={[root, earlierSibling]} />);
    // root starts 4s after the true earliest (span "3" at 08:00:00).
    const rootRect = container.querySelector('[data-span-row="1"] rect');
    expect(rootRect?.getAttribute("x")).toBe(String(4 * 30));
    // earlierSibling itself starts at elapsed 0.
    const siblingRect = container.querySelector('[data-span-row="3"] rect');
    expect(siblingRect?.getAttribute("x")).toBe("0");
  });
});

describe("SDLCCT-118 AC1 (tester): duration text rounds to one decimal place", () => {
  it("a 1.26s duration renders as 1.3s (rounds, does not truncate)", () => {
    const nodes = [node("1", "tool", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:01.260Z")];
    const { container } = render(<SpanWaterfall nodes={nodes} />);
    expect(container.textContent).toContain("1.3s");
  });
});

describe("SDLCCT-118 AC4 (tester): empty-state text is scoped to the waterfall block, independent of any sibling empty-state text", () => {
  it("rendering SpanWaterfall alone with spans=[] never produces an <svg>, regardless of what else is on the page", () => {
    const { container } = render(<SpanWaterfall nodes={[]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("[data-span-row]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-gridline]")).toHaveLength(0);
  });
});
