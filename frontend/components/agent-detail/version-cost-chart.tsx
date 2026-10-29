"use client";

import type { VersionCostSeriesEntry } from "@/lib/agent-detail-api";
import { formatCurrency, formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// 多序列折線圖：手刻 inline SVG，延伸 frontend/app/agents/page.tsx 的
// Sparkline 手法為多條 <polyline>（見 docs/design/SDLCCT-48.md 決策 3）。
// 不引入圖表函式庫。value === null 的點造成線段斷點，不內插、不當作 0。
const CHART_WIDTH = 480;
const CHART_HEIGHT = 160;
const CHART_PADDING = 24;

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

export function VersionCostChart({
  entries,
  anchorDate,
}: {
  entries: VersionCostSeriesEntry[];
  anchorDate: string; // "YYYY-MM-DD", UTC midnight convention, same as AgentCostBreakdownResponse.anchor_date
}) {
  const dates = fixedSevenDates(anchorDate);

  const allValues = entries
    .flatMap((entry) => entry.points)
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 0;

  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;

  const yFor = (value: number) =>
    max === min
      ? CHART_PADDING + innerHeight / 2
      : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;

  const xFor = (dateIndex: number) =>
    dates.length > 1
      ? CHART_PADDING + (dateIndex / (dates.length - 1)) * innerWidth
      : CHART_PADDING + innerWidth / 2;

  const toXY = (dateIndex: number, value: number) => {
    const x = xFor(dateIndex);
    const y = yFor(value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  // X 軸日期標示（SDLCCT-78）：固定取 7 天日期陣列的頭／中／尾三個索引
  // [0, 3, 6]，避免標籤過密互相重疊。
  const xAxisLabelIndices = [0, 3, 6];
  const xAxisLabels = xAxisLabelIndices
    .filter((i) => i < dates.length)
    .map((dateIndex, position, arr) => ({
      key: dates[dateIndex],
      x: xFor(dateIndex),
      text: formatTaiwanDate(dates[dateIndex]),
      textAnchor: (position === 0
        ? "start"
        : position === arr.length - 1
          ? "end"
          : "middle") as "start" | "middle" | "end",
    }));

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

  const byDate = (entry: VersionCostSeriesEntry) => {
    const map = new Map(entry.points.map((p) => [p.date, p.value]));
    return dates.map((date) => map.get(date) ?? null);
  };

  // 終點直接標籤 vs 圖例（SDLCCT-79）：資料序列數 <= 4 時使用線條終點直接
  // 標籤取代圖例；> 4 時直接標籤互相重疊風險高，退回純圖例顯示。門檻值 4
  // 為 spec 定案數字。
  const showTailLabels = entries.length <= 4;
  const plotMidX = CHART_PADDING + innerWidth / 2;
  const tailLabels: { key: string; x: number; y: number; color: string; text: string }[] = [];

  return (
    <div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        height={CHART_HEIGHT}
        role="img"
        aria-label={t("agentDetail.versionSeries.title")}
        className="mb-3"
      >
        {/* 格線（SDLCCT-78）：必須在資料折線之前渲染，確保視覺上位於折線
            後方。對齊既有 Y 軸金額標示（labels）的高度，重用 labels[].y，
            不重新呼叫 yFor()。 */}
        <g>
          {labels.map((label) => (
            <line
              key={label.key}
              x1={CHART_PADDING}
              x2={CHART_WIDTH - CHART_PADDING}
              y1={label.y}
              y2={label.y}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
          ))}
        </g>

        {entries.map((entry, entryIndex) => {
          const values = byDate(entry);
          const segments: string[][] = [];
          let current: string[] = [];
          values.forEach((value, dateIndex) => {
            if (value === null) {
              if (current.length > 0) segments.push(current);
              current = [];
              return;
            }
            current.push(toXY(dateIndex, value));
          });
          if (current.length > 0) segments.push(current);

          const color = COLORS[entryIndex % COLORS.length];

          // 終點直接標籤（SDLCCT-79）：重用同一個 values 陣列（與折線斷點
          // 判斷同一個「有值」定義），不重新解析 entry.points。
          const tailIndex = lastValidIndex(values);
          const tailPoint =
            tailIndex === -1
              ? null
              : { x: xFor(tailIndex), y: yFor(values[tailIndex] as number) };
          if (tailPoint) {
            tailLabels.push({
              key: entry.version,
              x: tailPoint.x,
              y: tailPoint.y,
              color,
              text: `${entry.version} ${formatCurrency(values[tailIndex] as number)}`,
            });
          }

          return (
            <g key={entry.version}>
              {segments.map((segment, i) => (
                <polyline
                  key={i}
                  points={segment.join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}

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

        {/* X 軸日期標示（SDLCCT-78）：頭／中／尾三個索引 [0, 3, 6]。 */}
        <g data-axis="x">
          {xAxisLabels.map((label) => (
            <text
              key={label.key}
              x={label.x}
              y={CHART_HEIGHT - 6}
              textAnchor={label.textAnchor}
              fontSize={10}
              fill="var(--color-text-secondary)"
            >
              {label.text}
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

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-secondary">
            <th className="py-2 pr-3">
              {t("agentDetail.versionSeries.table.columns.version")}
            </th>
            {dates.map((date) => (
              <th key={date} className="py-2 pr-3">
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
