import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "@/app/agents/page";
import type { AgentTrendPoint } from "@/lib/agents-api";

function point(date: string, value: number | null): AgentTrendPoint {
  return { date, value };
}

describe("Sparkline", () => {
  it("breaks the line into a separate segment after a leading null point", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", null),
      point("2026-10-02", 10),
      point("2026-10-03", 20),
      point("2026-10-04", 30),
    ];

    const { container } = render(<Sparkline trend={trend} />);
    const polylines = container.querySelectorAll("polyline");

    // The leading null produces no point of its own; the remaining three
    // defined points stay contiguous, so they render as a single segment.
    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.getAttribute("points")?.trim().split(" ")).toHaveLength(3);
  });

  it("breaks the line into a separate segment before a trailing null point", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", 10),
      point("2026-10-02", 20),
      point("2026-10-03", 30),
      point("2026-10-04", null),
    ];

    const { container } = render(<Sparkline trend={trend} />);
    const polylines = container.querySelectorAll("polyline");

    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.getAttribute("points")?.trim().split(" ")).toHaveLength(3);
  });

  it("renders the fallback dash instead of an svg when every point is null", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", null),
      point("2026-10-02", null),
      point("2026-10-03", null),
    ];

    const { container } = render(<Sparkline trend={trend} />);

    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.textContent).toBe("—");
  });

  it("splits into two independent segments around a null point in the middle", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", 10),
      point("2026-10-02", null),
      point("2026-10-03", 30),
    ];

    const { container } = render(<Sparkline trend={trend} />);
    const polylines = container.querySelectorAll("polyline");

    expect(polylines).toHaveLength(2);
    expect(polylines[0]?.getAttribute("points")?.trim().split(" ")).toHaveLength(1);
    expect(polylines[1]?.getAttribute("points")?.trim().split(" ")).toHaveLength(1);
  });

  it("renders a single point without NaN coordinates when only one value is defined (max === min)", () => {
    const trend: AgentTrendPoint[] = [
      point("2026-10-01", null),
      point("2026-10-02", 42),
      point("2026-10-03", null),
    ];

    const { container } = render(<Sparkline trend={trend} />);
    const polylines = container.querySelectorAll("polyline");

    expect(polylines).toHaveLength(1);
    const coords = polylines[0]?.getAttribute("points")?.trim();
    expect(coords).toBeTruthy();
    expect(coords).not.toMatch(/NaN/);
  });

  it("renders a single point without NaN coordinates when the trend series itself has length 1", () => {
    const trend: AgentTrendPoint[] = [point("2026-10-01", 42)];

    const { container } = render(<Sparkline trend={trend} />);
    const polylines = container.querySelectorAll("polyline");

    expect(polylines).toHaveLength(1);
    const coords = polylines[0]?.getAttribute("points")?.trim();
    expect(coords).toBeTruthy();
    expect(coords).not.toMatch(/NaN/);
  });
});
