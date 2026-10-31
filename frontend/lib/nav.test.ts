import { describe, expect, it } from "vitest";

import { isNavItemActive } from "@/lib/nav";

const ROWS: Array<[string | null, string, boolean]> = [
  ["/agents", "/agents", true],
  ["/agents/sales-copilot", "/agents", true],
  ["/agents/sales-copilot/traces/trc_123", "/agents", true],
  ["/agents/", "/agents", true],
  ["/agents/sales-copilot/", "/agents", true],
  ["/agents?tab=cost", "/agents", true],
  ["/agents/sales-copilot?x=1#top", "/agents", true],
  ["/agents-foo", "/agents", false],
  ["/agentsfoo/bar", "/agents", false],
  ["/agent", "/agents", false],
  ["/", "/agents", false],
  ["/cost-dashboard", "/agents", false],
  ["/anomalies", "/agents", false],
  ["/settings/system", "/agents", false],
  ["/cost-dashboard", "/cost-dashboard", true],
  ["/cost-dashboard", "/anomalies", false],
  ["/anomalies", "/anomalies", true],
  ["/anomalies/", "/anomalies", true],
  ["/anomalies-2", "/anomalies", false],
  ["/settings/system", "/settings/system", true],
  ["/settings/system/", "/settings/system", true],
  ["/settings", "/settings/system", false],
  ["/settings/system-x", "/settings/system", false],
  ["/", "/", true],
  ["/agents", "/", false],
  ["/cost-dashboard", "/", false],
  ["", "/agents", false],
  [null, "/agents", false],
];

describe("isNavItemActive", () => {
  it.each(ROWS)("pathname %j, href %j -> %s", (pathname, href, expected) => {
    expect(isNavItemActive(pathname, href)).toBe(expected);
  });
});
