"use client";

import * as React from "react";

import type { VersionCostSeriesEntry } from "@/lib/agent-detail-api";
import { formatCurrency, formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// 多序列折線圖：手刻 inline SVG，延伸 frontend/app/agents/page.tsx 的
// Sparkline 手法為多條 <polyline>（見 docs/design/SDLCCT-48.md 決策 3）。
// 不引入圖表函式庫。value === null 的點造成線段斷點，不內插、不當作 0。
// SDLCCT-88：資料點 X 座標對齊下方表格各日期欄中心，機制為量測真實 <th>
// 欄中心（getBoundingClientRect + ResizeObserver），詳見
// docs/design/SDLCCT-88.md。圖表內不再繪製 X 軸日期文字。
// SDLCCT-89：Y 方向 4 層等距淡色水平格線（像素空間公式），詳見
// docs/design/SDLCCT-89.md。
// SDLCCT-90：折線下方面積漸層，重用折線 runs，React.useId 產生漸層 id，
// 詳見 docs/design/SDLCCT-90.md。
const CHART_HEIGHT = 160;
const CHART_PADDING = 24;
const CHART_BASELINE = CHART_HEIGHT - CHART_PADDING;
const AREA_TOP_OPACITY = 0.15;
const FALLBACK_WIDTH = 480;
const FALLBACK_LABEL_COL = 72;
const GRIDLINE_LEVELS = 4;

export type ChartLayout = {
  width: number;
  plotLeft: number;
  centers: number[];
};

type RectLike = { left: number; right: number; width: number };

export function fallbackLayout(n: number): ChartLayout {
  const span = FALLBACK_WIDTH - FALLBACK_LABEL_COL;
  return {
    width: FALLBACK_WIDTH,
    plotLeft: FALLBACK_LABEL_COL,
    centers: Array.from(
      { length: n },
      (_, i) => FALLBACK_LABEL_COL + ((i + 0.5) * span) / n,
    ),
  };
}

// 純函式：由 svg / 「版本」欄 / 各日期欄 rect 計算版面；不可量測回傳 null。
export function computeLayout(
  svgRect: RectLike,
  firstThRect: RectLike | null,
  thRects: RectLike[],
): ChartLayout | null {
  if (svgRect.width <= 0 || !firstThRect || thRects.length === 0) return null;
  if (thRects.some((r) => r.width <= 0)) return null;
  return {
    width: svgRect.width,
    plotLeft: firstThRect.right - svgRect.left,
    centers: thRects.map((r) => r.left + r.width / 2 - svgRect.left),
  };
}

function measureLayout(svg: SVGSVGElement, table: HTMLTableElement): ChartLayout | null {
  const ths = Array.from(
    table.querySelectorAll<HTMLElement>("thead th[data-date-col]"),
  );
  const first = table.querySelector<HTMLElement>("thead th:first-child");
  return computeLayout(
    svg.getBoundingClientRect(),
    first ? first.getBoundingClientRect() : null,
    ths.map((th) => th.getBoundingClientRect()),
  );
}

function sameLayout(a: ChartLayout, b: ChartLayout): boolean {
  return (
    a.centers.length === b.centers.length &&
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.plotLeft - b.plotLeft) < 0.01 &&
    a.centers.every((c, i) => Math.abs(c - b.centers[i]) < 0.01)
  );
}

// 固定色票，依 version 的索引輪替（不依賴任何圖表函式庫的調色盤）。
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

// 終點直接標籤（SDLCCT-79）：對 byDate(entry) 回傳的 values 陣列，從尾端
// 往前找第一個非 null 索引（「最後一個有值的點」），-1 代表全 null。
function lastValidIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return i;
  }
  return -1;
}

