import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeriodComparisonSection } from "@/components/cost-overview/period-comparison-section";
import type { PeriodComparison } from "@/lib/cost-overview-api";

const { fetchPeriodComparison } = vi.hoisted(() => ({
  fetchPeriodComparison: vi.fn(),
}));

vi.mock("@/lib/cost-overview-api", () => ({
  fetchPeriodComparison: (...args: unknown[]) => fetchPeriodComparison(...args),
}));

function makeComparison(
  current_cost: number,
  previous_cost: number,
  delta: number,
  delta_pct: number | null,
): PeriodComparison {
  return {
    current_period: { start: "2026-10-01", end: "2026-10-28" },
    previous_period: { start: "2026-09-01", end: "2026-09-28" },
    agents: [
      {
        key: "agent-1",
        display: "Agent 1",
        current_cost,
        previous_cost,
        delta,
        delta_pct,
      },
    ],
  } as unknown as PeriodComparison;
}

afterEach(() => {
  cleanup();
  fetchPeriodComparison.mockReset();
});

function deltaCellText(container: HTMLElement): string | undefined {
  const cells = container.querySelectorAll("tbody td");
  return cells[cells.length - 1]?.textContent ?? undefined;
}

describe("PeriodComparisonSection delta column", () => {
  it("previous=US$500, current=US$750: shows +US$ 250（50.0%）and no badge", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() =>
      expect(deltaCellText(container)).toBe("+US$ 250（50.0%）"),
    );
    expect(screen.queryByText("新增顯著支出")).not.toBeInTheDocument();
  });

  it("previous=US$1 (<US$10), current=US$639: shows +US$ 638 with the badge, no percentage", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(639, 1, 638, 63800.0));

    render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());
    expect(screen.getByText("+US$ 638")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("previous=US$0, current=US$120: shows +US$ 120 with the badge, delta_pct null unaffected", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(120, 0, 120, null));

    render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());
    expect(screen.getByText("+US$ 120")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("previous=US$10 (boundary), current=US$20: shows +US$ 10.00（100.0%）and no badge (SDLCCT-71: delta < US$100 now shows 2 decimals)", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(20, 10, 10, 100.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() =>
      expect(deltaCellText(container)).toBe("+US$ 10.00（100.0%）"),
    );
    expect(screen.queryByText("新增顯著支出")).not.toBeInTheDocument();
  });
});
