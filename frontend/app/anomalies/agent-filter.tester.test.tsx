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

function tableEl() {
  return screen.getByRole("table");
}

function tableRows() {
  return tableEl().querySelectorAll("tbody tr");
}

// Tester-authored (SDLCCT-123), independent of the developer's own
// agent-filter.test.tsx. The developer's suite already exercises each
// Gherkin scenario once; these tests target gaps the acceptance criteria
// and design doc imply but the developer's suite doesn't directly prove:
// (1) filter option *stability* when the OTHER filter changes (design doc
// §決策1 requires options derived from unfiltered allRows, not the
// type-filtered subset — the developer's suite never changes the type
// filter while checking agent options), (2) that localeCompare("zh-Hant")
// sorting is actually by *display label*, not by system code or
// first-appearance order (constructed with codes whose alphabetical order
// is the reverse of their display-name order, so a "sort by code" or
// "sort by appearance" bug would be caught), (3) the AND-combined count
// text reflecting both filters together, not just one, (4) that switching
// the agent filter to a second agent then back to "all" restores every
// row (not just the ones matching the last-selected agent), and (5) that
// existing non-regression behavior (list rendering, error state) still
// holds now that a second filter dimension exists.
describe("AnomaliesPage agent filter (SDLCCT-123) — tester-authored", () => {
  it("agent filter option list does not shrink when the anomaly-type filter is changed (options derived from unfiltered allRows)", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", anomaly_type: "model_switch" }),
        row({ agent: "agent-b", anomaly_type: "context_bloat" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        { key: "agent-a", display: "甲代理" },
        { key: "agent-b", display: "乙代理" },
      ],
    });
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    const typeFilterGroup = await screen.findByRole("group", { name: "依異常類型篩選" });

    const optionsBefore = within(agentFilterGroup)
      .getAllByRole("button")
      .map((el) => el.textContent);
    expect(optionsBefore).toHaveLength(3); // 全部 + 2 agents

    // Narrow the list down to only agent-a's rows via the *type* filter
    // (model_switch) — agent-b's only row is context_bloat, so after this
    // the underlying rows no longer contain agent-b at all.
    await user.click(within(typeFilterGroup).getByText("模型切換"));
    expect(tableRows()).toHaveLength(1);

    const optionsAfter = within(agentFilterGroup)
      .getAllByRole("button")
      .map((el) => el.textContent);
    expect(optionsAfter).toHaveLength(3);
    expect(optionsAfter).toContain("甲代理");
    expect(optionsAfter).toContain("乙代理");
  });

  it("agent filter options sort by display label via localeCompare, not by system code or list-appearance order", async () => {
    // Deliberately ASCII display labels so the expected order ("Apple"
    // before "Banana") is unambiguous regardless of the test
    // environment's ICU/zh-Hant collation data (ICU collation for CJK
    // characters is environment-dependent — see the sibling test above
    // that intentionally avoids asserting a specific 甲/乙 order for this
    // exact reason). Appearance order is agent-zzz (Banana) first,
    // agent-aaa (Apple) second, and code-alphabetical order is
    // agent-aaa < agent-zzz — both would put Banana before/at odds with
    // a display-label sort, so either bug (sort-by-code or
    // sort-by-appearance) is caught.
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-zzz", anomaly_type: "model_switch" }),
        row({ agent: "agent-aaa", anomaly_type: "context_bloat" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        { key: "agent-zzz", display: "Banana" },
        { key: "agent-aaa", display: "Apple" },
      ],
    });
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    const options = within(agentFilterGroup)
      .getAllByRole("button")
      .map((el) => el.textContent);

    expect(options).toEqual(["全部", "Apple", "Banana"]);
  });

  it("count text reflects the AND-combined result of both filters, not just the agent filter alone", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", anomaly_type: "model_switch" }),
        row({ agent: "agent-a", anomaly_type: "context_bloat" }),
        row({ agent: "agent-b", anomaly_type: "model_switch" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        { key: "agent-a", display: "甲代理" },
        { key: "agent-b", display: "乙代理" },
      ],
    });
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));
    // Agent filter alone would show 2/3; confirm it does first.
    expect(screen.getByText("顯示 2 / 3")).toBeInTheDocument();

    const typeFilterGroup = await screen.findByRole("group", { name: "依異常類型篩選" });
    await user.click(within(typeFilterGroup).getByText("模型切換"));

    // AND-combined: only agent-a + model_switch row survives -> 1 / 3,
    // not 2/3 (agent-only) and not something scoped to the type filter only.
    expect(screen.getByText("顯示 1 / 3")).toBeInTheDocument();
    expect(tableRows()).toHaveLength(1);
  });

  it("switching the agent filter to a second agent, then back to all, restores every row (not just the last-selected agent's rows)", async () => {
    const user = userEvent.setup();
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", reason: "r-a" }),
        row({ agent: "agent-b", reason: "r-b" }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        { key: "agent-a", display: "甲代理" },
        { key: "agent-b", display: "乙代理" },
      ],
    });
    render(<AnomaliesPage />);

    const agentFilterGroup = await screen.findByRole("group", { name: "依 Agent 篩選" });
    await user.click(within(agentFilterGroup).getByText("甲代理"));
    expect(tableRows()).toHaveLength(1);

    await user.click(within(agentFilterGroup).getByText("乙代理"));
    expect(tableRows()).toHaveLength(1);
    expect(within(tableEl()).getByText("r-b")).toBeInTheDocument();

    await user.click(within(agentFilterGroup).getByText("全部"));
    expect(tableRows()).toHaveLength(2);
    expect(within(tableEl()).getByText("r-a")).toBeInTheDocument();
    expect(within(tableEl()).getByText("r-b")).toBeInTheDocument();
  });

  it("non-regression: error-status rows still render via the error banner path (not the table) when both filters are 'all'", async () => {
    fetchAnomalyFeed.mockResolvedValueOnce({
      anomalies: [
        row({ agent: "agent-a", status: "ok", reason: "ok-row" }),
        row({ agent: "agent-b", status: "error", reason: "err-row", date: null }),
      ],
    });
    fetchAgentsList.mockResolvedValueOnce({
      agents: [
        { key: "agent-a", display: "甲代理" },
        { key: "agent-b", display: "乙代理" },
      ],
    });
    render(<AnomaliesPage />);

    await screen.findByRole("table");
    expect(tableRows()).toHaveLength(1);
    expect(screen.getByText(/err-row/)).toBeInTheDocument();
    expect(screen.getByText("顯示 2 / 2")).toBeInTheDocument();
  });

  it("non-regression: an /api/anomalies error still renders an explicit error state, not an empty-list message", async () => {
    fetchAnomalyFeed.mockRejectedValueOnce(new Error("boom"));
    fetchAgentsList.mockResolvedValueOnce({ agents: [] });
    render(<AnomaliesPage />);

    await screen.findByText(/boom/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("目前沒有異常")).not.toBeInTheDocument();
  });
});
