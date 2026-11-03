import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeriodComparisonSection } from "@/components/cost-overview/period-comparison-section";
import type { PeriodComparison } from "@/lib/cost-overview-api";

const { fetchPeriodComparison } = vi.hoisted(() => ({
  fetchPeriodComparison: vi.fn(),
}));

vi.mock("@/lib/cost-overview-api", () => ({
  fetchPeriodComparison: (...args: unknown[]) => fetchPeriodComparison(...args),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
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
  push.mockReset();
});

// SDLCCT-83: 增加金額 is now its own <td> (no longer merged with 漲幅), so
// locate it by its own class rather than "last tbody td".
function deltaAmountText(container: HTMLElement): string | undefined {
  const cells = container.querySelectorAll("tbody td");
  return cells[3]?.querySelector("span")?.textContent ?? undefined;
}

function deltaPctCellText(container: HTMLElement): string | undefined {
  const cells = container.querySelectorAll("tbody td");
  return cells[4]?.textContent ?? undefined;
}

describe("PeriodComparisonSection delta amount / delta pct columns (split per SDLCCT-83)", () => {
  it("previous=US$500, current=US$750: shows +US$ 250.00 and （50.0%） in separate columns, no badge", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(deltaAmountText(container)).toBe("+US$ 250.00"));
    expect(deltaPctCellText(container)).toBe("（50.0%）");
    expect(screen.queryByText("新增顯著支出")).not.toBeInTheDocument();
  });

  it("previous=US$1 (<US$10), current=US$639: shows +US$ 638 with the badge, 漲幅 column shows em dash", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(639, 1, 638, 63800.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());
    expect(screen.getByText("+US$ 638.00")).toBeInTheDocument();
    expect(deltaPctCellText(container)).toBe("—");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("previous=US$0, current=US$120: shows +US$ 120 with the badge, 漲幅 column shows em dash (delta_pct null unaffected)", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(120, 0, 120, null));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());
    expect(screen.getByText("+US$ 120.00")).toBeInTheDocument();
    expect(deltaPctCellText(container)).toBe("—");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("previous=US$10 (boundary), current=US$20: shows +US$ 10.00 and （100.0%） and no badge (SDLCCT-71: delta < US$100 now shows 2 decimals)", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(20, 10, 10, 100.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(deltaAmountText(container)).toBe("+US$ 10.00"));
    expect(deltaPctCellText(container)).toBe("（100.0%）");
    expect(screen.queryByText("新增顯著支出")).not.toBeInTheDocument();
  });
});

