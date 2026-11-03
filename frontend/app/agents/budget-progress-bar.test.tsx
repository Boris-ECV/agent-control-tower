import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentsPage from "@/app/agents/page";
import type { AgentRegistryEntry } from "@/lib/agents-api";

const { fetchAgentsList } = vi.hoisted(() => ({
  fetchAgentsList: vi.fn(),
}));

vi.mock("@/lib/agents-api", () => ({
  fetchAgentsList: (...args: unknown[]) => fetchAgentsList(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  fetchAgentsList.mockReset();
});

function agent(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    key: "a1",
    display: "Agent One",
    dept: "Dept",
    owner: "Owner",
    budget: 100,
    current_period_spend: 10,
    budget_consumed_pct: 10,
    trend: [],
    has_governance_gap: false,
    registered: true,
    ...overrides,
  };
}

// SDLCCT-107 Scenario "顯示預算消耗進度條": budget_consumed_pct 為 45 時，
// 該列的預算消耗%欄旁顯示填滿 45% 的進度條。
describe("AgentsPage budget consumed progress bar", () => {
  it("renders a progress bar filled to 45% using the normal (accent) color when budget_consumed_pct is 45", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget_consumed_pct: 45 })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const tables = await screen.findAllByText("45.0%");
    const inTable = tables.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    const cell = inTable?.closest("td") as HTMLElement;
    const fill = cell.querySelector(".bg-accent, .bg-red-600") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("45%");
    expect(fill.className).toContain("bg-accent");
    expect(fill.className).not.toContain("bg-red-600");
  });

  // Scenario "超出預算時進度條變色": budget_consumed_pct 為 120 時，進度條
  // 填滿 100% 寬度並使用警示色。
  it("clamps the bar to 100% width and uses the danger color when budget_consumed_pct is 120", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget_consumed_pct: 120 })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const matches = await screen.findAllByText("120.0%");
    const inTable = matches.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    const cell = inTable?.closest("td") as HTMLElement;
    const fill = cell.querySelector(".bg-accent, .bg-red-600") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("100%");
    expect(fill.className).toContain("bg-red-600");
  });

  // Scenario "未設定預算不顯示進度條": budget 為 null (因此 budget_consumed_pct
  // 亦為 null) 時，不顯示進度條，僅顯示佔位文字。
  it("renders no progress bar and only the placeholder text when budget is null", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget: null, budget_consumed_pct: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const placeholders = await screen.findAllByText("未設定");
    const inTable = placeholders.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    expect(inTable?.tagName).toBe("SPAN");
    expect(inTable?.className).toContain("text-text-tertiary");

    // No progress-bar fill (bg-accent / bg-red-600) rendered anywhere in the
    // budget-consumed-pct cell for this row.
    const table = inTable?.closest("table");
    expect(table?.querySelector(".bg-accent")).toBeNull();
    expect(table?.querySelector(".bg-red-600")).toBeNull();
  });

  it("renders the progress bar in the mobile card list too", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget_consumed_pct: 45 })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const matches = await screen.findAllByText("45.0%");
    const inList = matches.find((el) => el.closest("ul"));
    expect(inList).toBeDefined();
    const cell = inList?.closest("dd") as HTMLElement;
    const fill = cell.querySelector(".bg-accent, .bg-red-600") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("45%");
  });

  // Scenario "未設定預算不顯示進度條" also applies to the mobile card list
  // (AgentCardList), not just the desktop table -- the existing test above
  // only asserted this for <table>. Both views share the same
  // BudgetConsumedPct helper, but that's an implementation detail the AC
  // itself doesn't reference, so this is verified independently here.
  it("renders no progress bar and only the placeholder text in the mobile card list when budget is null", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget: null, budget_consumed_pct: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const placeholders = await screen.findAllByText("未設定");
    const inList = placeholders.find((el) => el.closest("ul"));
    expect(inList).toBeDefined();
    expect(inList?.tagName).toBe("SPAN");
    expect(inList?.className).toContain("text-text-tertiary");

    const list = inList?.closest("ul");
    expect(list?.querySelector(".bg-accent")).toBeNull();
    expect(list?.querySelector(".bg-red-600")).toBeNull();
  });

  // Boundary case implied by decision 3 in docs/design/SDLCCT-107.md: the
  // danger threshold is strictly `pct > 100` (reused from
  // summary-section.tsx's `overBudget` check), so a value of exactly 100%
  // must NOT be treated as over budget -- only values strictly greater than
  // 100 should turn the bar red. Neither the developer's unit tests nor the
  // e2e spec exercised this exact boundary before this test was added.
  it("does NOT use the danger color when budget_consumed_pct is exactly 100", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget_consumed_pct: 100 })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const matches = await screen.findAllByText("100.0%");
    const inTable = matches.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    const cell = inTable?.closest("td") as HTMLElement;
    const fill = cell.querySelector(".bg-accent, .bg-red-600") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("100%");
    expect(fill.className).toContain("bg-accent");
    expect(fill.className).not.toContain("bg-red-600");
  });
});
