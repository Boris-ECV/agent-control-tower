// Execution detail screen's span waterfall timeline (SDLCCT-118). Renders a
// single hand-rolled inline SVG below the existing span tree list
// (`SpanTreeRow`, unchanged -- docs/design/SDLCCT-118.md "UI 原型"), same
// "no chart library" pattern as version-cost-chart.tsx. X axis = elapsed
// seconds relative to the earliest valid start_time across the whole tree.
//
// See docs/design/SDLCCT-118.md decisions 1-5:
// 1. Color source is SPAN_TYPE_COLORS (frontend/lib/span-type-colors.ts),
//    not a second hardcoded color table -- that file's own comment says its
//    color mapping "must not be redefined elsewhere". Its values are
//    Tailwind background/border/text classes meant for the HTML type badge,
//    which don't apply to an SVG <rect>'s `fill` (CSS `background-color`
//    has no effect on SVG fill). So the bar's Tailwind `fill-*` class is
//    *derived* from the same entry's `text-{hue}-{shade}` token via regex,
//    not a separately hand-picked hue -- if SPAN_TYPE_COLORS's hue for a
//    type ever changes, the bar follows automatically, preserving the
//    single-source-of-truth property language. Falls back to Tailwind
//    gray-400 (`fill-gray-400`) for `general`/null/unknown types, matching
//    the gray swatch in docs/design/SDLCCT-118-prototype.html.
// 2. Row order/depth = plain pre-order traversal of the whole tree
//    (flattenSpans below), NOT run through group-spans.ts's groupSiblings
//    -- every span gets its own row regardless of the tree list's "× N"
//    grouping/expand state. depth is tracked for traversal-order parity
//    with SpanTreeRow's recursion, but is not used as a visual indent here
//    (spec has no third visual dimension requirement for the waterfall).
// 3. A span with a null start_time or end_time is omitted from the row list
//    entirely (no empty placeholder row) -- it still renders fine in the
//    separate, independently-walked tree list (AC3).
// 5. "spans is non-empty but every entry lacks valid start/end times" is
//    treated the same as "spans is empty" for this block's own empty state
//    (AC4's literal wording only covers the empty-array case, but its
//    stated reason -- "don't render an empty SVG or fake gridlines" --
//    applies equally here; see decision 5).
import { t } from "@/lib/i18n/t";
import { SPAN_TYPE_COLORS } from "@/lib/span-type-colors";
import type { SpanTreeNode } from "@/lib/trace-spans-api";

export type FlatSpan = { node: SpanTreeNode; depth: number };

// Depth-first, sibling-order-preserving pre-order traversal of the whole
// tree -- matches SpanTreeRow/SingleSpanRow's recursive render order/depth
// definition exactly (decision 2), independent of group-spans.ts.
export function flattenSpans(nodes: SpanTreeNode[], depth = 0): FlatSpan[] {
  const result: FlatSpan[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.children.length > 0) {
      result.push(...flattenSpans(node.children, depth + 1));
    }
  }
  return result;
}

const ROW_HEIGHT = 28;
const BAR_HEIGHT = 14;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const PX_PER_SECOND = 30;
const GRIDLINE_INTERVAL_SECONDS = 2;
const LABEL_GAP = 4;
const LABEL_RESERVE_PX = 40;
const FALLBACK_FILL_CLASS = "fill-gray-400";

// Derives a Tailwind `fill-{hue}-{shade}` class from SPAN_TYPE_COLORS's
// existing `text-{hue}-{shade}` token for the given type -- see decision 1
// above for why this isn't a second hand-picked color table.
function fillClassFor(type: string | null): string {
  const classes = type !== null ? SPAN_TYPE_COLORS[type] : undefined;
  if (!classes) return FALLBACK_FILL_CLASS;
  const match = classes.match(/text-(\w+)-(\d+)/);
  return match ? `fill-${match[1]}-${match[2]}` : FALLBACK_FILL_CLASS;
}

type WaterfallRow = {
  id: string;
  type: string | null;
  elapsedSeconds: number;
  durationSeconds: number;
};

export function SpanWaterfall({ nodes }: { nodes: SpanTreeNode[] }) {
  const flat = flattenSpans(nodes);
  const valid = flat.filter(
    (f): f is FlatSpan & { node: SpanTreeNode & { start_time: string; end_time: string } } =>
      f.node.start_time !== null && f.node.end_time !== null,
  );

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">
        {t("traceDetail.waterfall.title")}
      </h2>
      {valid.length === 0 ? (
        <p className="text-sm text-text-secondary">{t("traceDetail.waterfall.empty")}</p>
      ) : (
        <SpanWaterfallChart valid={valid} />
      )}
    </div>
  );
}

function SpanWaterfallChart({
  valid,
}: {
  valid: (FlatSpan & { node: SpanTreeNode & { start_time: string; end_time: string } })[];
}) {
  const earliestStartMs = Math.min(
    ...valid.map(({ node }) => new Date(node.start_time).getTime()),
  );

  const rows: WaterfallRow[] = valid.map(({ node }) => {
    const startMs = new Date(node.start_time).getTime();
    const endMs = new Date(node.end_time).getTime();
    return {
      id: node.id,
      type: node.type,
      elapsedSeconds: (startMs - earliestStartMs) / 1000,
      durationSeconds: (endMs - startMs) / 1000,
    };
  });

  const maxElapsedEnd = Math.max(...rows.map((r) => r.elapsedSeconds + r.durationSeconds));
  const chartWidth = Math.max(0, maxElapsedEnd) * PX_PER_SECOND;
  const svgWidth = chartWidth + LABEL_RESERVE_PX;
  const svgHeight = rows.length * ROW_HEIGHT;

  const gridlineCount = Math.floor(Math.max(0, maxElapsedEnd) / GRIDLINE_INTERVAL_SECONDS) + 1;
  const gridlines = Array.from({ length: gridlineCount }, (_, i) => ({
    key: i,
    x: i * GRIDLINE_INTERVAL_SECONDS * PX_PER_SECOND,
  }));

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width="100%"
      height={svgHeight}
      role="img"
      aria-label={t("traceDetail.waterfall.title")}
    >
      <g data-gridlines>
        {gridlines.map((line) => (
          <line
            key={line.key}
            data-gridline={line.key}
            x1={line.x}
            x2={line.x}
            y1={0}
            y2={svgHeight}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}
      </g>

      {rows.map((row, i) => {
        const x = row.elapsedSeconds * PX_PER_SECOND;
        const width = row.durationSeconds * PX_PER_SECOND;
        const y = i * ROW_HEIGHT + BAR_Y_OFFSET;
        return (
          <g key={row.id} data-span-row={row.id}>
            <rect
              x={x}
              y={y}
              width={width}
              height={BAR_HEIGHT}
              rx={2}
              className={fillClassFor(row.type)}
            />
            <text
              x={x + width + LABEL_GAP}
              y={y + BAR_HEIGHT / 2}
              fontSize={10}
              fill="var(--color-text-secondary)"
              dominantBaseline="middle"
            >
              {`${row.durationSeconds.toFixed(1)}s`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
