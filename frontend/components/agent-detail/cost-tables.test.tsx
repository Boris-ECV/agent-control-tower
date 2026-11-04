import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelBreakdownTable } from "@/components/agent-detail/model-breakdown-table";
import { TopTracesTable } from "@/components/agent-detail/top-traces-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ key: "agent-1" }),
}));

afterEach(cleanup);

describe("ModelBreakdownTable cost column", () => {
  it("renders two-decimal cost, right-aligned with tabular-nums", () => {
    const entries = [
      { model: "gpt-x", cost: 1234.56 },
      { model: "gpt-y", cost: null },
    ] as unknown as Parameters<typeof ModelBreakdownTable>[0]["entries"];
    const { container } = render(<ModelBreakdownTable entries={entries} />);
    const td = screen.getByText("US$ 1,234.56");
    expect(td.className).toContain("text-right");
    expect(td.className).toContain("tabular-nums");
    expect(screen.getByText("—")).toBeInTheDocument();
    const ths = container.querySelectorAll("th");
    expect(ths[1]?.className).toContain("text-right");
  });
});

describe("ModelBreakdownTable dimension/tag column (SDLCCT-109)", () => {
  it('renders the first column header as "維度／標籤／成本" and groups all entries in a single model group', () => {
    const entries = [
      { model: "gpt-4o", cost: 1300.13 },
      { model: "claude-3-opus", cost: 842.07 },
      { model: "gemini-pro", cost: null },
    ] as unknown as Parameters<typeof ModelBreakdownTable>[0]["entries"];
    const { container } = render(<ModelBreakdownTable entries={entries} />);

    expect(screen.getByText("維度／標籤／成本")).toBeInTheDocument();
    expect(screen.queryByText("環境")).not.toBeInTheDocument();
    expect(screen.queryByText("團隊")).not.toBeInTheDocument();

    const tbodies = container.querySelectorAll("tbody");
    expect(tbodies.length).toBe(1);
    expect(tbodies[0]?.querySelectorAll("tr").length).toBe(3);
  });
});

describe("TopTracesTable cost column", () => {
  it("renders two-decimal cost, right-aligned with tabular-nums", () => {
    const traces = [
      { id: "t1", total_estimated_cost: 1234.56, metadata: null },
    ] as unknown as Parameters<typeof TopTracesTable>[0]["traces"];
    const { container } = render(<TopTracesTable traces={traces} />);
    const td = screen.getByText("US$ 1,234.56");
    expect(td.className).toContain("text-right");
    expect(td.className).toContain("tabular-nums");
    const ths = container.querySelectorAll("th");
    // Column order (SDLCCT-110): Trace ID, 執行時間, 預估成本, 中繼資料, arrow.
    expect(ths[2]?.className).toContain("text-right");
  });
});
