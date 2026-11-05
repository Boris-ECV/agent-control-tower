import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceDetailContent } from "@/components/trace-detail/trace-detail-content";
import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { clearAgentDisplayCache } from "@/lib/agent-display";
import { fetchTraceSpans } from "@/lib/trace-spans-api";

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
const mockFetchTraceSpans = vi.mocked(fetchTraceSpans);

beforeEach(() => {
  clearAgentDisplayCache();
  mockFetch.mockReset();
  mockFetchTraceSpans.mockReset();
  mockFetchTraceSpans.mockResolvedValue({
    key: "sales-copilot",
    trace_id: "trc_123",
    spans: [],
    plant: null,
    deployed_version: null,
    dept: null,
    trigger: null,
    total_estimated_cost: null,
  });
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

  it("renders the title as 執行詳情 only, without the trace id string", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    render(<TraceDetailContent />);
    await act(async () => {});
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("執行詳情");
    expect(heading.textContent).not.toContain("trc_123");
  });

  it("renders the trace id on its own line below the title in font-mono", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    render(<TraceDetailContent />);
    await act(async () => {});
    const idText = screen.getByText("trc_123", { selector: "span.font-mono" });
    expect(idText.className).toContain("font-mono");
  });
});

describe("TraceDetailContent meta tags + summary row wiring (SDLCCT-117)", () => {
  it("renders all five tags and the full summary row when every field has a value", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    mockFetchTraceSpans.mockResolvedValue({
      key: "sales-copilot",
      trace_id: "trc_123",
      spans: [
        {
          id: "1",
          parent_span_id: null,
          name: "root",
          type: "tool",
          start_time: "2026-10-01T00:00:00Z",
          end_time: "2026-10-01T00:00:07Z",
          children: [],
        },
      ],
      plant: "Plant A",
      deployed_version: "1.2.3",
      dept: "Sales",
      trigger: "cron",
      total_estimated_cost: 12.5,
    });
    render(<TraceDetailContent />);
    await act(async () => {});

    const tags = screen.getByTestId("trace-meta-tags");
    expect(tags.textContent).toContain("Sales Copilot");
    expect(tags.textContent).toContain("廠別：Plant A");
    expect(tags.textContent).toContain("版本：1.2.3");
    expect(tags.textContent).toContain("部門：Sales");
    expect(tags.textContent).toContain("觸發方式：cron");

    const summary = screen.getByTestId("trace-summary-row");
    expect(summary.textContent).toContain("2026/10/01");
    expect(summary.textContent).toContain("7.0s");
    expect(summary.textContent).toContain("1");
    expect(summary.textContent).toContain("US$");
  });

  it("omits the 部門 tag entirely when dept is null, keeping the other four", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    mockFetchTraceSpans.mockResolvedValue({
      key: "sales-copilot",
      trace_id: "trc_123",
      spans: [],
      plant: "Plant A",
      deployed_version: "1.2.3",
      dept: null,
      trigger: "cron",
      total_estimated_cost: null,
    });
    render(<TraceDetailContent />);
    await act(async () => {});

    const tags = screen.getByTestId("trace-meta-tags");
    expect(tags.textContent).not.toContain("部門");
    expect(tags.querySelectorAll("span")).toHaveLength(4);
  });

  it("falls back to em dash for start time/duration and 0 for span count when spans is empty, but still shows cost's own value", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    mockFetchTraceSpans.mockResolvedValue({
      key: "sales-copilot",
      trace_id: "trc_123",
      spans: [],
      plant: "Plant A",
      deployed_version: "1.2.3",
      dept: "Sales",
      trigger: "cron",
      total_estimated_cost: 42,
    });
    render(<TraceDetailContent />);
    await act(async () => {});

    const tags = screen.getByTestId("trace-meta-tags");
    expect(tags.querySelectorAll("span")).toHaveLength(5);

    const summary = screen.getByTestId("trace-summary-row");
    const text = summary.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toContain("US$");
    // Span count must render the literal 0, not em dash.
    const spanCountValue = summary.querySelectorAll("div")[2]?.textContent ?? "";
    expect(spanCountValue).toContain("0");
  });

  it("counts every nested level of the span tree for the Span 數 figure, not just top-level nodes", async () => {
    mockFetch.mockResolvedValue({ display: "Sales Copilot" } as never);
    mockFetchTraceSpans.mockResolvedValue({
      key: "sales-copilot",
      trace_id: "trc_123",
      spans: [
        {
          id: "1",
          parent_span_id: null,
          name: "root",
          type: "tool",
          start_time: "2026-10-01T00:00:00Z",
          end_time: "2026-10-01T00:00:10Z",
          children: [
            {
              id: "2",
              parent_span_id: "1",
              name: "child",
              type: "tool",
              start_time: "2026-10-01T00:00:01Z",
              end_time: "2026-10-01T00:00:05Z",
              children: [
                {
                  id: "3",
                  parent_span_id: "2",
                  name: "grandchild",
                  type: "tool",
                  start_time: "2026-10-01T00:00:02Z",
                  end_time: "2026-10-01T00:00:03Z",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
      plant: null,
      deployed_version: null,
      dept: null,
      trigger: null,
      total_estimated_cost: null,
    });
    render(<TraceDetailContent />);
    await act(async () => {});

    const summary = screen.getByTestId("trace-summary-row");
    const spanCountValue = summary.querySelectorAll("div")[2]?.textContent ?? "";
    expect(spanCountValue).toContain("3");
  });
});
