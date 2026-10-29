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
    // SDLCCT-78 新增了獨立的 X 軸日期標籤群組，此處以 data-axis="y" 範圍
    // 限定只選取 Y 軸金額標示，避免誤算 X 軸標籤。
    const texts = container.querySelectorAll('svg g[data-axis="y"] text');

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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    const texts = container.querySelectorAll('svg g[data-axis="y"] text');

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
    const texts = container.querySelectorAll('svg g[data-axis="y"] text');

    expect(texts).toHaveLength(0);
    expect(container.textContent).not.toContain("US$ 0");
  });

  it("entries 為空時，不顯示任何 Y 軸金額標示", () => {
    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-15" />,
    );
    const texts = container.querySelectorAll('svg g[data-axis="y"] text');

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

describe("VersionCostChart 表格小額金額顯示精度 (SDLCCT-71)", () => {
  it("六天皆為小額（< US$100）的每日成本，表格儲存格各自顯示 2 位小數且不全部相同", () => {
    // entries 只覆蓋 anchorDate 前 6 天；固定 7 天日期軸 (SDLCCT-72) 下第 1 欄
    // （anchorDate - 6）無資料顯示「—」，其餘 6 欄驗證 SDLCCT-71 的小額精度格式。
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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-14" />,
    );
    const row = container.querySelector("tbody tr");
    const cells = row ? Array.from(row.querySelectorAll("td")).slice(1) : [];
    const cellTexts = cells.map((c) => c.textContent);

    expect(cellTexts).toEqual([
      "—",
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

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-14" />,
    );

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

describe("VersionCostChart X 軸刻度與格線 (SDLCCT-78)", () => {
  it("圖表底部顯示日期刻度：至少 2 個日期文字標籤（對應 D-6 與 D），且與表格對應欄位日期一致", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-20", value: 200 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const xAxisTexts = Array.from(
      container.querySelectorAll('svg g[data-axis="x"] text'),
    );
    expect(xAxisTexts.length).toBeGreaterThanOrEqual(2);

    const headerCells = container.querySelectorAll("thead th");
    const dateHeaderTexts = Array.from(headerCells)
      .slice(1)
      .map((el) => el.textContent);

    // D-6（第一欄，2026-10-14）與 D（最後一欄，2026-10-20）的標籤文字
    // 必須與表格對應欄位的日期文字一致。
    const xAxisTextContents = xAxisTexts.map((el) => el.textContent);
    expect(xAxisTextContents).toContain(dateHeaderTexts[0]);
    expect(xAxisTextContents).toContain(dateHeaderTexts[6]);
  });

  it("格線對齊 Y 軸標示：max、min 高度各有一條淡化水平格線橫跨圖表寬度，顏色不是任何版本線的色票顏色", () => {
    const CHART_WIDTH = 480;
    const CHART_PADDING = 24;
    const COLORBLIND_SAFE_COLORS = [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
    ];

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

    const svg = container.querySelector("svg");
    const lines = Array.from(svg?.querySelectorAll("line") ?? []);
    expect(lines).toHaveLength(2);

    const texts = container.querySelectorAll("svg text");
    const maxText = Array.from(texts).find((el) => el.textContent === "US$ 400");
    const minText = Array.from(texts).find((el) => el.textContent === "US$ 50.00");

    for (const line of lines) {
      expect(Number(line.getAttribute("x1"))).toBeCloseTo(CHART_PADDING, 1);
      expect(Number(line.getAttribute("x2"))).toBeCloseTo(
        CHART_WIDTH - CHART_PADDING,
        1,
      );
      const stroke = line.getAttribute("stroke");
      expect(stroke).not.toBeNull();
      expect(COLORBLIND_SAFE_COLORS).not.toContain(stroke);
    }

    const lineYs = lines.map((l) => Number(l.getAttribute("y1")));
    expect(lineYs).toContain(Number(maxText?.getAttribute("y")));
    expect(lineYs).toContain(Number(minText?.getAttribute("y")));
  });

  it("格線在 DOM 順序上先於資料折線（渲染於資料線之後方），確保視覺上不蓋住折線", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 400 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    const svg = container.querySelector("svg");
    const allElements = Array.from(svg?.querySelectorAll("line, polyline") ?? []);
    const tagOrder = allElements.map((el) => el.tagName.toLowerCase());

    const lastLineIndex = tagOrder.lastIndexOf("line");
    const firstPolylineIndex = tagOrder.indexOf("polyline");

    expect(lastLineIndex).toBeGreaterThanOrEqual(0);
    expect(firstPolylineIndex).toBeGreaterThanOrEqual(0);
    expect(lastLineIndex).toBeLessThan(firstPolylineIndex);
  });
});
