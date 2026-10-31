import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SummarySection } from "@/components/cost-overview/summary-section";

const { fetchCostOverviewSummary } = vi.hoisted(() => ({
  fetchCostOverviewSummary: vi.fn(),
}));

vi.mock("@/lib/cost-overview-api", () => ({
  fetchCostOverviewSummary: (...args: unknown[]) => fetchCostOverviewSummary(...args),
}));

afterEach(() => {
  cleanup();
  fetchCostOverviewSummary.mockReset();
});

const summary = {
  anchor_date: "2026-10-28",
  total_spend: 1746.4,
  total_budget: 5000.5,
  budget_consumed_pct: 34.9,
  projected_overspend: 12.5,
  days_in_month: 31,
  unregistered: {
    agents: [{ key: "ghost", display: "Ghost", spend: 1234.56 }],
  },
};

describe("SummarySection currency formats", () => {
  it("renders summary cards as integers", async () => {
    fetchCostOverviewSummary.mockResolvedValueOnce(summary);
    render(<SummarySection />);
    await waitFor(() => expect(screen.getByText("US$ 1,746")).toBeInTheDocument());
    expect(screen.getByText("US$ 5,001")).toBeInTheDocument();
    expect(screen.getByText("US$ 13")).toBeInTheDocument();
    expect(screen.queryByText("US$ 1,746.40")).not.toBeInTheDocument();
  });

  it("renders unregistered agent spend with two decimals and tabular-nums", async () => {
    fetchCostOverviewSummary.mockResolvedValueOnce(summary);
    render(<SummarySection />);
    const spend = await screen.findByText("US$ 1,234.56");
    expect(spend.className).toContain("tabular-nums");
    expect(spend.className).toContain("text-right");
  });
});
