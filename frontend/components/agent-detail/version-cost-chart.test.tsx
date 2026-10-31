import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VersionCostChart,
  computeLayout,
  fallbackLayout,
} from "@/components/agent-detail/version-cost-chart";
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
  it("圖表內不再有 X 軸日期文字：data-axis=\"x\" 群組不存在，日期只在表格標題列 (SDLCCT-88)", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-20", value: 200 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    expect(container.querySelector('svg g[data-axis="x"]')).toBeNull();
    const svgTexts = Array.from(container.querySelectorAll("svg text")).map(
      (el) => el.textContent ?? "",
    );
    const dateHeaderTexts = Array.from(container.querySelectorAll("thead th"))
      .slice(1)
      .map((el) => el.textContent ?? "");
    expect(dateHeaderTexts).toHaveLength(7);
    for (const headerText of dateHeaderTexts) {
      expect(headerText).toBeTruthy();
      expect(svgTexts).not.toContain(headerText);
    }
  });

  it("格線對齊 Y 軸標示：max、min 高度各有一條淡化水平格線橫跨圖表寬度，顏色不是任何版本線的色票顏色", () => {
    const fb = fallbackLayout(7);
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
    expect(lines).toHaveLength(4); // SDLCCT-89：4 層等距格線

    const texts = container.querySelectorAll("svg text");
    const maxText = Array.from(texts).find((el) => el.textContent === "US$ 400");
    const minText = Array.from(texts).find((el) => el.textContent === "US$ 50.00");

    for (const line of lines) {
      expect(Number(line.getAttribute("x1"))).toBeCloseTo(fb.plotLeft, 1);
      expect(Number(line.getAttribute("x2"))).toBeCloseTo(fb.width, 1);
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

// 以下為測試者（非開發者）獨立補寫的驗證案例，涵蓋設計文件/開發者測試
// 未明確覆蓋的邊界條件（SDLCCT-78 驗收情境的額外探測）。
describe("VersionCostChart X 軸刻度與格線 — 測試者獨立補充驗證", () => {
  it("表格日期欄 th 帶 data-date-col，值為 fixedSevenDates 結果，第一欄「版本」不帶 (SDLCCT-88)", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-01-01", value: 10 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-01-05" />,
    );

    const ths = Array.from(container.querySelectorAll("thead th"));
    expect(ths[0].hasAttribute("data-date-col")).toBe(false);
    expect(
      Array.from(container.querySelectorAll("thead th[data-date-col]")).map((el) =>
        el.getAttribute("data-date-col"),
      ),
    ).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
    ]);
  });

  it("max === min（單一 Y 軸標示）時，格線恰好渲染 1 條，且高度對齊該單一標示", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 100 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    const svg = container.querySelector("svg");
    const lines = Array.from(svg?.querySelectorAll("line") ?? []);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.getAttribute("data-gridline")).toBe("single");

    const singleLabel = container.querySelector('svg g[data-axis="y"] text');
    expect(Number(lines[0]?.getAttribute("y1"))).toBeCloseTo(
      Number(singleLabel?.getAttribute("y")),
      1,
    );
    expect(lines[0]?.getAttribute("y1")).toBe(lines[0]?.getAttribute("y2"));
  });

  it("完全沒有任何非 null 數值時（labels 為空陣列），格線數量為 0，且不拋出例外", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
    ];

    expect(() =>
      render(<VersionCostChart entries={entries} anchorDate="2026-10-15" />),
    ).not.toThrow();

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.querySelectorAll("line")).toHaveLength(0);
  });

  it("entries 為空陣列時，格線數量為 0，且不拋出例外", () => {
    expect(() =>
      render(<VersionCostChart entries={[]} anchorDate="2026-10-15" />),
    ).not.toThrow();

    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-15" />,
    );
    expect(container.querySelector("svg")?.querySelectorAll("line")).toHaveLength(
      0,
    );
  });

  it("多條版本折線時，所有格線 <line> 在 DOM 順序上皆先於所有 <polyline>（而非僅驗證『最後一條格線早於第一條折線』這一個邊界）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 400 },
      ]),
      entry("v2", [
        { date: "2026-10-14", value: 50 },
        { date: "2026-10-15", value: 200 },
      ]),
      entry("v3", [
        { date: "2026-10-14", value: 300 },
        { date: "2026-10-15", value: 350 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    const svg = container.querySelector("svg");
    const allChildren = Array.from(svg?.querySelectorAll("line, polyline") ?? []);
    const lineIndices = allChildren
      .map((el, i) => (el.tagName.toLowerCase() === "line" ? i : -1))
      .filter((i) => i >= 0);
    const polylineIndices = allChildren
      .map((el, i) => (el.tagName.toLowerCase() === "polyline" ? i : -1))
      .filter((i) => i >= 0);

    expect(lineIndices.length).toBeGreaterThan(0);
    expect(polylineIndices.length).toBeGreaterThanOrEqual(3);
    const maxLineIndex = Math.max(...lineIndices);
    const minPolylineIndex = Math.min(...polylineIndices);
    expect(maxLineIndex).toBeLessThan(minPolylineIndex);
  });

  it("entries 為空陣列時圖表仍不渲染 X 軸日期群組，且表格標題列仍有 7 個日期欄 (SDLCCT-88)", () => {
    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-15" />,
    );

    expect(container.querySelector('svg g[data-axis="x"]')).toBeNull();
    expect(container.querySelectorAll("thead th[data-date-col]")).toHaveLength(7);
  });
});

