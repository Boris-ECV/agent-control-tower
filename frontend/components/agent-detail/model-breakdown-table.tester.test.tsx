import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelBreakdownTable } from "@/components/agent-detail/model-breakdown-table";

// Tester-authored, independent verification of SDLCCT-109. Uses its own
// fixture data (different model names/costs from the developer's own
// cost-tables.test.tsx) so a pass here cannot be an artifact of reusing
// the developer's exact fixtures.

afterEach(cleanup);

function entriesOf(data: Array<{ model: string; cost: number | null }>) {
  return data as unknown as Parameters<typeof ModelBreakdownTable>[0]["entries"];
}

describe("SDLCCT-109 Scenario 1 (tester): single-dimension (model) cost tag grouping", () => {
  it('shows the "維度／標籤／成本" column header', () => {
    render(
      <ModelBreakdownTable
        entries={entriesOf([
          { model: "o3-mini", cost: 12.5 },
          { model: "llama-3-70b", cost: 987.4 },
        ])}
      />,
    );
    expect(screen.getByText("維度／標籤／成本")).toBeInTheDocument();
  });

  it("renders all model tags inside a single grouping container (one <tbody>)", () => {
    const { container } = render(
      <ModelBreakdownTable
        entries={entriesOf([
          { model: "o3-mini", cost: 12.5 },
          { model: "llama-3-70b", cost: 987.4 },
          { model: "mixtral-8x7b", cost: 3 },
        ])}
      />,
    );
    const tbodies = container.querySelectorAll("tbody");
    expect(tbodies.length).toBe(1);
    // All three rows live inside that single group, not split across groups.
    expect(tbodies[0]?.querySelectorAll("tr").length).toBe(3);
    expect(screen.getByText("o3-mini")).toBeInTheDocument();
    expect(screen.getByText("llama-3-70b")).toBeInTheDocument();
    expect(screen.getByText("mixtral-8x7b")).toBeInTheDocument();
  });

  it("formats every amount with exactly two decimal places", () => {
    render(
      <ModelBreakdownTable
        entries={entriesOf([
          { model: "o3-mini", cost: 12.5 },
          { model: "llama-3-70b", cost: 987.4 },
          { model: "mixtral-8x7b", cost: 3 },
        ])}
      />,
    );
    expect(screen.getByText("US$ 12.50")).toBeInTheDocument();
    expect(screen.getByText("US$ 987.40")).toBeInTheDocument();
    expect(screen.getByText("US$ 3.00")).toBeInTheDocument();
  });
});

describe("SDLCCT-109 Scenario 2 (tester): no empty dimension groups rendered when backend only supplies model data", () => {
  it('does not render any "環境" (environment) or "團隊" (team) group heading or error message', () => {
    render(
      <ModelBreakdownTable
        entries={entriesOf([{ model: "o3-mini", cost: 12.5 }])}
      />,
    );
    expect(screen.queryByText("環境")).not.toBeInTheDocument();
    expect(screen.queryByText("團隊")).not.toBeInTheDocument();
    expect(screen.queryByText(/錯誤/)).not.toBeInTheDocument();
  });

  it("renders exactly one grouping container even with a single entry (no stray empty sibling groups)", () => {
    const { container } = render(
      <ModelBreakdownTable
        entries={entriesOf([{ model: "o3-mini", cost: 12.5 }])}
      />,
    );
    expect(container.querySelectorAll("tbody").length).toBe(1);
  });

  it("does not throw and renders cleanly with an empty entries array (edge case implied by 'no other dimension data yet')", () => {
    const { container } = render(<ModelBreakdownTable entries={entriesOf([])} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
    expect(screen.getByText("維度／標籤／成本")).toBeInTheDocument();
  });
});
