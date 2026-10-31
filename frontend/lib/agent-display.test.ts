import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import {
  clearAgentDisplayCache,
  getAgentDisplayName,
  peekAgentDisplayName,
  rememberAgentDisplayName,
} from "@/lib/agent-display";

vi.mock("@/lib/agent-detail-api", () => ({
  fetchAgentCostBreakdown: vi.fn(),
}));

const mockFetch = vi.mocked(fetchAgentCostBreakdown);

beforeEach(() => {
  clearAgentDisplayCache();
  mockFetch.mockReset();
});

describe("agent-display cache", () => {
  it("fetches once on a miss and caches the result", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    await expect(getAgentDisplayName("k")).resolves.toBe("Sales Copilot");
    expect(peekAgentDisplayName("k")).toBe("Sales Copilot");
    await expect(getAgentDisplayName("k")).resolves.toBe("Sales Copilot");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent requests for the same key", async () => {
    mockFetch.mockResolvedValue({ display: "A" } as never);
    const [a, b] = await Promise.all([getAgentDisplayName("k"), getAgentDisplayName("k")]);
    expect([a, b]).toEqual(["A", "A"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    await expect(getAgentDisplayName("k")).rejects.toThrow("boom");
    expect(peekAgentDisplayName("k")).toBeUndefined();
    mockFetch.mockResolvedValueOnce({ display: "Ok" } as never);
    await expect(getAgentDisplayName("k")).resolves.toBe("Ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("peek hits after rememberAgentDisplayName", () => {
    expect(peekAgentDisplayName("k")).toBeUndefined();
    rememberAgentDisplayName("k", "Remembered");
    expect(peekAgentDisplayName("k")).toBe("Remembered");
  });
});