function fixedSevenDates(anchorDate: string): string[] {
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

type Pt = { x: number; y: number };
const fmtPt = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

export function VersionCostChart({
  entries,
  anchorDate,
}: {
  entries: VersionCostSeriesEntry[];
  anchorDate: string; // "YYYY-MM-DD", UTC midnight convention, same as AgentCostBreakdownResponse.anchor_date
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const uid = React.useId().replace(/:/g, "");

  const dates = fixedSevenDates(anchorDate);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [layout, setLayout] = React.useState<ChartLayout>(() =>
    fallbackLayout(dates.length),
  );

  React.useLayoutEffect(() => {
    const update = () => {
      const svg = svgRef.current;
      const table = tableRef.current;
      if (!svg || !table) return;
      const next = measureLayout(svg, table);
      if (!next) return;
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    if (tableRef.current) observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [entries, anchorDate]);

  const allValues = entries
    .flatMap((entry) => entry.points)
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 0;

  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;

  const yFor = (value: number) =>
    max === min
      ? CHART_PADDING + innerHeight / 2
      : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;

  const xFor = (dateIndex: number) => layout.centers[dateIndex];

  // Y 軸金額標示（SDLCCT-73）：僅在有非 null 數值時顯示，絕不臆測 0
  // (CONSTITUTION「缺值顯示未知，不顯示 0」)。max === min 時僅顯示一個標示。
  const hasValues = allValues.length > 0;
  const labels = !hasValues
    ? []
    : max === min
      ? [{ key: "single", value: max, y: yFor(max) }]
      : [
          { key: "max", value: max, y: yFor(max) },
          { key: "min", value: min, y: yFor(min) },
        ];

  // 格線（SDLCCT-89）：與 Y 軸標示解耦。max !== min 時 4 條等距（像素空間），
  // max === min 時僅 1 條位於單一標示高度，無值時不畫。
  const gridlines: {
    key: "max" | "upper" | "lower" | "min" | "single";
    y: number;
  }[] = !hasValues
    ? []
    : max === min
      ? [{ key: "single", y: yFor(max) }]
      : (["max", "upper", "lower", "min"] as const).map((key, k) => ({
          key,
          y: CHART_PADDING + (k * innerHeight) / (GRIDLINE_LEVELS - 1),
        }));

  const byDate = (entry: VersionCostSeriesEntry) => {
    const map = new Map(entry.points.map((p) => [p.date, p.value]));
    return dates.map((date) => map.get(date) ?? null);
  };

  // 終點直接標籤 vs 圖例（SDLCCT-79）：資料序列數 <= 4 時使用線條終點直接
  // 標籤取代圖例；> 4 時直接標籤互相重疊風險高，退回純圖例顯示。門檻值 4
  // 為 spec 定案數字。
  const showTailLabels = entries.length <= 4;
  const plotMidX = (layout.plotLeft + layout.width) / 2;
  const tailLabels: { key: string; x: number; y: number; color: string; text: string }[] = [];

  // 每序列的連續非 null 線段（runs，數值座標）：折線 points 與面積 d 共用
  // 同一份 runs 與 fmtPt，斷點與座標不可能分歧（SDLCCT-90）。
  const seriesRender = entries.map((entry, entryIndex) => {
    const values = byDate(entry);
    const runs: Pt[][] = [];
    let current: Pt[] = [];
    values.forEach((value, dateIndex) => {
      if (value === null) {
        if (current.length > 0) runs.push(current);
        current = [];
        return;
      }
      current.push({ x: xFor(dateIndex), y: yFor(value) });
    });
    if (current.length > 0) runs.push(current);

    const color = COLORS[entryIndex % COLORS.length];

    // 終點直接標籤（SDLCCT-79）：重用同一個 values 陣列（與折線斷點
    // 判斷同一個「有值」定義），不重新解析 entry.points。
    const tailIndex = lastValidIndex(values);
    if (tailIndex !== -1) {
      tailLabels.push({
        key: entry.version,
        x: xFor(tailIndex),
        y: yFor(values[tailIndex] as number),
        color,
        text: `${entry.version} ${formatCurrency(values[tailIndex] as number)}`,
      });
    }
    return { entry, entryIndex, runs, color };
  });

  // Hover hit-testing（SDLCCT-80）：單一全高透明 <rect> overlay，把游標的
  // 螢幕像素座標換算回 viewBox 座標系統後，找出最接近的 dateIndex。
  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = layout.width / rect.width;
    const svgX = (event.clientX - rect.left) * scaleX;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < dates.length; i++) {
      const dist = Math.abs(xFor(i) - svgX);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    setHoveredIndex(closest);
  };

  const handleMouseLeave = () => setHoveredIndex(null);

  // Tooltip（SDLCCT-80）：列出 entries 全部成員，不受 showTailLabels 門檻
  // 限制；定位以 xFor(hoveredIndex) 為錨點，依左半/右半決定延伸方向。
  const tooltipWidth = 140;
  const tooltipHeight = 14 + (entries.length + 1) * 14 + 6;
  const tooltipAnchorRight =
    hoveredIndex !== null ? xFor(hoveredIndex) >= plotMidX : false;
  const tooltipX =
    hoveredIndex !== null
      ? tooltipAnchorRight
        ? xFor(hoveredIndex) - tooltipWidth - 8
        : xFor(hoveredIndex) + 8
      : 0;
  const tooltipY = CHART_PADDING;

  return (
    <div ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${CHART_HEIGHT}`}
        width="100%"
        height={CHART_HEIGHT}
        role="img"
        aria-label={t("agentDetail.versionSeries.title")}
        className="mb-3"
        style={{ overflow: "visible" }}
      >
        {/* 格線（SDLCCT-78/89）：必須在資料折線之前渲染，確保視覺上位於折線
            後方。不帶 strokeDasharray（十字線專用）、不含 <text>。 */}
        <g data-gridlines>
          {gridlines.map((line) => (
            <line
              key={line.key}
              data-gridline={line.key}
              x1={layout.plotLeft}
              x2={layout.width}
              y1={line.y}
              y2={line.y}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
          ))}
        </g>

        {/* 面積（SDLCCT-90）：位於格線之後、折線之前；純裝飾，不攔截事件。 */}
        <g data-areas aria-hidden="true" pointerEvents="none">
          <defs>
            {seriesRender
              .filter((s) => s.runs.some((r) => r.length >= 2))
              .map((s) => (
                <linearGradient
                  key={s.entry.version}
                  id={`${uid}-area-${s.entryIndex}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0" stopColor={s.color} stopOpacity={AREA_TOP_OPACITY} />
                  <stop offset="1" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
          </defs>
          {seriesRender.flatMap((s) =>
            s.runs.map((run, runIndex) => {
              if (run.length < 2) return null;
              const first = run[0];
              const last = run[run.length - 1];
              const d = `M ${run.map(fmtPt).join(" L ")} L ${last.x.toFixed(1)},${CHART_BASELINE.toFixed(1)} L ${first.x.toFixed(1)},${CHART_BASELINE.toFixed(1)} Z`;
              return (
                <path
                  key={`${s.entry.version}-${runIndex}`}
                  data-area={s.entry.version}
                  data-run={runIndex}
                  d={d}
                  fill={`url(#${uid}-area-${s.entryIndex})`}
                  stroke="none"
                  pointerEvents="none"
                />
              );
            }),
          )}
        </g>

        {seriesRender.map((s) => (
          <g key={s.entry.version}>
            {s.runs.map((run, i) => (
              <polyline
                key={i}
                points={run.map(fmtPt).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
              />
            ))}
          </g>
        ))}

        <g data-axis="y">
          {labels.map((label) => (
            <text
              key={label.key}
              x={2}
              y={label.y}
              textAnchor="start"
              fontSize={10}
              fill="var(--color-text-secondary)"
              dominantBaseline="middle"
            >
              {formatCurrency(label.value)}
            </text>
          ))}
        </g>

        {/* 終點直接標籤（SDLCCT-79）：插入在既有順序最後（所有折線與軸線
            標籤之後），確保視覺堆疊順序上位於最上層。entries.length > 4
            時完全不渲染（連空 <g> 也不輸出）。 */}
        {showTailLabels && (
          <g data-labels="tail">
            {tailLabels.map((label) => {
              const anchor: "start" | "end" = label.x >= plotMidX ? "end" : "start";
              const dx = anchor === "end" ? -6 : 6;
              return (
                <text
                  key={label.key}
                  x={label.x + dx}
                  y={label.y}
                  textAnchor={anchor}
                  fontSize={10}
                  fill={label.color}
                  dominantBaseline="middle"
                >
                  {label.text}
                </text>
              );
            })}
          </g>
        )}

        {/* Hover hit-test overlay（SDLCCT-80）：插入在既有 SVG 內容最後，
            確保在視覺/事件堆疊順序上位於最上層。fill="transparent"（非
            "none"）才能接收滑鼠事件。 */}
        <rect
          x={layout.plotLeft}
          y={0}
          width={layout.width - layout.plotLeft}
          height={CHART_HEIGHT}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* 十字線（SDLCCT-80）：虛線、次要文字色，避免被誤認為資料序列。 */}
        {hoveredIndex !== null && (
          <line
            x1={xFor(hoveredIndex)}
            x2={xFor(hoveredIndex)}
            y1={CHART_PADDING}
            y2={CHART_HEIGHT - CHART_PADDING}
            stroke="var(--color-text-secondary)"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}

        {/* Tooltip（SDLCCT-80）：SVG-native 結構，列出 entries 全部成員，
            null 經由既有 formatCurrency 顯示「—」。 */}
        {hoveredIndex !== null && (
          <g data-tooltip="active">
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              fill="var(--color-bg)"
              stroke="var(--color-border)"
              rx={4}
            />
            <text
              x={tooltipX + 8}
              y={tooltipY + 14}
              fontSize={10}
              fill="var(--color-text-primary)"
              fontWeight={600}
            >
              {formatTaiwanDate(dates[hoveredIndex])}
            </text>
            {entries.map((entry, i) => (
              <text
                key={entry.version}
                x={tooltipX + 8}
                y={tooltipY + 14 + (i + 1) * 14}
                fontSize={10}
                fill={COLORS[i % COLORS.length]}
              >
                {`${entry.version}: ${formatCurrency(byDate(entry)[hoveredIndex])}`}
              </text>
            ))}
          </g>
        )}
      </svg>

      {!showTailLabels && (
        <ul className="mb-4 flex flex-wrap gap-3 p-0 text-xs text-text-secondary">
          {entries.map((entry, entryIndex) => (
            <li key={entry.version} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: COLORS[entryIndex % COLORS.length] }}
              />
              {entry.version}
            </li>
          ))}
        </ul>
      )}

      <table ref={tableRef} className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-secondary">
            <th className="py-2 pr-3">
              {t("agentDetail.versionSeries.table.columns.version")}
            </th>
            {dates.map((date) => (
              <th key={date} data-date-col={date} className="py-2 pr-3">
                {formatTaiwanDate(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const values = byDate(entry);
            return (
              <tr key={entry.version} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3 font-medium text-text-primary">{entry.version}</td>
                {values.map((value, i) => (
                  <td key={dates[i]} className="py-2 pr-3">
                    {formatCurrency(value)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
