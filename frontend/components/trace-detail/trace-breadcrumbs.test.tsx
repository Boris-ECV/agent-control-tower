import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceBreadcrumbs } from "@/components/trace-detail/trace-breadcrumbs";
import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { clearAgentDisplayCache, rememberAgentDisplayName } from "@/lib/agent-display";

vi.mock("@/lib/agent-detail-api", () => ({
  fetchAgentCostBreakdown: vi.fn(),
}));

const mockFetch = vi.mocked(fetchAgentCostBreakdown);

beforeEach(() => {
  clearAgentDisplayCache();
  mockFetch.mockReset();
});
afterEach(cleanup);

describe("TraceBreadcrumbs", () => {
  it("shows the key as a link while loading, then the display name", async () => {
    let resolve!: (v: never) => void;
    mockFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<TraceBreadcrumbs agentKey="sales-copilot" traceId="trc_123" />);
    expect(screen.getByRole("link", { name: "sales-copilot" })).toHaveAttribute(
      "href",
      "/agents/sales-copilot",
    );
    await act(async () => {
      resolve({ display: "Sales Copilot" } as never);
    });
    expect(screen.getByRole("link", { name: "Sales Copilot" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "sales-copilot" })).toBeNull();
  });

  it("keeps the key when the lookup fails", async () => {
    mockFetch.mockRejectedValue(new Error("500"));
    render(<TraceBreadcrumbs agentKey="sales-copilot" traceId="trc_123" />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "sales-copilot" })).toBeInTheDocument();
    expect(screen.getByText("trc_123")).toHaveAttribute("aria-current", "page");
  });

  it("uses the cached name on first render", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    rememberAgentDisplayName("sales-copilot", "Sales Copilot");
    render(<TraceBreadcrumbs agentKey="sales-copilot" traceId="trc_123" />);
    expect(screen.getByRole("link", { name: "Sales Copilot" })).toBeInTheDocument();
  });
});