describe("VersionCostChart 線條終點直接標籤 (SDLCCT-79)", () => {
  it("版本數 <= 4 時顯示終點直接標籤，且圖表下方不再顯示圖例色點＋文字", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 140 },
      ]),
      entry("v2", [
        { date: "2026-10-14", value: 300 },
        { date: "2026-10-15", value: 400 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    // 每條線最後一個有值的資料點旁有該版本名稱與金額的文字標籤。
    const tailTexts = Array.from(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    );
    expect(tailTexts).toHaveLength(2);
    const tailContents = tailTexts.map((el) => el.textContent);
    expect(tailContents).toContain("v1 US$ 140");
    expect(tailContents).toContain("v2 US$ 400");

    // 文字顏色採該版本折線自身的顏色（而非共用的次要文字色）。
    const COLORBLIND_SAFE_COLORS = ["#2a78d6", "#eb6834"];
    const fills = tailTexts.map((el) => el.getAttribute("fill"));
    expect(fills.sort()).toEqual([...COLORBLIND_SAFE_COLORS].sort());

    // 圖表下方不再顯示另一排圖例色點＋文字。
    expect(container.querySelectorAll("ul li")).toHaveLength(0);
  });

  it("版本數 > 4 時退回純圖例顯示：線條終點不顯示直接標籤，圖例列出全部 5 個版本", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-14", value: 100 }]),
      entry("v2", [{ date: "2026-10-14", value: 200 }]),
      entry("v3", [{ date: "2026-10-14", value: 300 }]),
      entry("v4", [{ date: "2026-10-14", value: 400 }]),
      entry("v5", [{ date: "2026-10-14", value: 500 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-14" />,
    );

    // 線條終點不顯示直接標籤。
    expect(container.querySelectorAll('svg g[data-labels="tail"]')).toHaveLength(0);
    expect(container.querySelectorAll('svg g[data-labels="tail"] text')).toHaveLength(
      0,
    );

    // 圖表下方顯示圖例色點＋文字列出全部 5 個版本。
    const legendItems = container.querySelectorAll("ul li");
    expect(legendItems).toHaveLength(5);
    const legendTexts = Array.from(legendItems).map((el) => el.textContent);
    expect(legendTexts).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  it("entry 全部 7 天皆為 null 時，不渲染該 entry 的終點標籤（本身也不會畫出折線）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
      entry("v2", [{ date: "2026-10-14", value: 100 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    const tailTexts = Array.from(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    );
    expect(tailTexts).toHaveLength(1);
    expect(tailTexts[0]?.textContent).toBe("v2 US$ 100");
  });
});

// 以下為測試者（非開發者）獨立補寫的驗證案例，涵蓋設計文件/開發者測試
// 未明確覆蓋的邊界條件：剛好 4/5 個版本的門檻邊界、終點非陣列最後索引
// 時的座標正確性、全 null 版本與正常版本混合、顏色與各自折線的精確配
// 對、以及 anchor 方向的邊界值（x === plotMidX）。
describe("VersionCostChart 線條終點直接標籤 — 測試者獨立補充驗證（邊界值）", () => {
  it("版本數恰好為 4（門檻值本身）時，仍走「<=4」分支：顯示終點標籤、隱藏圖例", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-14", value: 100 }]),
      entry("v2", [{ date: "2026-10-14", value: 200 }]),
      entry("v3", [{ date: "2026-10-14", value: 300 }]),
      entry("v4", [{ date: "2026-10-14", value: 400 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-14" />,
    );

    const tailTexts = container.querySelectorAll('svg g[data-labels="tail"] text');
    expect(tailTexts).toHaveLength(4);
    expect(container.querySelectorAll("ul li")).toHaveLength(0);
  });

  it("版本數恰好為 5（門檻值 + 1）時，走「>4」分支：隱藏終點標籤、顯示圖例列出全部 5 個版本", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-14", value: 100 }]),
      entry("v2", [{ date: "2026-10-14", value: 200 }]),
      entry("v3", [{ date: "2026-10-14", value: 300 }]),
      entry("v4", [{ date: "2026-10-14", value: 400 }]),
      entry("v5", [{ date: "2026-10-14", value: 500 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-14" />,
    );

    expect(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    ).toHaveLength(0);
    const legendItems = container.querySelectorAll("ul li");
    expect(legendItems).toHaveLength(5);
  });

  it("版本的最後一個有值的點不是陣列最後一個索引（第6天）時，終點標籤座標對齊該較早的點，而非第6天的位置", () => {
    // 7 天中只有索引 0-3（date 10-14 ~ 10-17）有值，索引 4-6（10-18~10-20）
    // 皆缺席；anchorDate=10-20 => dates = [10-14..10-20]，tailIndex 應為 3。
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 120 },
        { date: "2026-10-16", value: 140 },
        { date: "2026-10-17", value: 160 },
        // 10-18, 10-19, 10-20 缺席 => byDate 回傳 null
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const CHART_PADDING = 24;
    const fb = fallbackLayout(7);
    const innerHeight = 160 - CHART_PADDING * 2;
    // max === min 情境不適用（只有 1 個 entry 但 4 個不同值 100/120/140/160）
    // => max=160, min=100。yFor(160) 對齊圖表頂端 CHART_PADDING，但這裡只
    // 需驗證 x（座標對齊索引 3，非索引 6）與 y（對齊值 160 本身）。
    const expectedX = fb.centers[3]; // dateIndex=3 of 7（fallback 版面）
    const expectedY = CHART_PADDING; // value=160=max -> top of plot (yFor(max))
    void innerHeight;

    const tailText = container.querySelector('svg g[data-labels="tail"] text');
    expect(tailText?.textContent).toBe("v1 US$ 160");
    expect(Number(tailText?.getAttribute("x"))).not.toBeCloseTo(
      fb.centers[6],
      1,
    );
    // x 包含 ±6 的 dx 位移；expectedX=276（恰好 plotMidX），anchor 應為 "end"
    // (見下一個測試對 anchor 方向邊界的專門驗證)，故 dx=-6。
    expect(Number(tailText?.getAttribute("x"))).toBeCloseTo(expectedX - 6, 1);
    expect(Number(tailText?.getAttribute("y"))).toBeCloseTo(expectedY, 1);
  });

  it("全 null 版本與正常版本混合：全 null 版本不渲染標籤也不崩潰，其餘版本標籤座標/文字正確且互不影響", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
      entry("v2", [
        { date: "2026-10-14", value: 50 },
        { date: "2026-10-15", value: 200 },
      ]),
      entry("v3", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
    ];

    expect(() =>
      render(<VersionCostChart entries={entries} anchorDate="2026-10-15" />),
    ).not.toThrow();

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    const tailTexts = Array.from(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    );
    expect(tailTexts).toHaveLength(1);
    expect(tailTexts[0]?.textContent).toBe("v2 US$ 200");
  });

  it("每個終點標籤的 fill 與「同一個」entry 的 polyline stroke 精確配對（而非僅驗證色票集合相等）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("alpha", [
        { date: "2026-10-14", value: 10 },
        { date: "2026-10-15", value: 20 },
      ]),
      entry("beta", [
        { date: "2026-10-14", value: 30 },
        { date: "2026-10-15", value: 40 },
      ]),
      entry("gamma", [
        { date: "2026-10-14", value: 50 },
        { date: "2026-10-15", value: 60 },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    // 直接用 textContent 前綴（version 名稱）比對對應的折線顏色：取得每條
    // polyline 的 stroke，依照 entries 順序一一對應（元件渲染順序與
    // entries 順序相同，見實作第 137 行 entries.map）。
    const polylines = Array.from(container.querySelectorAll("svg polyline"));
    expect(polylines).toHaveLength(3);
    const strokesByEntryOrder = polylines.map((p) => p.getAttribute("stroke"));

    const tailTexts = Array.from(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    );
    expect(tailTexts).toHaveLength(3);

    entries.forEach((e, i) => {
      const label = tailTexts.find((el) => el.textContent?.startsWith(`${e.version} `));
      expect(label).toBeTruthy();
      expect(label?.getAttribute("fill")).toBe(strokesByEntryOrder[i]);
    });
  });

  it("anchor 方向邊界值：終點 x 恰好等於 plotMidX（fallback 276）時，採用 \"end\"（而非 \"start\"），與設計文件 x >= plotMidX 規則一致", () => {
    // dateIndex=3（7天陣列的正中央索引）對應 fallback centers[3] = 72 + 3.5*408/7 = 276，
    // 恰好等於 plotMidX = (72 + 480) / 2。
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 10 },
        { date: "2026-10-15", value: 20 },
        { date: "2026-10-16", value: 30 },
        { date: "2026-10-17", value: 40 },
        // 10-18, 10-19, 10-20 缺席 -> tailIndex = 3 -> x = 276
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const tailText = container.querySelector('svg g[data-labels="tail"] text');
    expect(tailText?.getAttribute("text-anchor")).toBe("end");
    // anchor="end" => dx=-6 => rendered x = 276 - 6 = 270
    expect(Number(tailText?.getAttribute("x"))).toBeCloseTo(270, 1);
  });
});

// Hover tooltip／十字線／可存取性備援（SDLCCT-80）：固定 7 天日期軸下，
// anchorDate="2026-10-20" => dates = [10-14..10-20]，D-2 對應 dateIndex=4
// （10-18）。jsdom 無版面，使用 fallbackLayout：centers[i] = 72 + (i+0.5)*408/7，
// xFor(4) = 72 + 4.5*408/7 ≈ 334.29（SDLCCT-88）。
describe("VersionCostChart Hover Tooltip／十字線／可存取性備援 (SDLCCT-80)", () => {
  const CHART_WIDTH = 480;
  const x4 = fallbackLayout(7).centers[4];

  function mockOverlayRectWidth(container: HTMLElement) {
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("svg not found");
    // jsdom 不做真實版面計算，getBoundingClientRect 預設全為 0；手動模擬
    // 「實際渲染寬度 === CHART_WIDTH」(scaleX = 1)，讓 clientX 可直接對應
    // viewBox 座標，不需要額外換算。
    svg.getBoundingClientRect = () =>
      ({
        width: CHART_WIDTH,
        height: 160,
        left: 0,
        top: 0,
        right: CHART_WIDTH,
        bottom: 160,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const overlayRect = svg.querySelector(":scope > rect");
    if (!overlayRect) throw new Error("overlay rect not found");
    return overlayRect;
  }

  it("Scenario: hover 顯示該日（D-2）所有版本數值，null 顯示「—」", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-18", value: 123 }]),
      entry("v2", [{ date: "2026-10-14", value: 50 }]), // 10-18 當天缺席 => null
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    // hover 前：無 tooltip。
    expect(container.querySelectorAll('svg g[data-tooltip="active"]')).toHaveLength(0);

    const overlayRect = mockOverlayRectWidth(container);
    // dateIndex=4 (D-2, 2026-10-18) 的 viewBox x 座標 = fallback centers[4]。
    fireEvent.mouseMove(overlayRect, { clientX: x4 });

    const tooltip = container.querySelector('svg g[data-tooltip="active"]');
    expect(tooltip).toBeTruthy();
    const texts = Array.from(tooltip?.querySelectorAll("text") ?? []).map(
      (el) => el.textContent,
    );
    expect(texts[0]).toContain("2026"); // 日期標題（formatTaiwanDate）
    expect(texts).toContain("v1: US$ 123");
    expect(texts).toContain("v2: —");

    // 十字線固定在 xFor(hoveredIndex)=centers[4]。
    const crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(crosshair).toBeTruthy();
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(x4, 1);
    expect(Number(crosshair?.getAttribute("x2"))).toBeCloseTo(x4, 1);

    // mouseLeave 清除 hover 狀態：tooltip／十字線消失。
    fireEvent.mouseLeave(overlayRect);
    expect(container.querySelectorAll('svg g[data-tooltip="active"]')).toHaveLength(0);
    expect(container.querySelectorAll("svg line[stroke-dasharray]")).toHaveLength(0);
  });

  it("Scenario: 鍵盤／螢幕閱讀器使用者不觸發 hover 時，圖表下方表格仍完整呈現所有日期與版本的數值", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-18", value: 123 },
      ]),
      entry("v2", [{ date: "2026-10-14", value: 50 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    // 零互動（預設 render，未觸發任何 mouseMove）：tooltip／十字線不存在。
    expect(container.querySelectorAll('svg g[data-tooltip="active"]')).toHaveLength(0);
    expect(container.querySelectorAll("svg line[stroke-dasharray]")).toHaveLength(0);

    // 表格仍完整呈現所有日期（7 欄）與版本（2 列）的數值，不依賴圖表互動。
    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(8); // 版本欄 + 7 天

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);

    const row1Cells = Array.from(rows[0]?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(row1Cells).toEqual([
      "v1",
      "US$ 100",
      "—",
      "—",
      "—",
      "US$ 123",
      "—",
      "—",
    ]);

    const row2Cells = Array.from(rows[1]?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(row2Cells).toEqual(["v2", "US$ 50.00", "—", "—", "—", "—", "—", "—"]);
  });
});

// 以下為測試者（非開發者）獨立補寫的驗證案例（SDLCCT-80），涵蓋設計
// 文件/開發者測試未明確覆蓋的邊界條件：7 個索引中的其他端點、剛好落
// 在兩個索引中點的最近鄰決定性、>4 版本時 tooltip 不受 showTailLabels
// 門檻限制、null entry 在 tooltip 內仍逐行列出、anchor 方向邊界值
// （x === plotMidX）、以及 hoveredIndex 在未離開 overlay 前連續移動時
// 正確更新。
describe("VersionCostChart Hover Tooltip — 測試者獨立補充驗證（邊界值）(SDLCCT-80)", () => {
  const CHART_WIDTH = 480;
  const fb = fallbackLayout(7);
  const plotMidX = (fb.plotLeft + fb.width) / 2; // 276

  function xForIndex(dateIndex: number): number {
    return fb.centers[dateIndex];
  }

  function mockOverlayRectWidth(container: HTMLElement) {
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("svg not found");
    svg.getBoundingClientRect = () =>
      ({
        width: CHART_WIDTH,
        height: 160,
        left: 0,
        top: 0,
        right: CHART_WIDTH,
        bottom: 160,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const overlayRect = svg.querySelector(":scope > rect");
    if (!overlayRect) throw new Error("overlay rect not found");
    return overlayRect;
  }

  function tooltipLines(container: HTMLElement): string[] {
    const tooltip = container.querySelector('svg g[data-tooltip="active"]');
    return Array.from(tooltip?.querySelectorAll("text") ?? []).map(
      (el) => el.textContent ?? "",
    );
  }

  it("索引 0（D-6，繪圖區最左端）hover 時命中 dateIndex=0，而非被誤判為其他索引", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-14", value: 10 }]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);
    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(0) });

    const lines = tooltipLines(container);
    // dateIndex=0 対應 2026-10-14；v1 在該日有值 10。
    expect(lines).toContain("v1: US$ 10.00");

    const crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(xForIndex(0), 1);
  });

  it("索引 6（D，繪圖區最右端）hover 時命中 dateIndex=6", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-20", value: 99 }]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);
    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(6) });

    const lines = tooltipLines(container);
    expect(lines).toContain("v1: US$ 99.00");

    const crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(xForIndex(6), 1);
  });

  it("游標恰好落在索引 2 與索引 3 之間的正中點時，最近鄰比對具決定性地固定選擇其中一側（嚴格 < 比較下為較小索引），而非隨機/不穩定", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-16", value: 20 }, // dateIndex 2
        { date: "2026-10-17", value: 30 }, // dateIndex 3
      ]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);
    const midpoint = (xForIndex(2) + xForIndex(3)) / 2;

    fireEvent.mouseMove(overlayRect, { clientX: midpoint });
    const firstPick = tooltipLines(container);

    fireEvent.mouseLeave(overlayRect);
    fireEvent.mouseMove(overlayRect, { clientX: midpoint });
    const secondPick = tooltipLines(container);

    // 兩次在完全相同座標的結果必須一致（具決定性，不是隨機命中）。
    expect(firstPick).toEqual(secondPick);
    // 迴圈用嚴格 `<` 比較、從 i=0 往後掃描，等距時不會被後面的索引覆蓋，
    // 固定選擇較小索引（index 2）。
    expect(firstPick).toContain("v1: US$ 20.00");
    expect(firstPick).not.toContain("v1: US$ 30.00");
  });

  it("5 個版本（> SDLCCT-79 的 4 門檻、此時圖例取代終點標籤）時，tooltip 仍列出全部 5 個版本，不受 showTailLabels 門檻限制", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-18", value: 100 }]),
      entry("v2", [{ date: "2026-10-18", value: 200 }]),
      entry("v3", [{ date: "2026-10-18", value: 300 }]),
      entry("v4", [{ date: "2026-10-18", value: 400 }]),
      entry("v5", [{ date: "2026-10-18", value: 500 }]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    // 先確認此情境確實落在 >4 的圖例分支（終點標籤不渲染）。
    expect(container.querySelectorAll('svg g[data-labels="tail"]')).toHaveLength(0);
    expect(container.querySelectorAll("ul li")).toHaveLength(5);

    const overlayRect = mockOverlayRectWidth(container);
    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(4) }); // 2026-10-18

    const lines = tooltipLines(container);
    expect(lines).toContain("v1: US$ 100");
    expect(lines).toContain("v2: US$ 200");
    expect(lines).toContain("v3: US$ 300");
    expect(lines).toContain("v4: US$ 400");
    expect(lines).toContain("v5: US$ 500");
    // 日期標題 + 5 個版本行 = 6 個 <text>。
    expect(lines).toHaveLength(6);
  });

  it("hover 到的日期中，某個 entry 當天缺席（非 null 值，整個 point 不存在）時，tooltip 仍顯示該 entry 一行，金額為「—」，而非整行省略", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-18", value: 55 }]),
      entry("v2", [{ date: "2026-10-14", value: 10 }]), // 10-18 當天完全缺席
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);
    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(4) });

    const lines = tooltipLines(container);
    // 日期標題 + 2 個版本行（v2 缺席但仍列出，顯示「—」）。
    expect(lines).toHaveLength(3);
    expect(lines).toContain("v1: US$ 55.00");
    expect(lines).toContain("v2: —");
  });

  it("anchor 方向邊界值：hoveredIndex 的 xFor 恰好等於 plotMidX（276）時，tooltip 向左延伸（採用與 11.2 相同的 >= 規則）", () => {
    // dateIndex=3（7 天陣列正中央）對應 fallback centers[3] = 276 = plotMidX。
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-10-17", value: 10 }]), // dateIndex 3
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);
    fireEvent.mouseMove(overlayRect, { clientX: plotMidX });

    const tooltip = container.querySelector('svg g[data-tooltip="active"]');
    const tooltipRect = tooltip?.querySelector("rect");
    const tooltipWidth = 140;
    const tooltipX = Number(tooltipRect?.getAttribute("x"));
    // >= plotMidX ⇒ 向左延伸：tooltipX = xFor(3) - tooltipWidth - 8 = 276 - 148 = 128。
    expect(tooltipX).toBeCloseTo(plotMidX - tooltipWidth - 8, 1);
  });

  it("連續 hover 移動到不同索引（未先觸發 mouseLeave）時，tooltip／十字線正確更新為最新索引，不會卡在舊索引", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 11 }, // dateIndex 0
        { date: "2026-10-20", value: 77 }, // dateIndex 6
      ]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const overlayRect = mockOverlayRectWidth(container);

    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(0) });
    expect(tooltipLines(container)).toContain("v1: US$ 11.00");
    let crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(xForIndex(0), 1);

    // 不觸發 mouseLeave，直接移動到另一個索引。
    fireEvent.mouseMove(overlayRect, { clientX: xForIndex(6) });
    const lines = tooltipLines(container);
    expect(lines).toContain("v1: US$ 77.00");
    expect(lines).not.toContain("v1: US$ 11.00");
    crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(xForIndex(6), 1);

    // 只會有一組 tooltip/十字線，不會疊加殘留舊的。
    expect(container.querySelectorAll('svg g[data-tooltip="active"]')).toHaveLength(1);
    expect(container.querySelectorAll("svg line[stroke-dasharray]")).toHaveLength(1);
  });

  it("可存取性備援獨立驗證：零 hover 互動下，表格完整呈現所有 7 個日期 × 全部版本的數值（含多版本、含 null）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 1 },
        { date: "2026-10-15", value: null },
        { date: "2026-10-16", value: 3 },
        { date: "2026-10-17", value: 4 },
        { date: "2026-10-18", value: 5 },
        { date: "2026-10-19", value: 6 },
        { date: "2026-10-20", value: 7 },
      ]),
      entry("v2", [{ date: "2026-10-14", value: 100 }]),
      entry("v3", []),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    // 完全未呼叫 fireEvent — 零 hover 互動。
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);

    const headerCells = Array.from(container.querySelectorAll("thead th")).map(
      (el) => el.textContent,
    );
    expect(headerCells).toHaveLength(8);

    const row1 = Array.from(rows[0]?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(row1).toEqual([
      "v1",
      "US$ 1.00",
      "—",
      "US$ 3.00",
      "US$ 4.00",
      "US$ 5.00",
      "US$ 6.00",
      "US$ 7.00",
    ]);

    const row2 = Array.from(rows[1]?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(row2).toEqual(["v2", "US$ 100", "—", "—", "—", "—", "—", "—"]);

    const row3 = Array.from(rows[2]?.querySelectorAll("td") ?? []).map(
      (el) => el.textContent,
    );
    expect(row3).toEqual(["v3", "—", "—", "—", "—", "—", "—", "—"]);
  });
});

