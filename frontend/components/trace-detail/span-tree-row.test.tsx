import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SpanTreeRow } from "@/components/trace-detail/span-tree-row";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

afterEach(cleanup);

function node(start: string | null, end: string | null): SpanTreeNode {
  return {
    id: "s1",
    parent_span_id: null,
    name: "span-a",
    type: "tool",
    start_time: start,
    end_time: end,
    children: [],
  };
}

function spanNode(
  id: string,
  name: string | null,
  type: string | null,
  start_time: string | null,
): SpanTreeNode {
  return { id, parent_span_id: null, name, type, start_time, end_time: null, children: [] };
}

describe("SpanTreeRow times (SDLCCT-95)", () => {
  it("renders start and end as slash datetimes in Asia/Taipei", () => {
    const { container } = render(
      <SpanTreeRow
        nodes={[node("2026-10-01T00:00:00Z", "2026-10-01T00:00:05Z")]}
        depth={0}
      />,
    );
    expect(container.textContent).toContain("2026/10/01 08:00:00–2026/10/01 08:00:05");
  });

  it("renders a dash for a null side", () => {
    const { container } = render(
      <SpanTreeRow nodes={[node(null, "2026-10-01T00:00:05Z")]} depth={0} />,
    );
    expect(container.textContent).toContain("—–2026/10/01 08:00:05");
  });
});

describe("SpanTreeRow ordering (SDLCCT-115)", () => {
  it("renders spans sorted by start_time, not by input/type order", () => {
    const nodes = [
      spanNode("1", "summarize", "llm", "2026-01-01T00:00:03Z"),
      spanNode("2", "search", "tool", "2026-01-01T00:00:01Z"),
      spanNode("3", "think", "general", "2026-01-01T00:00:02Z"),
    ];
    const { container } = render(<SpanTreeRow nodes={nodes} depth={0} />);
    const names = Array.from(container.querySelectorAll(".font-medium")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["search", "think", "summarize"]);
  });

  it("renders a null start_time span last, after all timed siblings", () => {
    const nodes = [
      spanNode("1", "no-time", "tool", null),
      spanNode("2", "later", "tool", "2026-01-01T00:00:05Z"),
      spanNode("3", "earlier", "tool", "2026-01-01T00:00:01Z"),
    ];
    const { container } = render(<SpanTreeRow nodes={nodes} depth={0} />);
    const names = Array.from(container.querySelectorAll(".font-medium")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["earlier", "later", "no-time"]);
  });
});

describe("SpanTreeRow type badge colors (SDLCCT-115)", () => {
  it("renders an llm badge with purple styling", () => {
    const { container } = render(
      <SpanTreeRow nodes={[spanNode("1", "summarize", "llm", null)]} depth={0} />,
    );
    const badge = container.querySelector(".font-medium")?.nextElementSibling;
    expect(badge?.className).toContain("border-purple-300");
    expect(badge?.className).toContain("bg-purple-50");
    expect(badge?.className).toContain("text-purple-700");
  });

  it("renders a tool badge with cyan styling", () => {
    const { container } = render(
      <SpanTreeRow nodes={[spanNode("1", "search", "tool", null)]} depth={0} />,
    );
    const badge = container.querySelector(".font-medium")?.nextElementSibling;
    expect(badge?.className).toContain("border-cyan-300");
    expect(badge?.className).toContain("bg-cyan-50");
    expect(badge?.className).toContain("text-cyan-700");
  });

  it("falls back to the existing gray style with a transparent border for general type", () => {
    const { container } = render(
      <SpanTreeRow nodes={[spanNode("1", "think", "general", null)]} depth={0} />,
    );
    const badge = container.querySelector(".font-medium")?.nextElementSibling;
    expect(badge?.className).toContain("border-transparent");
    expect(badge?.className).toContain("bg-gray-100");
    expect(badge?.className).toContain("text-text-secondary");
  });
});
