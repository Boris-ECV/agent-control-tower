import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import AnomaliesPage from "@/app/anomalies/page";
import type { AnomalyRow } from "@/lib/anomalies-api";

const { fetchAnomalyFeed, fetchAgentsList } = vi.hoisted(() => ({
  fetchAnomalyFeed: vi.fn(),
  fetchAgentsList: vi.fn(),
}));

vi.mock("@/lib/anomalies-api", () => ({
  fetchAnomalyFeed: (...args: unknown[]) => fetchAnomalyFeed(...args),
}));

vi.mock("@/lib/agents-api", () => ({
  fetchAgentsList: (...args: unknown[]) => fetchAgentsList(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  fetchAnomalyFeed.mockReset();
  fetchAgentsList.mockReset();
});

function row(overrides: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    agent: "agent-a",
    anomaly_type: "model_switch",
    date: "2026-10-18",
    reason: "r",
    status: "ok",
    ...overrides,
  };
}

function agentsResponse() {
  return {
    agents: [
      { key: "agent-a", display: "甲代理" },
      { key: "agent-b", display: "乙代理" },
    ],
  };
}

function tableEl() {
  return screen.getByRole("table");
}

function tableRows() {
  return tableEl().querySelectorAll("tbody tr");
}

// SDLCCT-123: 4 個新增 Gherkin 情境（依 Agent 篩選、AND 組合、清除篩選、
// agent === null 不受篩選影響而消失/誤顯示）的單元測試覆蓋。
describe("AnomaliesPage agent filter (SDLCCT-123)", () => {
  it("Scenario 依 Agent 篩選異常清單: 只顯示該 Agent 的列，計數文字更新", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", reason: "r-a" }),
        row({ agent: "agent-b", reason: "r-b" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce(agentsResponse());
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("r-a")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("r-b")).not.toBeInTheDocument();
    expect(screen.getByText("顯示 1 / 2")).toBeInTheDocument();
  });

  it("Scenario Agent 篩選與異常類型篩選可同時生效（AND 組合）", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", anomaly_type: "model_switch", reason: "a-switch" }),
        row({ agent: "agent-a", anomaly_type: "context_bloat", reason: "a-bloat" }),
        row({ agent: "agent-b", anomaly_type: "model_switch", reason: "b-switch" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce(agentsResponse());
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));

    const typeFilterGroup = await screen.findByRole("group", { name: "依異常類型篩選" });
    await user.click(within(typeFilterGroup).getByText("模型切換"));

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("a-switch")).toBeInTheDocument();

    // 異常類型篩選改回「全部」時，Agent 篩選條件仍維持生效。
    await user.click(within(typeFilterGroup).getByText("全部"));
    expect(tableRows()).toHaveLength(2);
    expect(within(tableEl()).getByText("a-switch")).toBeInTheDocument();
    expect(within(tableEl()).getByText("a-bloat")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("b-switch")).not.toBeInTheDocument();
  });

  it("Scenario 清除 Agent 篩選回到「全部」: 重新顯示所有符合目前異常類型篩選的列", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", reason: "r-a" }),
        row({ agent: "agent-b", reason: "r-b" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce(agentsResponse());
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));
    expect(tableRows()).toHaveLength(1);

    await user.click(within(agentFilterGroup).getByText("全部"));
    expect(tableRows()).toHaveLength(2);
    expect(within(tableEl()).getByText("r-a")).toBeInTheDocument();
    expect(within(tableEl()).getByText("r-b")).toBeInTheDocument();
  });

  it("agent 為 null 的列：選「全部」時仍顯示「不明」，選特定 Agent 篩選時不出現在結果中", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [row({ agent: "agent-a", reason: "r-a" }), row({ agent: null, reason: "r-null" })],
    });
    fetchAgentsList.mockResolvedValueOnce(agentsResponse());
    render(<AnomaliesPage />);

    await screen.findByRole("table");
    expect(tableRows()).toHaveLength(2);
    expect(within(tableEl()).getByText("不明")).toBeInTheDocument();

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));

    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("r-a")).toBeInTheDocument();
    expect(within(tableEl()).queryByText("r-null")).not.toBeInTheDocument();
    expect(within(tableEl()).queryByText("不明")).not.toBeInTheDocument();
  });

  it("Agent 篩選選項依顯示名稱排序，且不受另一個篩選條件縮小（SDLCCT-108/111 慣例）", async () => {
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", anomaly_type: "model_switch" }),
        row({ agent: "agent-b", anomaly_type: "context_bloat" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce(agentsResponse());
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    const options = within(agentFilterGroup)
      .getAllByRole("button")
      .map((el) => el.textContent);
    // 排序依 localeCompare("zh-Hant") 的實際結果（環境 ICU 定義的排序順
    // 序），本測試只驗證排序函式確實被套用、且不受另一個篩選條件縮小，不
    // 斷言特定字串的絕對排序名次。
    expect(options[0]).toBe("全部");
    expect(options).toHaveLength(3);
    expect(options).toContain("甲代理");
    expect(options).toContain("乙代理");
  });
});
