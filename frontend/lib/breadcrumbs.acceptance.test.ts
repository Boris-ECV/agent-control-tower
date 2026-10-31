import { describe, expect, it } from "vitest";
import {
  buildAgentBreadcrumbs,
  buildTraceBreadcrumbs,
  truncateTraceId,
} from "@/lib/breadcrumbs";

describe("truncateTraceId (black box)", () => {
  it.each([
    ["", ""],
    ["a", "a"],
    ["abcdefg", "abcdefg"],
    ["abcdefgh", "abcdefgh"],
    ["abcdefghi", "abcdefgh…"],
    ["abcdefghijkl", "abcdefgh…"],
  ])("length case %j -> %j", (input, expected) => {
    expect(truncateTraceId(input)).toBe(expected);
  });

  it("is code point safe for emoji (no split surrogate pairs)", () => {
    const eight = "😀".repeat(8);
    expect(truncateTraceId(eight)).toBe(eight);
    const nine = "😀".repeat(9);
    expect(truncateTraceId(nine)).toBe(eight + "…");
    expect(truncateTraceId(nine)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("handles CJK ids", () => {
    expect(truncateTraceId("執行識別碼一二三四五")).toBe("執行識別碼一二三…");
  });

  it("does not trim whitespace", () => {
    expect(truncateTraceId("        ")).toBe("        ");
    expect(truncateTraceId("         ")).toBe("        …");
  });
});

describe("breadcrumb builders (black box)", () => {
  it("agent crumbs: 3 levels, only last is non-link", () => {
    const c = buildAgentBreadcrumbs({ agentKey: "k", agentName: "Name" });
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.href)).toEqual(["/agents", "/agents", undefined]);
    expect(c[2].label).toBe("Name");
    expect(c[0].label).toBe("治理");
    expect(c[1].label).toBe("Agent 清單");
  });

  it("trace crumbs: 4 levels, last non-link with full id as title", () => {
    const c = buildTraceBreadcrumbs({
      agentKey: "k",
      agentName: "Name",
      traceId: "abcdefghijkl",
    });
    expect(c).toHaveLength(4);
    expect(c.map((x) => x.href)).toEqual(["/agents", "/agents", "/agents/k", undefined]);
    expect(c[3].label).toBe("abcdefgh…");
    expect(c[3].title).toBe("abcdefghijkl");
  });

  it("blank / whitespace agent name falls back to key", () => {
    expect(buildAgentBreadcrumbs({ agentKey: "k", agentName: "   " })[2].label).toBe("k");
    expect(buildAgentBreadcrumbs({ agentKey: "k", agentName: "" })[2].label).toBe("k");
    expect(
      buildTraceBreadcrumbs({ agentKey: "k", agentName: "", traceId: "t" })[2].label,
    ).toBe("k");
  });

  it("empty trace id still yields 4 levels", () => {
    const c = buildTraceBreadcrumbs({ agentKey: "k", agentName: "N", traceId: "" });
    expect(c).toHaveLength(4);
    expect(c[3].href).toBeUndefined();
  });

  it("agent key needing URL encoding (QUESTION: href is currently not encoded)", () => {
    const c = buildTraceBreadcrumbs({ agentKey: "a b/c", agentName: "N", traceId: "t" });
    const href = c[2].href as string;
    // Accept either raw or encoded; record actual behaviour for the report.
    expect([`/agents/a b/c`, `/agents/${encodeURIComponent("a b/c")}`]).toContain(href);
  });
});
