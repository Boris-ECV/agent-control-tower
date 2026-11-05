// Summary row for the Execution detail screen (SDLCCT-117): 開始時間（含日
// 期）/ 總耗時 / Span 數 / 預估成本, in that order. Reuses the existing
// (deprecated but still correct) formatTaiwanDateTime/formatCurrency per
// the spec's literal wording (docs/design/SDLCCT-117.md decision 4) --
// substituting the newer formatSlashDateTime/formatCardCurrency is
// out-of-scope for this story. When spans is empty, startIso/
// durationSeconds come in as null (computeSpanSummary's natural result),
// which formatTaiwanDateTime/formatDurationSeconds already render as "—";
// spanCount is simply 0; totalEstimatedCost is unaffected (its own value,
// independent of spans).

import { formatCurrency, formatDurationSeconds, formatTaiwanDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/t";

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

export function TraceSummaryRow({
  startIso,
  durationSeconds,
  spanCount,
  totalEstimatedCost,
}: {
  startIso: string | null;
  durationSeconds: number | null;
  spanCount: number;
  totalEstimatedCost: number | null;
}) {
  return (
    <div data-testid="trace-summary-row" className="flex flex-wrap items-center gap-6">
      <SummaryItem label={t("traceDetail.summaryRow.startTime")} value={formatTaiwanDateTime(startIso)} />
      <SummaryItem
        label={t("traceDetail.summaryRow.duration")}
        value={formatDurationSeconds(durationSeconds)}
      />
      <SummaryItem label={t("traceDetail.summaryRow.spanCount")} value={String(spanCount)} />
      <SummaryItem
        label={t("traceDetail.summaryRow.cost")}
        value={formatCurrency(totalEstimatedCost)}
      />
    </div>
  );
}
