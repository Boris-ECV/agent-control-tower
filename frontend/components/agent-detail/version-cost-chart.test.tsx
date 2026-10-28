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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(0);
    expect(container.textContent).not.toContain("US$ 0");
  });

  it("entries 為空時，不顯示任何 Y 軸金額標示", () => {
    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-15" />,
    );
    const texts = container.querySelectorAll("svg text");

    expect(texts).toHaveLength(0);
  });
});

describe("VersionCostChart 日期軸固定 7 天 (SDLCCT-72)", () => {
  it("情境1: 日期軸永遠涵蓋完整 7 天 (anchor_date - 6 到 anchor_date)，即使某版本的資料點只覆蓋其中一部分", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-18", value: 100 },
        { date: "2026-10-19", value: 150 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const headerCells = container.querySelectorAll("thead th");
    // 第一個 th 是「版本」欄標題，其餘 7 個才是日期欄。
    expect(headerCells).toHaveLength(8);
    const dateHeaderTexts = Array.from(headerCells)
      .slice(1)
      .map((el) => el.textContent);
    expect(dateHeaderTexts).toHaveLength(7);

    // 折線 X 軸資料點數量同樣以這 7 天為準：只有 2 個非 null 值，連成 1 條
    // 折線，但其座標是以 7 天的間距（dates.length = 7）計算，不是以 2 天。
    const polylines = container.querySelectorAll("svg polyline");
    expect(polylines).toHaveLength(1);
  });

  it("情境2: 某一天某個 version 完全沒有回傳資料點（日期整個缺席）時，該格顯示「—」且折線在該日斷開", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        // 2026-10-15 這天整個缺席（不是 value: null）。
        { date: "2026-10-16", value: 150 },
        { date: "2026-10-17", value: 160 },
        { date: "2026-10-18", value: 170 },
        { date: "2026-10-19", value: 180 },
        { date: "2026-10-20", value: 190 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const row = container.querySelector("tbody tr");
    const cells = Array.from(row?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    // cells[0] 是版本名，cells[1] 對應 2026-10-14 ... cells[7] 對應 2026-10-20。
    expect(cells[0]).toBe("v1");
    expect(cells[2]).toBe("—"); // 2026-10-15：日期缺席

    // 折線在缺席日斷開：此版本只有一組非連續的資料，分成兩段折線。
    const polylines = container.querySelectorAll("svg polyline");
    expect(polylines).toHaveLength(2);
    const pointCounts = Array.from(polylines).map(
      (el) => (el.getAttribute("points") ?? "").trim().split(/\s+/).length,
    );
    expect(pointCounts.sort()).toEqual([1, 5]);
  });

  it("情境3: point 存在但 value 為 null 時，與日期缺席的畫面呈現一致（回歸）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: null },
        { date: "2026-10-16", value: 150 },
        { date: "2026-10-17", value: 160 },
        { date: "2026-10-18", value: 170 },
        { date: "2026-10-19", value: 180 },
        { date: "2026-10-20", value: 190 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const row = container.querySelector("tbody tr");
    const cells = Array.from(row?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(cells[2]).toBe("—"); // 2026-10-15：point 存在但 value 為 null

    const polylines = container.querySelectorAll("svg polyline");
    expect(polylines).toHaveLength(2);
    const pointCounts = Array.from(polylines).map(
      (el) => (el.getAttribute("points") ?? "").trim().split(/\s+/).length,
    );
    expect(pointCounts.sort()).toEqual([1, 5]);
  });

  it("情境4: 所有 version 當週完全沒有任何資料點時，仍顯示 7 個日期欄位，每格「—」，不拋例外", () => {
    const entries: VersionCostSeriesEntry[] = [entry("v1", []), entry("v2", [])];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(8);

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td")).slice(1);
      expect(cells).toHaveLength(7);
      for (const cell of cells) {
        expect(cell.textContent).toBe("—");
      }
    }

    expect(container.querySelectorAll("svg polyline")).toHaveLength(0);
  });

  it("情境5: entries 本身為空陣列時，仍顯示 7 個日期欄位，不渲染任何資料列，不拋例外", () => {
    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-20" />,
    );

    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(8);

    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});
