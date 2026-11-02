import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

function agent(key: string, display: string, hasGap: boolean): AgentRegistryEntry {
  return {
    key,
    display,
    dept: "Dept",
    owner: "Owner",
    budget: 100,
    current_period_spend: 10,
    budget_consumed_pct: 10,
    trend: [],
    has_governance_gap: hasGap,
    registered: true,
  };
}

// SDLCCT-100 Scenario "套用": 既有各頁狀態標籤皆改用共用元件 StatusBadge。
// 直接驗證 /agents 頁面實際渲染出的標籤帶有 StatusBadge 的底色/外框/色點
// 結構（而不是只檢查 import 存在），desktop 表格與 mobile 卡片兩個呼叫端
// 都要驗證，且顏色隨 has_governance_gap 正確切換。
describe("AgentsPage governance badges use the shared StatusBadge", () => {
  it("renders a danger-styled StatusBadge (border, background, dot) for an agent with a governance gap", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent("a1", "Agent One", true)],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const badges = await screen.findAllByText("治理缺口");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    for (const badge of badges) {
      expect(badge.closest("span")?.className).toContain("border-red-300");
      expect(badge.closest("span")?.className).toContain("bg-red-50");
      const dot = badge.closest("span")?.querySelector("span[aria-hidden='true']");
      expect(dot).not.toBeNull();
    }
  });

  it("renders a success-styled StatusBadge (border, background, dot) for an agent without a governance gap", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent("a2", "Agent Two", false)],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const badges = await screen.findAllByText("正常");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    for (const badge of badges) {
      expect(badge.closest("span")?.className).toContain("border-border");
      expect(badge.closest("span")?.className).toContain("bg-gray-50");
      const dot = badge.closest("span")?.querySelector("span[aria-hidden='true']");
      expect(dot).not.toBeNull();
    }
  });

  it("renders the badge in both the desktop table and the mobile card list for the same agent", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent("a3", "Agent Three", true)],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    const { container } = render(<AgentsPage />);
    await waitFor(() => expect(screen.getAllByText("治理缺口").length).toBeGreaterThan(0));

    const table = container.querySelector("table");
    const cardList = container.querySelector("ul");
    expect(table).not.toBeNull();
    expect(cardList).not.toBeNull();
    expect(within(table as HTMLElement).getByText("治理缺口")).toBeInTheDocument();
    expect(within(cardList as HTMLElement).getByText("治理缺口")).toBeInTheDocument();
  });
});
