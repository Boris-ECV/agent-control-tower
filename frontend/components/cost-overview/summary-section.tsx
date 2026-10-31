"use client";

import { fetchCostOverviewSummary } from "@/lib/cost-overview-api";
import { formatCardCurrency, formatPercent, formatTableCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

import { ErrorCard } from "./error-card";

function Card({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <p className="mb-2 text-xs leading-[18px] text-text-secondary">{label}</p>
      <p
        className={`mb-1 text-2xl leading-8 font-bold ${danger ? "text-red-700" : "text-text-primary"}`}
      >
        {value}
      </p>
      <p className="text-xs leading-[18px] text-text-secondary">{sub}</p>
    </div>
  );
}

/** Exposes the fetched anchor_date to the page header via a callback, since
 * AC4's "今天" display reads summary's anchor_date -- see page.tsx. */
export function SummarySection({
  onAnchorDate,
}: {
  onAnchorDate?: (anchorDate: string | null) => void;
}) {
  const state = useFetchOnce(fetchCostOverviewSummary);

  if (state.status === "loading") {
    onAnchorDate?.(null);
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-gray-50" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    onAnchorDate?.(null);
    return (
      <ErrorCard title={t("costOverview.summarySection.title")} error={state.error} onRetry={state.retry} />
    );
  }

  const summary = state.data;
  onAnchorDate?.(summary.anchor_date);
  const overBudget = (summary.budget_consumed_pct ?? 0) > 100;
  const overspend = (summary.projected_overspend ?? 0) > 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label={t("costOverview.summary.totalSpend.label")}
          value={formatCardCurrency(summary.total_spend)}
          sub={t("costOverview.summary.totalSpend.sub")}
        />
        <Card
          label={t("costOverview.summary.totalBudget.label")}
          value={formatCardCurrency(summary.total_budget)}
          sub={t("costOverview.summary.totalBudget.sub")}
        />
        <Card
          label={t("costOverview.summary.budgetConsumedPct.label")}
          value={formatPercent(summary.budget_consumed_pct)}
          sub={
            overBudget
              ? t("costOverview.summary.budgetConsumedPct.subOverBudget")
              : t("costOverview.summary.budgetConsumedPct.subWithinBudget")
          }
          danger={overBudget}
        />
        <Card
          label={t("costOverview.summary.projectedOverspend.label")}
          value={formatCardCurrency(summary.projected_overspend)}
          sub={t("costOverview.summary.projectedOverspend.sub")(summary.days_in_month)}
          danger={overspend}
        />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-bg p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            {summary.unregistered.agents.length > 0
              ? t("costOverview.summary.governanceGap.hasGap")(summary.unregistered.agents.length)
              : t("costOverview.summary.governanceGap.noGap")}
          </span>
          <span className="text-xs text-text-secondary">
            {t("costOverview.summary.governanceGap.note")}
          </span>
        </div>
        {summary.unregistered.agents.length > 0 && (
          <ul className="list-none p-0">
            {summary.unregistered.agents.map((a) => (
              <li
                key={a.key}
                className="flex justify-between border-b border-border py-2 text-sm last:border-b-0"
              >
                <span>
                  {a.display}
                  <span className="ml-2 rounded border border-red-300 bg-red-50 px-2 text-xs text-red-700">
                    {t("costOverview.summary.unregisteredBadge")}
                  </span>
                </span>
                <span className="text-right font-semibold tabular-nums">{formatTableCurrency(a.spend)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
