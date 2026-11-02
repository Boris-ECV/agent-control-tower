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

// SDLCCT-100 Scenario "套用": 治理缺口彙總標籤改用共用元件 StatusBadge，且
// 底色/外框/色點須隨 unregistered.agents.length 正確切換（既有瑕疵修正：
// 原本不論布林值皆固定紅色，此處驗證兩態都正確渲染）。
describe("SummarySection governance gap badge uses the shared StatusBadge", () => {
  it("renders a danger-styled badge with border, background and dot when there are unregistered agents", async () => {
    fetchCostOverviewSummary.mockResolvedValueOnce(summary);
    render(<SummarySection />);

    const badgeText = await screen.findByText(/治理缺口/);
    const badge = badgeText.closest("span");
    expect(badge?.className).toContain("border-red-300");
    expect(badge?.className).toContain("bg-red-50");
    expect(badge?.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  it("renders a success-styled badge with border, background and dot when there are no unregistered agents", async () => {
    fetchCostOverviewSummary.mockResolvedValueOnce({
      ...summary,
      unregistered: { agents: [] },
    });
    render(<SummarySection />);

    const badgeText = await screen.findByText(/無治理缺口/);
    const badge = badgeText.closest("span");
    expect(badge?.className).toContain("border-border");
    expect(badge?.className).toContain("bg-gray-50");
    expect(badge?.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });
});
