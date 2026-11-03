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

// SDLCCT-105 Scenario "未登錄資料視覺區分": owner/budget 為 null 時顯示佔位文字
// 並使用淡色樣式（text-text-tertiary），與有實際資料欄位的一般文字顏色明顯區分。
describe("AgentsPage null owner/budget placeholders use the tertiary (faded) text color", () => {
  it("renders '未指定' with text-text-tertiary in the desktop table when owner is null", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ owner: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const placeholders = await screen.findAllByText("未指定");
    const inTable = placeholders.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    expect(inTable?.tagName).toBe("SPAN");
    expect(inTable?.className).toContain("text-text-tertiary");
  });

  it("renders '未設定' with text-text-tertiary in the desktop table when budget is null", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ budget: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const placeholders = await screen.findAllByText("未設定");
    const inTable = placeholders.find((el) => el.closest("table"));
    expect(inTable).toBeDefined();
    expect(inTable?.tagName).toBe("SPAN");
    expect(inTable?.className).toContain("text-text-tertiary");
  });

  it("renders '未指定'/'未設定' with text-text-tertiary in the mobile card list as well", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ owner: null, budget: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const ownerPlaceholders = await screen.findAllByText("未指定");
    const budgetPlaceholders = await screen.findAllByText("未設定");
    const ownerInList = ownerPlaceholders.find((el) => el.closest("ul"));
    const budgetInList = budgetPlaceholders.find((el) => el.closest("ul"));
    expect(ownerInList?.className).toContain("text-text-tertiary");
    expect(budgetInList?.className).toContain("text-text-tertiary");
  });

  it("does not apply the tertiary color to a populated owner/budget value", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ owner: "Jane", budget: 500 })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const ownerCells = await screen.findAllByText("Jane");
    const inTable = ownerCells.find((el) => el.closest("table"));
    expect(inTable?.className).not.toContain("text-text-tertiary");
  });
});

// SDLCCT-105 Scenario "本期期間標示": 表格下方顯示本期對應的日期區間註腳
// （以 period_start 至 anchor_date 表示），且只渲染一次（非逐列）。
describe("AgentsPage period footnote", () => {
  it("renders the current-period footnote once, using formatDateRange(period_start, anchor_date)", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent()],
      anchor_date: "2026-10-31",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const matches = await screen.findAllByText("本期（10/1–10/31）");
    expect(matches).toHaveLength(1);
  });

  it("places the period footnote above the data-source footnote", async () => {
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent()],
      anchor_date: "2026-10-31",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const periodText = await screen.findByText("本期（10/1–10/31）");
    const footer = periodText.closest("footer") as HTMLElement;
    const paragraphs = Array.from(footer.querySelectorAll("p"));
    expect(paragraphs[0].textContent).toBe("本期（10/1–10/31）");
    expect(paragraphs[1].textContent).toContain("資料來源");
  });
});