describe("PeriodComparisonSection red-highlight scoping (SDLCCT-83 AC '紅色只標示在需要強調的位置')", () => {
  it("does not color the amount text red even when the notable-spend badge/bar are triggered", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(639, 1, 638, 63800.0));

    render(<PeriodComparisonSection />);

    const amount = await screen.findByText("+US$ 638.00");
    expect(amount.className).not.toContain("text-red-700");
    expect(amount.className).toContain("text-text-primary");
  });

  it("renders the length bar fill in the notable-spend red, not the general accent color", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(639, 1, 638, 63800.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());
    const cells = container.querySelectorAll("tbody td");
    const fill = cells[3]?.querySelector("span > span");
    expect(fill?.className).toContain("bg-red-600");
  });

  it("renders the length bar fill in the neutral accent color for a non-notable row", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("+US$ 250.00")).toBeInTheDocument());
    const cells = container.querySelectorAll("tbody td");
    const fill = cells[3]?.querySelector("span > span");
    expect(fill?.className).toContain("bg-accent");
    expect(fill?.className).not.toContain("bg-red-600");
  });

  // AC "紅色只標示在需要強調的位置...其餘列的金額文字維持一般文字色，不全部
  // 標紅" is a statement about a table with MULTIPLE rows at once (some over
  // the threshold, some not) -- the tests above only ever render a single
  // agent per table, so they cannot catch a bug where the whole table gets
  // colored red together (e.g. a bug keyed off "any row notable" instead of
  // "this row notable"). This test renders two rows in the same table and
  // asserts only the notable row's bar/badge turn red while the other row's
  // bar, and every row's amount text, stay in the neutral/general color.
  it("with multiple rows, colors only the notable row's bar/badge red and leaves the other row's bar and both rows' amount text in the general color", async () => {
    fetchPeriodComparison.mockResolvedValueOnce({
      current_period: { start: "2026-10-01", end: "2026-10-28" },
      previous_period: { start: "2026-09-01", end: "2026-09-28" },
      agents: [
        {
          key: "agent-notable",
          display: "Notable Agent",
          current_cost: 639,
          previous_cost: 1,
          delta: 638,
          delta_pct: 63800.0,
        },
        {
          key: "agent-normal",
          display: "Normal Agent",
          current_cost: 750,
          previous_cost: 500,
          delta: 250,
          delta_pct: 50.0,
        },
      ],
    } as unknown as PeriodComparison);

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("新增顯著支出")).toBeInTheDocument());

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);

    const notableDeltaCell = rows[0]?.querySelectorAll("td")[3];
    const normalDeltaCell = rows[1]?.querySelectorAll("td")[3];

    const notableFill = notableDeltaCell?.querySelector("span > span");
    const normalFill = normalDeltaCell?.querySelector("span > span");
    expect(notableFill?.className).toContain("bg-red-600");
    expect(normalFill?.className).toContain("bg-accent");
    expect(normalFill?.className).not.toContain("bg-red-600");

    const notableAmount = notableDeltaCell?.querySelector("span");
    const normalAmount = normalDeltaCell?.querySelector("span");
    expect(notableAmount?.className).not.toContain("text-red-700");
    expect(notableAmount?.className).toContain("text-text-primary");
    expect(normalAmount?.className).not.toContain("text-red-700");
    expect(normalAmount?.className).toContain("text-text-primary");
  });
});

describe("PeriodComparisonSection current/previous cost cells", () => {
  it("renders two-decimal costs with tabular-nums", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(screen.getByText("US$ 750.00")).toBeInTheDocument());
    expect(screen.getByText("US$ 750.00").className).toContain("tabular-nums");
    expect(screen.getByText("US$ 500.00").className).toContain("tabular-nums");
    expect(container.querySelectorAll("tbody td")[3]?.className).toContain("tabular-nums");
  });
});

describe("PeriodComparisonSection period headers (SDLCCT-83: period text on its own second line)", () => {
  it("renders the label and the formatDateRange range as two separate lines, not parenthesized inline", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    const { container } = render(<PeriodComparisonSection />);

    await waitFor(() => expect(container.querySelector("thead")).not.toBeNull());
    const headerText = container.querySelector("thead")?.textContent ?? "";
    expect(headerText).toContain("本期花費");
    expect(headerText).toContain("10/1–10/28");
    expect(headerText).not.toContain("本期花費（10/1–10/28）");
  });

  it("shows a statistics-period range next to the section", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    render(<PeriodComparisonSection />);

    expect(await screen.findByText("統計期間 2026/10/01 – 2026/10/28")).toBeInTheDocument();
  });
});

describe("PeriodComparisonSection clickable rows (SDLCCT-101 ClickableRow)", () => {
  it("navigates to the agent detail page on row click", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    render(<PeriodComparisonSection />);

    const row = await screen.findByRole("button", { name: "Agent 1" });
    row.click();
    expect(push).toHaveBeenCalledWith("/agents/agent-1");
  });

  // AC "使用者點擊該列（或以 Tab+Enter 操作）" explicitly names the keyboard
  // path as an equally valid way to activate the row, not just mouse click.
  it("navigates to the agent detail page on Enter keypress (Tab+Enter)", async () => {
    fetchPeriodComparison.mockResolvedValueOnce(makeComparison(750, 500, 250, 50.0));

    render(<PeriodComparisonSection />);

    const row = await screen.findByRole("button", { name: "Agent 1" });
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/agents/agent-1");
  });
});
