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
    // SDLCCT-71: 50 < US$100 門檻，formatCurrency 顯示 2 位小數。
    expect(contents).toContain("US$ 50.00");

    // max=400 的標示對齊圖表最上方（y === CHART_PADDING）；
    // min=50 的標示對齊圖表最下方（y === CHART_HEIGHT - CHART_PADDING = 136）。
    const maxText = Array.from(texts).find((el) => el.textContent === "US$ 400");
    const minText = Array.from(texts).find((el) => el.textContent === "US$ 50.00");
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

describe("VersionCostChart 表格小額金額顯示精度 (SDLCCT-71)", () => {
  it("六天皆為小額（< US$100）的每日成本，表格儲存格各自顯示 2 位小數且不全部相同", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-09", value: 2.1 },
        { date: "2026-10-10", value: 1.3 },
        { date: "2026-10-11", value: 2.8 },
        { date: "2026-10-12", value: 1.9 },
        { date: "2026-10-13", value: 2.4 },
        { date: "2026-10-14", value: 1.6 },
      ]),
    ];

    const { container } = render(<VersionCostChart entries={entries} />);
    const row = container.querySelector("tbody tr");
    const cells = row ? Array.from(row.querySelectorAll("td")).slice(1) : [];
    const cellTexts = cells.map((c) => c.textContent);

    expect(cellTexts).toEqual([
      "US$ 2.10",
      "US$ 1.30",
      "US$ 2.80",
      "US$ 1.90",
      "US$ 2.40",
      "US$ 1.60",
    ]);
    expect(new Set(cellTexts).size).toBeGreaterThan(1);
  });
});

describe("VersionCostChart 色盲安全色票 (SDLCCT-75)", () => {
  it("6 個版本序列依序使用色盲安全驗證過的新色票（折線與圖例色塊一致）", () => {
    const COLORBLIND_SAFE_COLORS = [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
    ];

    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-14", value: 100 }]),
      entry("v2", [{ date: "2026-10-14", value: 200 }]),
      entry("v3", [{ date: "2026-10-14", value: 300 }]),
      entry("v4", [{ date: "2026-10-14", value: 400 }]),
      entry("v5", [{ date: "2026-10-14", value: 500 }]),
      entry("v6", [{ date: "2026-10-14", value: 600 }]),
    ];

    const { container } = render(<VersionCostChart entries={entries} />);

    const polylines = container.querySelectorAll("svg polyline");
    expect(polylines).toHaveLength(6);
    const strokes = Array.from(polylines).map((el) => el.getAttribute("stroke"));
    expect(strokes).toEqual(COLORBLIND_SAFE_COLORS);

    const swatches = container.querySelectorAll("ul li span");
    expect(swatches).toHaveLength(6);
    const backgroundColors = Array.from(swatches).map(
      (el) => (el as HTMLElement).style.backgroundColor,
    );
    const expectedBackgroundColors = COLORBLIND_SAFE_COLORS.map(
      (hex) => hexToRgb(hex),
    );
    expect(backgroundColors).toEqual(expectedBackgroundColors);
  });
});

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
