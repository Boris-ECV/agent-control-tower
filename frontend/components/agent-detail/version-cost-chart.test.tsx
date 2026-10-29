import { fireEvent, render } from "@testing-library/react";
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

// 以下為測試者（非開發者）獨立補寫的驗證案例，涵蓋設計文件/開發者測試
// 未明確覆蓋的邊界條件（SDLCCT-78 驗收情境的額外探測）。
describe("VersionCostChart X 軸刻度與格線 — 測試者獨立補充驗證", () => {
  it("X 軸標籤文字與表格對應欄位日期逐字相同（不同 anchorDate，獨立渲染比對，非僅同呼叫同一格式化函式）", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [{ date: "2026-01-01", value: 10 }]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-01-05" />,
    );

    const xAxisTexts = Array.from(
      container.querySelectorAll('svg g[data-axis="x"] text'),
    ).map((el) => el.textContent);

    const headerCells = Array.from(
      container.querySelectorAll("thead th"),
    ).slice(1);
    const dateHeaderTexts = headerCells.map((el) => el.textContent);

    // D-6 (索引0) 與 D (索引6) 兩個端點文字必須與表格欄位文字完全相同
    // （byte-for-byte），而不只是「兩邊都呼叫了 formatTaiwanDate」。
    expect(xAxisTexts).toContain(dateHeaderTexts[0]);
    expect(xAxisTexts).toContain(dateHeaderTexts[6]);
    // 確認表格欄位文字本身非空字串，避免兩邊都是空字串造成偽陽性。
    expect(dateHeaderTexts[0]).toBeTruthy();
    expect(dateHeaderTexts[6]).toBeTruthy();
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

  it("X 軸日期標籤列為固定渲染：entries 為空陣列時仍渲染 X 軸日期標籤（不依賴 hasValues/labels）", () => {
    const { container } = render(
      <VersionCostChart entries={[]} anchorDate="2026-10-15" />,
    );

    const xAxisTexts = container.querySelectorAll('svg g[data-axis="x"] text');
    expect(xAxisTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("X 軸日期標籤列為固定渲染：所有數值皆為 null 時仍渲染 X 軸日期標籤", () => {
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: null },
        { date: "2026-10-15", value: null },
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-15" />,
    );

    const xAxisTexts = container.querySelectorAll('svg g[data-axis="x"] text');
    expect(xAxisTexts.length).toBeGreaterThanOrEqual(2);
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
    const innerWidth = 480 - CHART_PADDING * 2;
    const innerHeight = 160 - CHART_PADDING * 2;
    // max === min 情境不適用（只有 1 個 entry 但 4 個不同值 100/120/140/160）
    // => max=160, min=100。yFor(160) 對齊圖表頂端 CHART_PADDING，但這裡只
    // 需驗證 x（座標對齊索引 3，非索引 6）與 y（對齊值 160 本身）。
    const expectedX = CHART_PADDING + (3 / 6) * innerWidth; // dateIndex=3 of 7
    const expectedY = CHART_PADDING; // value=160=max -> top of plot (yFor(max))
    void innerHeight;

    const tailText = container.querySelector('svg g[data-labels="tail"] text');
    expect(tailText?.textContent).toBe("v1 US$ 160");
    expect(Number(tailText?.getAttribute("x"))).not.toBeCloseTo(
      CHART_PADDING + (6 / 6) * innerWidth,
      1,
    );
    // x 包含 ±6 的 dx 位移；expectedX=240（恰好 plotMidX），anchor 應為 "end"
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

  it("anchor 方向邊界值：終點 x 恰好等於 plotMidX（240）時，採用 \"end\"（而非 \"start\"），與設計文件 x >= plotMidX 規則一致", () => {
    // dateIndex=3（7天陣列的正中央索引）對應 x = 24 + 3/6*432 = 240，
    // 恰好等於 plotMidX。
    const entries: VersionCostSeriesEntry[] = [
      entry("v1", [
        { date: "2026-10-14", value: 10 },
        { date: "2026-10-15", value: 20 },
        { date: "2026-10-16", value: 30 },
        { date: "2026-10-17", value: 40 },
        // 10-18, 10-19, 10-20 缺席 -> tailIndex = 3 -> x = 240
      ]),
    ];

    const { container } = render(
      <VersionCostChart entries={entries} anchorDate="2026-10-20" />,
    );

    const tailText = container.querySelector('svg g[data-labels="tail"] text');
    expect(tailText?.getAttribute("text-anchor")).toBe("end");
    // anchor="end" => dx=-6 => rendered x = 240 - 6 = 234
    expect(Number(tailText?.getAttribute("x"))).toBeCloseTo(234, 1);
  });
});

// Hover tooltip／十字線／可存取性備援（SDLCCT-80）：固定 7 天日期軸下，
// anchorDate="2026-10-20" => dates = [10-14..10-20]，D-2 對應 dateIndex=4
// （10-18）。CHART_WIDTH=480、CHART_PADDING=24、innerWidth=432，
// xFor(4) = 24 + (4/6)*432 = 312。
describe("VersionCostChart Hover Tooltip／十字線／可存取性備援 (SDLCCT-80)", () => {
  const CHART_WIDTH = 480;

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
    // dateIndex=4 (D-2, 2026-10-18) 的 viewBox x 座標 = 312。
    fireEvent.mouseMove(overlayRect, { clientX: 312 });

    const tooltip = container.querySelector('svg g[data-tooltip="active"]');
    expect(tooltip).toBeTruthy();
    const texts = Array.from(tooltip?.querySelectorAll("text") ?? []).map(
      (el) => el.textContent,
    );
    expect(texts[0]).toContain("2026"); // 日期標題（formatTaiwanDate）
    expect(texts).toContain("v1: US$ 123");
    expect(texts).toContain("v2: —");

    // 十字線固定在 xFor(hoveredIndex)=312。
    const crosshair = container.querySelector("svg line[stroke-dasharray]");
    expect(crosshair).toBeTruthy();
    expect(Number(crosshair?.getAttribute("x1"))).toBeCloseTo(312, 1);
    expect(Number(crosshair?.getAttribute("x2"))).toBeCloseTo(312, 1);

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
