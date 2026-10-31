import { describe, expect, it } from "vitest";

import {
  GOVERNANCE_CRUMB_HREF,
  buildAgentBreadcrumbs,
  buildTraceBreadcrumbs,
  truncateTraceId,
} from "@/lib/breadcrumbs";

describe("truncateTraceId", () => {
  it.each([
    ["", ""],
    ["trc_123", "trc_123"],
    ["abcdefgh", "abcdefgh"],
    ["abcdefghi", "abcdefgh…"],
    ["trace-0123456789abcdef", "trace-01…"],
    ["😀".repeat(8), "😀".repeat(8)],
    ["😀".repeat(10), "😀".repeat(8) + "…"],
  ])("truncates %j -> %j", (input, expected) => {
    expect(truncateTraceId(input)).toBe(expected);
  });
});

describe("buildAgentBreadcrumbs", () => {
  it("returns 3 levels with the last one having no href", () => {
    const items = buildAgentBreadcrumbs({ agentKey: "sales-copilot", agentName: "Sales Copilot" });
    expect(items).toEqual([
      { label: "治理", href: GOVERNANCE_CRUMB_HREF },
      { label: "Agent 清單", href: "/agents" },
      { label: "Sales Copilot" },
    ]);
    expect(GOVERNANCE_CRUMB_HREF).toBe("/agents");
  });

  it("falls back to the agent key when the name is blank", () => {
    const items = buildAgentBreadcrumbs({ agentKey: "sales-copilot", agentName: "  " });
    expect(items[2].label).toBe("sales-copilot");
  });
});

describe("buildTraceBreadcrumbs", () => {
  it("returns 4 levels with agent link and truncated trace id", () => {
    const items = buildTraceBreadcrumbs({
      agentKey: "sales-copilot",
      agentName: "Sales Copilot",
      traceId: "trace-0123456789abcdef",
    });
    expect(items).toHaveLength(4);
    expect(items[2]).toEqual({ label: "Sales Copilot", href: "/agents/sales-copilot" });
    expect(items[3]).toEqual({ label: "trace-01…", title: "trace-0123456789abcdef" });
    expect(items[3].href).toBeUndefined();
  });

  it("falls back to the agent key when the name is blank", () => {
    const items = buildTraceBreadcrumbs({ agentKey: "k", agentName: "", traceId: "trc_123" });
    expect(items[2].label).toBe("k");
    expect(items[3].label).toBe("trc_123");
  });
});
