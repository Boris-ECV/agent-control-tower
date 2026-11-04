import { describe, expect, it } from "vitest";

import { sumTrend } from "@/app/agents/page";
import type { AgentTrendPoint } from "@/lib/agents-api";

function point(date: string, value: number | null): AgentTrendPoint {
  return { date, value };
}

describe("sumTrend", () => {
  it("sums only the non-null points when at least one day has a value", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", null),
      point("2026-10-02", 10),
      point("2026-10-03", 20.5),
      point("2026-10-04", null),
      point("2026-10-05", 5),
    ];

    expect(sumTrend(trend)).toBe(35.5);
  });

  it("returns null when every point is null", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", null),
      point("2026-10-02", null),
      point("2026-10-03", null),
    ];

    expect(sumTrend(trend)).toBeNull();
  });

  it("returns null for an empty trend array", () => {
    expect(sumTrend([])).toBeNull();
  });
});
