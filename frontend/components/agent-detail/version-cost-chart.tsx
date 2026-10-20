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
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function unionSortedDates(entries: VersionCostSeriesEntry[]): string[] {
  const set = new Set<string>();
  for (const entry of entries) {
    for (const point of entry.points) {
      set.add(point.date);
    }
  }
  return Array.from(set).sort();
}

export function VersionCostChart({
  entries,
}: {
  entries: VersionCostSeriesEntry[];
}) {
  const dates = unionSortedDates(entries);

  const allValues = entries
    .flatMap((entry) => entry.points)
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 0;

  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;

  const toXY = (dateIndex: number, value: number) => {
    const x =
      dates.length > 1
        ? CHART_PADDING + (dateIndex / (dates.length - 1)) * innerWidth
        : CHART_PADDING + innerWidth / 2;
    const y =
      max === min
        ? CHART_PADDING + innerHeight / 2
        : CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const byDate = (entry: VersionCostSeriesEntry) => {
    const map = new Map(entry.points.map((p) => [p.date, p.value]));
    return dates.map((date) => map.get(date) ?? null);
  };

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
      </svg>

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