// SDLCCT-88：資料點 X 座標對齊表格日期欄中心（量測機制）。
describe("VersionCostChart 欄中心對齊 (SDLCCT-88)", () => {
  type R = { left: number; right: number; width: number };
  const rect = (left: number, width: number): R => ({
    left,
    right: left + width,
    width,
  });

  // 模擬 layout：svg 左緣 100、寬 W；「版本」欄 [100, 100+labelW]，7 個日期欄
  // 等寬 colW 接續其後。
  function makeRects(W: number, labelW: number) {
    const colW = (W - labelW) / 7;
    return {
      svg: rect(100, W),
      first: rect(100, labelW),
      cols: Array.from({ length: 7 }, (_, i) => rect(100 + labelW + i * colW, colW)),
    };
  }

  let current = makeRects(1000, 100);
  let roCallbacks: Array<() => void> = [];
  let roObserved: Element[] = [];

  beforeEach(() => {
    roCallbacks = [];
    roObserved = [];
    class FakeRO {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe(el: Element) {
        roObserved.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        let r: R = rect(0, 0);
        if (this.tagName.toLowerCase() === "svg") {
          r = current.svg;
        } else if (this.matches("thead th[data-date-col]")) {
          const idx = Array.from(
            this.parentElement?.querySelectorAll("th[data-date-col]") ?? [],
          ).indexOf(this);
          r = current.cols[idx];
        } else if (this.matches("thead th:first-child")) {
          r = current.first;
        }
        return {
          ...r,
          x: r.left,
          y: 0,
          top: 0,
          bottom: 0,
          height: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const lineEntries: VersionCostSeriesEntry[] = [
    entry("v1", [
      { date: "2026-10-14", value: 10 },
      { date: "2026-10-15", value: 20 },
      { date: "2026-10-16", value: null },
      { date: "2026-10-17", value: 40 },
      { date: "2026-10-18", value: 50 },
      { date: "2026-10-19", value: 60 },
      { date: "2026-10-20", value: 70 },
    ]),
    entry("v2", [
      { date: "2026-10-14", value: 15 },
      { date: "2026-10-15", value: 25 },
      { date: "2026-10-16", value: 35 },
      { date: "2026-10-17", value: 45 },
      { date: "2026-10-18", value: 55 },
      { date: "2026-10-19", value: 65 },
      { date: "2026-10-20", value: 75 },
    ]),
  ];

  function polylineXs(container: HTMLElement): number[][] {
    return Array.from(container.querySelectorAll("svg polyline")).map((pl) =>
      (pl.getAttribute("points") ?? "")
        .split(" ")
        .map((pt) => Number(pt.split(",")[0])),
    );
  }

  function expectedCenters(): number[] {
    return current.cols.map((c) => c.left + c.width / 2 - current.svg.left);
  }

  it("computeLayout：由 rect 算出 width / plotLeft / 欄中心（相對 svg 左緣）", () => {
    const r = makeRects(1000, 100);
    const layout = computeLayout(r.svg, r.first, r.cols);
    expect(layout).not.toBeNull();
    expect(layout?.width).toBe(1000);
    expect(layout?.plotLeft).toBe(100);
    const colW = 900 / 7;
    expect(layout?.centers[0]).toBeCloseTo(100 + colW / 2, 6);
    expect(layout?.centers[6]).toBeCloseTo(100 + 6.5 * colW, 6);
  });

  it("computeLayout：svg 寬度 <= 0、任一欄寬 <= 0、缺「版本」欄或沒有日期欄時回傳 null", () => {
    const r = makeRects(1000, 100);
    expect(computeLayout(rect(0, 0), r.first, r.cols)).toBeNull();
    expect(
      computeLayout(r.svg, r.first, [...r.cols.slice(0, 6), rect(900, 0)]),
    ).toBeNull();
    expect(computeLayout(r.svg, null, r.cols)).toBeNull();
    expect(computeLayout(r.svg, r.first, [])).toBeNull();
  });

  it("fallbackLayout：width 480、plotLeft 72，centers 均分日期區且 centers[3] 為中點 276", () => {
    const fb = fallbackLayout(7);
    expect(fb.width).toBe(480);
    expect(fb.plotLeft).toBe(72);
    expect(fb.centers).toHaveLength(7);
    expect(fb.centers[3]).toBeCloseTo(276, 6);
  });

  it("情境 1：每個日期所有資料點 X 等於表格該日期欄中心（容差 toFixed(1)）", () => {
    current = makeRects(1000, 100);
    const { container } = render(
      <VersionCostChart entries={lineEntries} anchorDate="2026-10-20" />,
    );
    const centers = expectedCenters();
    const xs = polylineXs(container);
    // v1 在 10-16 為 null：兩段折線 [0,1] 與 [3..6]；v2 一段 [0..6]。
    expect(xs).toHaveLength(3);
    const dateIdxs = [
      [0, 1],
      [3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 6],
    ];
    xs.forEach((segment, s) =>
      segment.forEach((x, k) => {
        expect(Math.abs(x - centers[dateIdxs[s][k]])).toBeLessThanOrEqual(0.05);
      }),
    );
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1000 160");
  });

  it("情境 2：容器寬度改變（1280 -> 768）後觸發 ResizeObserver，資料點重新對齊", () => {
    current = makeRects(1280, 100);
    const { container } = render(
      <VersionCostChart entries={lineEntries} anchorDate="2026-10-20" />,
    );
    expect(roObserved.length).toBeGreaterThanOrEqual(2);
    expect(polylineXs(container)[2][6]).toBeCloseTo(expectedCenters()[6], 1);

    current = makeRects(768, 90);
    act(() => {
      roCallbacks.forEach((cb) => cb());
    });
    const centers = expectedCenters();
    polylineXs(container)[2].forEach((x, i) => {
      expect(Math.abs(x - centers[i])).toBeLessThanOrEqual(0.05);
    });
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 768 160");
  });

  it("情境 4：十字線 X 與 hover 日期的資料點 X 相同，終點標籤跟隨最後一個有值點，tooltip 列出全部版本", () => {
    current = makeRects(1000, 100);
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 10 },
        { date: "2026-10-17", value: 40 },
        { date: "2026-10-18", value: null },
      ]),
      entry("v2", [{ date: "2026-10-18", value: 55 }]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );
    const centers = expectedCenters();
    const overlay = container.querySelector("svg > rect");
    expect(overlay).toBeTruthy();
    expect(Number(overlay?.getAttribute("x"))).toBeCloseTo(100, 1);
    expect(Number(overlay?.getAttribute("width"))).toBeCloseTo(900, 1);

    // svg 左緣 100：clientX = 100 + 欄中心 -> 命中 dateIndex 4。
    fireEvent.mouseMove(overlay as Element, { clientX: 100 + centers[4] });
    const crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(centers[4], 1);
    expect(Number(crosshair?.getAttribute("y2"))).toBe(136);
    const tooltipTexts = Array.from(
      container.querySelectorAll('svg g[data-tooltip="active"] text'),
    ).map((el) => el.textContent);
    expect(tooltipTexts).toContain("v1: —");
    expect(tooltipTexts).toContain("v2: US$ 55.00");

    // v1 的最後一個有值點為 10-17 (index 3)；標籤 x = center ± 6。
    const tails = Array.from(
      container.querySelectorAll('svg g[data-labels="tail"] text'),
    );
    const v1Tail = tails.find((el) => el.textContent?.startsWith("v1 "));
    const tailX = Number(v1Tail?.getAttribute("x"));
    expect(Math.abs(tailX - centers[3])).toBeCloseTo(6, 1);
  });

  it("情境 5：null 前後斷線、不內插、不當作 0，表格該格顯示「—」", () => {
    current = makeRects(1000, 100);
    const { container } = render(
      <VersionCostChart entries={lineEntries} anchorDate="2026-10-20" />,
    );
    const centers = expectedCenters();
    const xs = polylineXs(container);
    // v1：10-16 (index 2) 的 X 不出現在 v1 任何折線點上。
    const v1Xs = [...xs[0], ...xs[1]];
    expect(v1Xs).toHaveLength(6);
    v1Xs.forEach((x) => expect(Math.abs(x - centers[2])).toBeGreaterThan(1));
    const firstRowCells = container.querySelectorAll("tbody tr:first-child td");
    expect(firstRowCells[3].textContent).toBe("—");
  });

  it("情境 3/6：無 data-axis=x、日期僅在表格標題列與 tooltip 第一行；role=img、aria-label、Y 軸標示與格線保留", () => {
    current = makeRects(1000, 100);
    const { container } = render(
      <VersionCostChart entries={lineEntries} anchorDate="2026-10-20" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBeTruthy();
    expect(container.querySelector('svg g[data-axis="x"]')).toBeNull();
    expect(container.querySelectorAll('svg g[data-axis="y"] text')).toHaveLength(2);
    expect(container.querySelectorAll("svg > g:first-of-type > line")).toHaveLength(4);
    expect(container.querySelector("table")).toBeTruthy();
    const headers = container.querySelectorAll("thead th");
    const secondDate = headers[2].textContent ?? "";
    expect(
      Array.from(container.querySelectorAll("svg text")).map((e) => e.textContent),
    ).not.toContain(secondDate);

    const overlay = container.querySelector("svg > rect") as Element;
    fireEvent.mouseMove(overlay, { clientX: 100 + expectedCenters()[1] });
    const first = container.querySelector('svg g[data-tooltip="active"] text');
    expect(first?.textContent).toBe(secondDate);
  });
});

describe("測試者獨立補充驗證 (SDLCCT-88)", () => {
  type R = { left: number; right: number; width: number };
  const rect = (left: number, width: number): R => ({ left, right: left + width, width });

  // 非等寬日期欄，避免「均分」假設讓錯誤實作恰好通過。
  function makeRects(W: number, labelW: number, widths?: number[]) {
    const ws = widths ?? Array.from({ length: 7 }, () => (W - labelW) / 7);
    let x = 50 + labelW;
    const cols = ws.map((w) => {
      const r = rect(x, w);
      x += w;
      return r;
    });
    return { svg: rect(50, W), first: rect(50, labelW), cols };
  }
  const UNEVEN = [60, 200, 90, 150, 100, 220, 80];

  let current = makeRects(1000, 100);
  let roCallbacks: Array<() => void> = [];
  let rectCalls = 0;

  beforeEach(() => {
    roCallbacks = [];
    rectCalls = 0;
    class FakeRO {
      constructor(cb: () => void) {
        roCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        rectCalls++;
        let r: R = rect(0, 0);
        if (this.tagName.toLowerCase() === "svg") {
          r = current.svg;
        } else if (this.matches("thead th[data-date-col]")) {
          const idx = Array.from(
            this.parentElement?.querySelectorAll("th[data-date-col]") ?? [],
          ).indexOf(this);
          r = current.cols[idx];
        } else if (this.matches("thead th:first-child")) {
          r = current.first;
        }
        return { ...r, x: r.left, y: 0, top: 0, bottom: 0, height: 0, toJSON: () => ({}) } as DOMRect;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const centers = () => current.cols.map((c) => c.left + c.width / 2 - current.svg.left);
  const D = [
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ];
  const full = (name: string, base: number) =>
    entry(name, D.map((date, i) => ({ date, value: base + i * 10 })));
  const xsOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("svg polyline")).map((pl) =>
      (pl.getAttribute("points") ?? "").split(" ").map((p) => Number(p.split(",")[0])),
    );
  const overlay = (c: HTMLElement) => c.querySelector("svg > rect") as Element;
  const crossX = (c: HTMLElement) =>
    Number(c.querySelector("svg line[stroke-dasharray]")?.getAttribute("x1"));

  it("非等寬日期欄：每個資料點 X 等於各自欄中心（不是均分）", () => {
    current = makeRects(1000, 100, UNEVEN);
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />,
    );
    const xs = xsOf(container)[0];
    expect(xs).toHaveLength(7);
    xs.forEach((x, i) => expect(Math.abs(x - centers()[i])).toBeLessThanOrEqual(0.05));
  });

  it("全 null：無折線、無終點標籤、無 Y 軸標示、無格線，表格全為「—」，hover 仍對齊欄中心", () => {
    current = makeRects(1000, 100, UNEVEN);
    const entries = [entry("v1", D.map((date) => ({ date, value: null })))];
    const { container } = render(<VersionCostChart entries={entries} anchorDate="2026-10-20" />);
    expect(container.querySelectorAll("svg polyline")).toHaveLength(0);
    expect(container.querySelectorAll('svg g[data-labels="tail"] text')).toHaveLength(0);
    expect(container.querySelectorAll('svg g[data-axis="y"] text')).toHaveLength(0);
    expect(container.querySelectorAll("svg > g:first-of-type > line")).toHaveLength(0);
    const cells = Array.from(container.querySelectorAll("tbody td")).slice(1);
    expect(cells.map((c) => c.textContent)).toEqual(Array(7).fill("—"));
    fireEvent.mouseMove(overlay(container), { clientX: 50 + centers()[4] });
    expect(crossX(container)).toBeCloseTo(centers()[4], 1);
    expect(container.textContent).not.toContain("US$ 0");
  });

  it("單一序列且只有一個非 null 點：恰一條單點折線，X 在該日欄中心，終點標籤在其旁", () => {
    current = makeRects(1000, 100, UNEVEN);
    const entries = [entry("v1", [{ date: "2026-10-17", value: 42 }])];
    const { container } = render(<VersionCostChart entries={entries} anchorDate="2026-10-20" />);
    const xs = xsOf(container);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toHaveLength(1);
    expect(Math.abs(xs[0][0] - centers()[3])).toBeLessThanOrEqual(0.05);
    const tail = container.querySelector('svg g[data-labels="tail"] text');
    expect(Math.abs(Number(tail?.getAttribute("x")) - centers()[3])).toBeCloseTo(6, 1);
  });

  it("首欄與末欄 hover：十字線 X 等於 centers[0] 與 centers[6]，tooltip 第一行為對應日期標題", () => {
    current = makeRects(1000, 100, UNEVEN);
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10), full("v2", 5)]} anchorDate="2026-10-20" />,
    );
    const ths = container.querySelectorAll("thead th");
    fireEvent.mouseMove(overlay(container), { clientX: 50 + centers()[0] });
    expect(crossX(container)).toBeCloseTo(centers()[0], 1);
    expect(container.querySelector('g[data-tooltip="active"] text')?.textContent).toBe(
      ths[1].textContent,
    );
    fireEvent.mouseMove(overlay(container), { clientX: 50 + centers()[6] });
    expect(crossX(container)).toBeCloseTo(centers()[6], 1);
    expect(container.querySelector('g[data-tooltip="active"] text')?.textContent).toBe(
      ths[7].textContent,
    );
  });

  it("非等寬欄時，hover 以真實欄中心最近鄰命中：兩中心中點兩側分別命中不同欄", () => {
    current = makeRects(1000, 100, UNEVEN);
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />,
    );
    const c = centers();
    const mid = (c[1] + c[2]) / 2;
    fireEvent.mouseMove(overlay(container), { clientX: 50 + mid - 1 });
    expect(crossX(container)).toBeCloseTo(c[1], 1);
    fireEvent.mouseMove(overlay(container), { clientX: 50 + mid + 1 });
    expect(crossX(container)).toBeCloseTo(c[2], 1);
  });

  it("量測回傳全零寬度時退回 fallbackLayout（viewBox 480、X 為 fallback 中心）且不拋例外", () => {
    current = makeRects(0, 0, Array(7).fill(0));
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />,
    );
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 480 160");
    const fb = fallbackLayout(7).centers;
    xsOf(container)[0].forEach((x, i) => expect(Math.abs(x - fb[i])).toBeLessThanOrEqual(0.05));
    expect(container.querySelectorAll("thead th")).toHaveLength(8);
  });

  it("量測由零變為有效時，ResizeObserver 觸發即從 fallback 切換到真實欄中心", () => {
    current = makeRects(0, 0, Array(7).fill(0));
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />,
    );
    current = makeRects(900, 80, UNEVEN);
    act(() => roCallbacks.forEach((cb) => cb()));
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 900 160");
    xsOf(container)[0].forEach((x, i) =>
      expect(Math.abs(x - centers()[i])).toBeLessThanOrEqual(0.05),
    );
  });

  it("entries 改變（rerender）時重新量測並對齊", () => {
    current = makeRects(1000, 100);
    const { container, rerender } = render(
      <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />,
    );
    const before = rectCalls;
    current = makeRects(700, 70, [40, 120, 90, 50, 100, 120, 100]);
    rerender(
      <VersionCostChart entries={[full("v1", 10), full("v2", 20)]} anchorDate="2026-10-20" />,
    );
    expect(rectCalls).toBeGreaterThan(before);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 700 160");
    xsOf(container).forEach((seg) =>
      seg.forEach((x, i) => expect(Math.abs(x - centers()[i])).toBeLessThanOrEqual(0.05)),
    );
  });

  it("版面未變動時 ResizeObserver 回呼不造成額外 commit（無回饋迴圈）；變動時只多出有限次 commit", () => {
    current = makeRects(1000, 100);
    let commits = 0;
    const { container } = render(
      <React.Profiler id="c" onRender={() => commits++}>
        <VersionCostChart entries={[full("v1", 10)]} anchorDate="2026-10-20" />
      </React.Profiler>,
    );
    // React 對「相同 state 的 setState」可能在第一次多做一次 bailout 渲染；
    // 先暖機一次，之後重複觸發相同版面不得再有任何 commit（否則為回饋迴圈）。
    act(() => roCallbacks.forEach((cb) => cb()));
    const base = commits;
    act(() => {
      for (let i = 0; i < 20; i++) roCallbacks.forEach((cb) => cb());
    });
    expect(commits).toBe(base);
    current = makeRects(800, 100);
    act(() => roCallbacks.forEach((cb) => cb()));
    expect(commits).toBeGreaterThan(base);
    expect(commits).toBeLessThanOrEqual(base + 2);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 800 160");
  });

  it("6 個版本：改用圖例、無終點標籤群組，資料點仍對齊欄中心，hover tooltip 列出全部版本", () => {
    current = makeRects(1000, 100, UNEVEN);
    const entries = ["v1", "v2", "v3", "v4", "v5", "v6"].map((v, i) => full(v, 10 + i));
    const { container } = render(<VersionCostChart entries={entries} anchorDate="2026-10-20" />);
    expect(container.querySelector('svg g[data-labels="tail"]')).toBeNull();
    expect(container.querySelectorAll("ul li")).toHaveLength(6);
    const all = xsOf(container);
    expect(all).toHaveLength(6);
    all.forEach((seg) =>
      seg.forEach((x, i) => expect(Math.abs(x - centers()[i])).toBeLessThanOrEqual(0.05)),
    );
    fireEvent.mouseMove(overlay(container), { clientX: 50 + centers()[5] });
    expect(container.querySelectorAll('g[data-tooltip="active"] text')).toHaveLength(7);
    expect(crossX(container)).toBeCloseTo(centers()[5], 1);
  });

  it("極窄容器（200px，版本欄 40px）：仍對齊欄中心，overlay 寬度為正且無 X 軸群組", () => {
    current = makeRects(200, 40);
    const { container } = render(
      <VersionCostChart entries={[full("v1", 10), full("v2", 20)]} anchorDate="2026-10-20" />,
    );
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 200 160");
    xsOf(container).forEach((seg) =>
      seg.forEach((x, i) => expect(Math.abs(x - centers()[i])).toBeLessThanOrEqual(0.05)),
    );
    expect(Number(overlay(container).getAttribute("width"))).toBeCloseTo(160, 1);
    expect(container.querySelector('svg g[data-axis="x"]')).toBeNull();
  });

  it("null 位於首日與末日：折線只含有值日，表格該格為「—」，終點標籤跟隨第 6 日", () => {
    current = makeRects(1000, 100, UNEVEN);
    const entries = [
      entry(
        "v1",
        D.map((date, i) => ({ date, value: i === 0 || i === 6 ? null : 10 + i })),
      ),
    ];
    const { container } = render(<VersionCostChart entries={entries} anchorDate="2026-10-20" />);
    const xs = xsOf(container);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toHaveLength(5);
    xs[0].forEach((x, k) => expect(Math.abs(x - centers()[k + 1])).toBeLessThanOrEqual(0.05));
    const cells = container.querySelectorAll("tbody td");
    expect(cells[1].textContent).toBe("—");
    expect(cells[7].textContent).toBe("—");
    const tail = container.querySelector('svg g[data-labels="tail"] text');
    expect(tail?.textContent).toContain("v1");
    expect(Math.abs(Number(tail?.getAttribute("x")) - centers()[5])).toBeCloseTo(6, 1);
  });
});

