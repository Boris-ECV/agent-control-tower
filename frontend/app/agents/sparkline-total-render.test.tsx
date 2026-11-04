import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentsPage from "@/app/agents/page";
import type { AgentRegistryEntry, AgentTrendPoint } from "@/lib/agents-api";

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

function point(date: string, value: number | null): AgentTrendPoint {
  return { date, value };
}

function agent(key: string, display: string, trend: AgentTrendPoint[]): AgentRegistryEntry {
  return {
    key,
    display,
    dept: "Dept",
    owner: "Owner",
    budget: 100,
    current_period_spend: 10,
    budget_consumed_pct: 10,
    trend,
    has_governance_gap: false,
    registered: true,
  };
}

// SDLCCT-106 Scenario "Sparkline 旁顯示近 7 天合計": 直接驗證 /agents 頁面
// 實際渲染出的金額文字（非只測 sumTrend 這個純函式），desktop 表格與
// mobile 卡片兩個呼叫端都要驗證。
describe("AgentsPage sparkline 7-day total", () => {
  it("renders the formatted 7-day total beside the sparkline when at least one day has a value", async () => {
    const trend = [
      point("2026-10-22", null),
      point("2026-10-23", 10),
      point("2026-10-24", 20.5),
      point("2026-10-25", null),
      point("2026-10-26", 5),
      point("2026-10-27", null),
      point("2026-10-28", null),
    ];
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent("a1", "Agent One", trend)],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    const { container } = render(<AgentsPage />);

    // 35.5 -> "US$ 35.50"
    const totals = await screen.findAllByText("US$ 35.50");
    expect(totals.length).toBeGreaterThanOrEqual(1);

    const table = container.querySelector("table");
    const cardList = container.querySelector("ul");
    expect(table).not.toBeNull();
    expect(cardList).not.toBeNull();
    expect(within(table as HTMLElement).getByText("US$ 35.50")).toBeInTheDocument();
    expect(within(cardList as HTMLElement).getByText("US$ 35.50")).toBeInTheDocument();
  });

  it('renders "—" and never "US$ 0.00" beside the sparkline when every trend day is null', async () => {
    const trend = [
      point("2026-10-22", null),
      point("2026-10-23", null),
      point("2026-10-24", null),
      point("2026-10-25", null),
      point("2026-10-26", null),
      point("2026-10-27", null),
      point("2026-10-28", null),
    ];
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent("a2", "Agent Two", trend)],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    const { container } = render(<AgentsPage />);

    await screen.findAllByText("Agent Two");

    expect(screen.queryByText("US$ 0.00")).toBeNull();

    const table = container.querySelector("table");
    const cardList = container.querySelector("ul");
    expect(table).not.toBeNull();
    expect(cardList).not.toBeNull();

    // Two dashes expected per sparkline-with-total instance: one from the
    // Sparkline fallback (no svg rendered) and one from the total text.
    const tableDashes = within(table as HTMLElement).getAllByText("—");
    const cardDashes = within(cardList as HTMLElement).getAllByText("—");
    expect(tableDashes.length).toBeGreaterThanOrEqual(2);
    expect(cardDashes.length).toBeGreaterThanOrEqual(2);
  });
});
