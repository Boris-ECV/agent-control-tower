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
