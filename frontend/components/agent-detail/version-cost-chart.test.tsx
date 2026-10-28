import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VersionCostChart } from "@/components/agent-detail/version-cost-chart";
import type { VersionCostSeriesEntry } from "@/lib/agent-detail-api";

function entry(
  version: string,
  points: { date: string; value: number | null }[],
): VersionCostSeriesEntry {
  return { version, points };
}

describe("VersionCostChart Y 軸金額標示 (SDLCCT-73)", () => {
  it("顯示恰好兩個金額標示：最高點與最低點，且對齊各自的高度", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 400 },
      ]),
      entry("v2", [
        { date: "2026-10-14", value: 50 },
        { date: "2026-10-15", value: 200 },
      ]),
    ];

    const { container } = render(<VersionCostChart entries={entries} />);
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(2);

    const CHART_PADDING = 24;
    const contents = Array.from(texts).map((el) => el.textContent);
    expect(contents).toContain("US$ 400");
    expect(contents).toContain("US$ 50");

    // max=400 的標示對齊圖表最上方（y === CHART_PADDING）；
    // min=50 的標示對齊圖表最下方（y === CHART_HEIGHT - CHART_PADDING = 136）。
    const maxText = Array.from(texts).find((el) => el.textContent === "US$ 400");
    const minText = Array.from(texts).find((el) => el.textContent === "US$ 50");
    expect(Number(maxText?.getAttribute("y"))).toBeCloseTo(CHART_PADDING, 1);
    expect(Number(minText?.getAttribute("y"))).toBeCloseTo(136, 1);

    // 兩個標示皆落在左側留白區（x < CHART_PADDING）。
    for (const el of texts) {
      expect(Number(el.getAttribute("x"))).toBeLessThan(CHART_PADDING);
    }
  });

  it("所有數值相同（max === min）時，只顯示一個金額標示", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 100 },
      ]),
    ];

    const { container } = render(<VersionCostChart entries={entries} />);
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(1);
    expect(texts[0]?.textContent).toBe("US$ 100");
  });

  it("沒有任何非 null 數值時，不顯示任何 Y 軸金額標示（不臆測 0）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
    ];

    const { container } = render(<VersionCostChart entries={entries} />);
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(0);
    expect(container.textContent).not.toContain("US$ 0");
  });

  it("entries 為空時，不顯示任何 Y 軸金額標示", () => {
    const { container } = render(<VersionCostChart entries={[]} />);
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(0);
  });
});