describe("VersionCostChart 4 層等距格線 (SDLCCT-89)", () => {
  const CHART_HEIGHT = 160;
  const CHART_PADDING = 24;
  const STEP = (CHART_HEIGHT - 2 * CHART_PADDING) / 3;

  const diffEntries = (): VersionCostSeriesEntry[] => [
    entry("v1", [
      { date: "2026-10-14", value: 100 },
      { date: "2026-10-15", value: 400 },
    ]),
    entry("v2", [
      { date: "2026-10-14", value: 50 },
      { date: "2026-10-15", value: 200 },
    ]),
    entry("v3", [
      { date: "2026-10-14", value: 300 },
      { date: "2026-10-15", value: 350 },
    ]),
  ];

  const gridYs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("svg g[data-gridlines] > line")).map((l) =>
      Number(l.getAttribute("y1")),
    );

  it("情境 1：max != min 時恰 4 條格線，順序 max/upper/lower/min，Y 嚴格遞增且等距，端點對齊 Y 標示", () => {
    const { container } = render(
      <VersionCostChart entries={diffEntries()} anchorDate="2026-10-15" />,
    );
    const lines = Array.from(container.querySelectorAll("svg g[data-gridlines] > line"));
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.getAttribute("data-gridline"))).toEqual([
      "max",
      "upper",
      "lower",
      "min",
    ]);
    const ys = gridYs(container);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
      expect(ys[i] - ys[i - 1]).toBeCloseTo(STEP, 1);
    }
    const texts = Array.from(container.querySelectorAll('svg g[data-axis="y"] text'));
    const maxText = texts.find((el) => el.textContent === "US$ 400");
    const minText = texts.find((el) => el.textContent === "US$ 50.00");
    expect(ys[0]).toBeCloseTo(Number(maxText?.getAttribute("y")), 1);
    expect(ys[3]).toBeCloseTo(Number(minText?.getAttribute("y")), 1);
  });

  it("情境 1 補強：中間兩條 Y 等於線性公式對 min+Δ/3、min+2Δ/3 的結果", () => {
    const { container } = render(
      <VersionCostChart entries={diffEntries()} anchorDate="2026-10-15" />,
    );
    const min = 50;
    const max = 400;
    const inner = CHART_HEIGHT - 2 * CHART_PADDING;
    const yFor = (v: number) =>
      CHART_PADDING + inner - ((v - min) / (max - min)) * inner;
    const ys = gridYs(container);
    const d = max - min;
    expect(ys[1]).toBeCloseTo(yFor(min + (2 * d) / 3), 1);
    expect(ys[2]).toBeCloseTo(yFor(min + d / 3), 1);
  });

  it("情境 2：max === min 時恰 1 條格線，data-gridline=single，Y 等於單一標示 Y", () => {
    const entries = [
      entry("v1", [
        { date: "2026-10-14", value: 100 },
        { date: "2026-10-15", value: 100 },
      ]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    const lines = container.querySelectorAll("svg g[data-gridlines] > line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-gridline")).toBe("single");
    const label = container.querySelector('svg g[data-axis="y"] text');
    expect(Number(lines[0].getAttribute("y1"))).toBeCloseTo(
      Number(label?.getAttribute("y")),
      1,
    );
  });

  it("情境 3：全 null 與空陣列皆無格線、無任何 Y 標示、無 0 刻度", () => {
    const allNull = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
    ];
    for (const entries of [allNull, []]) {
      const { container, unmount } = render(
        <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
      );
      expect(container.querySelectorAll("svg g[data-gridlines] > line")).toHaveLength(0);
      expect(container.querySelectorAll('svg g[data-axis="y"] text')).toHaveLength(0);
      const all = Array.from(container.querySelectorAll("svg text")).map(
        (e) => e.textContent,
      );
      expect(all).not.toContain("US$ 0");
      expect(all).not.toContain("0");
      unmount();
    }
  });

  it("情境 4：格線 stroke 為 var(--color-border)、無 stroke-dasharray，且全部先於所有 <polyline>", () => {
    const { container } = render(
      <VersionCostChart entries={diffEntries()} anchorDate="2026-10-15" />,
    );
    const lines = Array.from(container.querySelectorAll("svg g[data-gridlines] > line"));
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(l.getAttribute("stroke")).toBe("var(--color-border)");
      expect(l.hasAttribute("stroke-dasharray")).toBe(false);
    }
    const ordered = Array.from(
      container.querySelectorAll("svg g[data-gridlines] > line, svg polyline"),
    );
    const lastLine = Math.max(
      ...ordered.map((el, i) => (el.tagName.toLowerCase() === "line" ? i : -1)),
    );
    const polys = ordered
      .map((el, i) => (el.tagName.toLowerCase() === "polyline" ? i : -1))
      .filter((i) => i >= 0);
    expect(polys.length).toBeGreaterThanOrEqual(3);
    expect(lastLine).toBeLessThan(Math.min(...polys));
  });

  it("情境 5：Y 標示恰 2 個（max/min），格線群組無 <text>，中間層級金額不出現", () => {
    const { container } = render(
      <VersionCostChart entries={diffEntries()} anchorDate="2026-10-15" />,
    );
    const ytexts = Array.from(container.querySelectorAll('svg g[data-axis="y"] text'));
    expect(ytexts.map((e) => e.textContent)).toEqual(["US$ 400", "US$ 50.00"]);
    expect(container.querySelectorAll("svg g[data-gridlines] text")).toHaveLength(0);
    const all = Array.from(container.querySelectorAll("svg text")).map((e) => e.textContent);
    expect(all).not.toContain("US$ 167"); // min + Δ/3 ≈ 166.67
    expect(all).not.toContain("US$ 283"); // min + 2Δ/3 ≈ 283.33
  });

  it("含 null 但仍有非 null 值（max != min）時仍為 4 條格線", () => {
    const entries = [
      entry("v1", [
        { date: "2026-10-13", value: null },
        { date: "2026-10-14", value: 10 },
        { date: "2026-10-15", value: 70 },
      ]),
    ];
    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );
    expect(container.querySelectorAll("svg g[data-gridlines] > line")).toHaveLength(4);
  });

  it("hover 後 svg line[stroke-dasharray] 恆為 1 條（格線不被誤計）", () => {
    const { container } = render(
      <VersionCostChart entries={diffEntries()} anchorDate="2026-10-15" />,
    );
    expect(container.querySelectorAll("svg line[stroke-dasharray]")).toHaveLength(0);
    const overlay = container.querySelector("svg > rect");
    if (!overlay) throw new Error("overlay not found");
    fireEvent.mouseMove(overlay, { clientX: 100 });
    expect(container.querySelectorAll("svg line[stroke-dasharray]")).toHaveLength(1);
    expect(container.querySelectorAll("svg g[data-gridlines] > line")).toHaveLength(4);
  });
});
