import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceBackLink } from "@/components/trace-detail/trace-back-link";
import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { clearAgentDisplayCache, rememberAgentDisplayName } from "@/lib/agent-display";
import { t } from "@/lib/i18n/t";

vi.mock("@/lib/agent-detail-api", () => ({
  fetchAgentCostBreakdown: vi.fn(),
}));

const mockFetch = vi.mocked(fetchAgentCostBreakdown);

beforeEach(() => {
  clearAgentDisplayCache();
  mockFetch.mockReset();
});
afterEach(cleanup);

describe("TraceBackLink", () => {
  it("shows the key while loading, then the display name", async () => {
    let resolve!: (v: never) => void;
    mockFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<TraceBackLink agentKey="sales-copilot" />);
    expect(screen.getByRole("link", { name: "返回 sales-copilot" })).toHaveAttribute(
      "href",
      "/agents/sales-copilot",
    );
    await act(async () => {
      resolve({ display: "Sales Copilot" } as never);
    });
    expect(screen.getByRole("link", { name: "返回 Sales Copilot" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "返回 sales-copilot" })).toBeNull();
  });

  it("keeps the key when the lookup fails", async () => {
    mockFetch.mockRejectedValue(new Error("500"));
    render(<TraceBackLink agentKey="sales-copilot" />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "返回 sales-copilot" })).toBeInTheDocument();
  });

  it("keeps the key when the display name is blank", async () => {
    mockFetch.mockResolvedValue({ display: "   " } as never);
    render(<TraceBackLink agentKey="sales-copilot" />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "返回 sales-copilot" })).toBeInTheDocument();
  });

  it("uses the cached name on first render without fetching", () => {
    rememberAgentDisplayName("sales-copilot", "Sales Copilot");
    render(<TraceBackLink agentKey="sales-copilot" />);
    expect(screen.getByRole("link", { name: "返回 Sales Copilot" })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("builds the message as 返回 {name}", () => {
    expect(t("traceDetail.header.backToAgent")("X")).toBe("返回 X");
  });
});
