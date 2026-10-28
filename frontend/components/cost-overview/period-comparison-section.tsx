"use client";

import { fetchPeriodComparison } from "@/lib/cost-overview-api";
import { formatDateRange, formatPercent, formatSignedCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

import { ErrorCard } from "./error-card";

// Below this previous-period amount, a percentage delta is misleadingly
// large/undefined (and previous_cost === 0 yields delta_pct: null from the
// bff already); show a "notable new spend" badge instead of a % figure.
// Strict "<" so previous_cost === 10 still shows the percentage
// (docs/design/SDLCCT-66.md decision 2).
const NOTABLE_NEW_SPEND_THRESHOLD_USD = 10;

export function PeriodComparisonSection() {
  const state = useFetchOnce(fetchPeriodComparison);

  if (state.status === "loading") {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-gray-50" />;
  }

  if (state.status === "error") {
    return (
      <ErrorCard title={t("costOverview.periodSection.title")} error={state.error} onRetry={state.retry} />
    );
  }

  const { current_period, previous_period, agents } = state.data;

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-border p-2 text-left text-xs font-normal text-text-secondary">
              Agent
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              {t("costOverview.period.currentPeriod")(
                formatDateRange(current_period.start, current_period.end),
              )}
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              {t("costOverview.period.previousPeriod")(
                formatDateRange(previous_period.start, previous_period.end),
              )}
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              {t("costOverview.period.delta")}
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {agents.map((agent, i) => (
            <tr key={agent.key}>
              <td className="border-b border-border p-3 text-sm">
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                {agent.display}
              </td>
              <td className="border-b border-border p-3 text-right text-sm">
                {formatSignedCurrency(agent.current_cost).replace(/^[+-]/, "")}
              </td>
              <td className="border-b border-border p-3 text-right text-sm">
                {formatSignedCurrency(agent.previous_cost).replace(/^[+-]/, "")}
              </td>
              <td
                className={`border-b border-border p-3 text-right text-sm font-semibold ${
                  agent.delta > 0 ? "text-red-700" : "text-text-secondary"
                }`}
              >
                {formatSignedCurrency(agent.delta)}
                {agent.previous_cost < NOTABLE_NEW_SPEND_THRESHOLD_USD ? (
                  <span className="ml-1.5 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {t("costOverview.period.notableNewSpendBadge")}
                  </span>
                ) : agent.delta_pct !== null ? (
                  `（${formatPercent(agent.delta_pct)}）`
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
