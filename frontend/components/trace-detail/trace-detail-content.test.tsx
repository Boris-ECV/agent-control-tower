import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceDetailContent } from "@/components/trace-detail/trace-detail-content";
import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { clearAgentDisplayCache } from "@/lib/agent-display";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "sales-copilot", traceId: "trc_123" }),
}));
vi.mock("@/lib/trace-spans-api", () => ({
  fetchTraceSpans: vi.fn(() =>
    Promise.resolve({ key: "sales-copilot", trace_id: "trc_123", spans: [] }),
  ),
}));
vi.mock("@/lib/agent-detail-api", () => ({
  fetchAgentCostBreakdown: vi.fn(),
}));

const mockFetch = vi.mocked(fetchAgentCostBreakdown);

beforeEach(() => {
  clearAgentDisplayCache();
  mockFetch.mockReset();
});
afterEach(cleanup);

describe("TraceDetailContent header", () => {
  it("fetches the agent name once for breadcrumb and back link", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    render(<TraceDetailContent />);
    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "返回 Sales Copilot" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Sales Copilot$/ })).toBeInTheDocument();
  });
});
