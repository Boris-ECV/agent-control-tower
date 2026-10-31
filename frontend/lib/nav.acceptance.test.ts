import { describe, expect, it } from "vitest";
import { isNavItemActive } from "./nav";

describe("isNavItemActive acceptance (SDLCCT-96)", () => {
  it.each([
    ["/agents", "/agents", true],
    ["/agents/x", "/agents", true],
    ["/agents/sales-copilot/traces/trc_1", "/agents", true],
    ["/agents/", "/agents", true],
    ["/agents/x/", "/agents", true],
    ["/agents?tab=1", "/agents", true],
    ["/agents#top", "/agents", true],
    ["/agents/x?tab=1#a", "/agents", true],
  ])("%s is active for %s -> %s", (p, h, exp) => {
    expect(isNavItemActive(p, h)).toBe(exp);
  });

  it.each([
    ["/agents-foo", "/agents"],
    ["/agent", "/agents"],
    ["/agentsx", "/agents"],
    ["/agentsx/y", "/agents"],
    ["/cost-dashboard", "/agents"],
    ["/anomalies", "/agents"],
    ["/settings/system", "/agents"],
    ["/Agents", "/agents"],
    ["/Agents/x", "/agents"],
    ["/", "/agents"],
    ["/cost-dashboard", "/anomalies"],
    ["/agents/x", "/cost-dashboard"],
  ])("%s is NOT active for %s", (p, h) => {
    expect(isNavItemActive(p, h)).toBe(false);
  });

  it("null and empty pathname are never active", () => {
    expect(isNavItemActive(null, "/agents")).toBe(false);
    expect(isNavItemActive("", "/agents")).toBe(false);
    expect(isNavItemActive(null, "/")).toBe(false);
    expect(isNavItemActive("", "/")).toBe(false);
  });

  it("root href is exact-only", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/agents", "/")).toBe(false);
    expect(isNavItemActive("/cost-dashboard", "/")).toBe(false);
    expect(isNavItemActive("/?x=1", "/")).toBe(true);
  });

  it("other items keep their own behaviour", () => {
    expect(isNavItemActive("/cost-dashboard", "/cost-dashboard")).toBe(true);
    expect(isNavItemActive("/anomalies", "/anomalies")).toBe(true);
    expect(isNavItemActive("/settings/system", "/settings/system")).toBe(true);
  });

  it("double leading slash is not treated as /agents", () => {
    expect(isNavItemActive("//agents", "/agents")).toBe(false);
  });
});
