import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// 桌面 <table> 與行動 <ul> 卡片清單同時存在於 DOM（以 CSS 隱藏，非移除），
// 查詢比對一律限定在 <table> 範圍內，避免與卡片清單的同文字產生衝突。
function tableEl() {
  return screen.getByRole("table");
}

function tableRows() {
  return tableEl().querySelectorAll("tbody tr");
}

// SDLCCT-108: 6 個 Gherkin 情境的單元測試覆蓋。
describe("AgentsPage search box and dept/status filters", () => {
  it("Scenario 搜尋 Agent（依部門）: 子字串、不分大小寫比對 dept", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "sales-1", display: "Sales Bot", dept: "Sales", owner: "alice" }),
        agent({ key: "support-1", display: "Support Bot", dept: "Support", owner: "bob" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "SALES");

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Sales Bot")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("Support Bot")).not.toBeInTheDocument();
  });

  it("Scenario 搜尋 Agent（依系統代號）: 子字串比對 key", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "sales-copilot", display: "Copilot", dept: "Sales", owner: "alice" }),
        agent({ key: "support-bot", display: "Botter", dept: "Support", owner: "bob" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "copilot");

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Copilot")).toBeInTheDocument();
  });

  it("搜尋同時比對 display/owner 欄位（4 欄位皆生效，非僅 dept/key）", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "a1", display: "Alpha Helper", dept: "Ops", owner: "carol" }),
        agent({ key: "a2", display: "Beta Helper", dept: "Ops", owner: "dave" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");

    await user.type(search, "alpha");
    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Alpha Helper")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "dave");
    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Beta Helper")).toBeInTheDocument();
  });

  it("owner 為 null 時搜尋不丟例外、也不會誤判為符合", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ key: "a1", display: "No Owner Agent", dept: "Ops", owner: null })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "nonexistent-term");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("沒有符合篩選條件的 Agent")).toBeInTheDocument();
  });

  it("Scenario 部門下拉篩選: 只顯示該部門的 Agent", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "a1", display: "Sales Agent", dept: "Sales", owner: "alice" }),
        agent({ key: "a2", display: "Ops Agent", dept: "Ops", owner: "bob" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const deptSelect = await screen.findByLabelText("部門");
    await user.selectOptions(deptSelect, "Sales");

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Sales Agent")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("Ops Agent")).not.toBeInTheDocument();
  });

  it("部門下拉選項來自未篩選的完整清單，不隨搜尋詞縮小", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "a1", display: "Sales Agent", dept: "Sales", owner: "alice" }),
        agent({ key: "a2", display: "Ops Agent", dept: "Ops", owner: "bob" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "sales");

    const deptSelect = (await screen.findByLabelText("部門")) as HTMLSelectElement;
    const optionValues = Array.from(deptSelect.options).map((o) => o.value);
    expect(optionValues).toContain("Sales");
    expect(optionValues).toContain("Ops");
  });

  it("Scenario 狀態篩選: 只顯示 has_governance_gap 為 true 的 Agent", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "a1", display: "Gap Agent", dept: "Ops", has_governance_gap: true }),
        agent({ key: "a2", display: "OK Agent", dept: "Ops", has_governance_gap: false }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const statusGroup = await screen.findByRole("group", { name: "依治理狀態篩選" });
    await user.click(within(statusGroup).getByText("治理缺口"));

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Gap Agent")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("OK Agent")).not.toBeInTheDocument();
  });

  it("Scenario 篩選條件疊加: 搜尋字詞與部門篩選以 AND 疊加", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        agent({ key: "a1", display: "Alpha", dept: "Sales", owner: "alice" }),
        agent({ key: "a2", display: "Alpha Two", dept: "Ops", owner: "bob" }),
        agent({ key: "a3", display: "Beta", dept: "Sales", owner: "carol" }),
      ],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "alpha");

    const deptSelect = await screen.findByLabelText("部門");
    await user.selectOptions(deptSelect, "Sales");

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("Alpha")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("Alpha Two")).not.toBeInTheDocument();
    expect(within(tableEl()).queryByText("Beta")).not.toBeInTheDocument();
  });

  it("Scenario 篩選結果為空: 顯示空狀態提示，不顯示表格列", async () => {
    const user = userEvent.setup();
    fetchAgentsList.mockResolvedValueOnce({
      agents: [agent({ key: "a1", display: "Only Agent", dept: "Ops", owner: "alice" })],
      anchor_date: "2026-10-28",
      period_start: "2026-10-01",
    });
    render(<AgentsPage />);

    const search = await screen.findByLabelText("搜尋");
    await user.type(search, "no-such-agent-term");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("沒有符合篩選條件的 Agent")).toBeInTheDocument();
  });
});
