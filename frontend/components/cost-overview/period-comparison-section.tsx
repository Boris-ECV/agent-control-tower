"use client";

import { useRouter } from "next/navigation";

import { ClickableRow } from "@/components/common/clickable-row";
import { fetchPeriodComparison } from "@/lib/cost-overview-api";
import {
  formatDateRange,
  formatPercent,
  formatSignedTableCurrency,
  formatSlashDate,
  formatTableCurrency,
} from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

import { ErrorCard } from "./error-card";

// Below this previous-period amount, a percentage delta is misleadingly
// large/undefined (and previous_cost === 0 yields delta_pct: null from the
// bff already); show a "notable new spend" badge instead of a % figure.
// Strict "<" so previous_cost === 10 still shows the percentage
// (SDLCCT-66 design decision: strict less-than so the US$10 boundary itself still shows a percentage).
const NOTABLE_NEW_SPEND_THRESHOLD_USD = 10;

export function PeriodComparisonSection() {
  const router = useRouter();
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
  // AC "增加金額欄有對應金額大小的長度條": relative to the largest positive
  // delta in the table (SDLCCT-83 design decision 3). Math.max(1, ...) avoids
  // a division by zero when every row's delta is <= 0.
  const maxPositiveDelta = Math.max(1, ...agents.map((agent) => Math.max(agent.delta, 0)));

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="mb-3 flex justify-end">
        <span className="text-xs text-text-secondary">
          {t("costOverview.periodSection.statsPeriod")(
            `${formatSlashDate(current_period.start)} – ${formatSlashDate(current_period.end)}`,
          )}
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-border p-2 text-left text-xs font-normal text-text-secondary">
              Agent
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              <span className="block">{t("costOverview.period.currentPeriodLabel")}</span>
              <span className="block text-text-secondary">
                {formatDateRange(current_period.start, current_period.end)}
              </span>
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              <span className="block">{t("costOverview.period.previousPeriodLabel")}</span>
              <span className="block text-text-secondary">
                {formatDateRange(previous_period.start, previous_period.end)}
              </span>
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              {t("costOverview.period.deltaAmount")}
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              {t("costOverview.period.delta")}
            </th>
            <th className="border-b border-border p-2" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {agents.map((agent, i) => {
            // AC "紅色只標示在需要強調的位置": the amount text itself always
            // stays normal color; red is applied only to the length bar fill
            // and the badge below, for rows past the existing SDLCCT-66
            // threshold (not re-defined here, see docs/design/SDLCCT-83.md).
            const notable = agent.previous_cost < NOTABLE_NEW_SPEND_THRESHOLD_USD;
            const widthPct = agent.delta > 0 ? (agent.delta / maxPositiveDelta) * 100 : 0;

            return (
              <ClickableRow
                key={agent.key}
                aria-label={agent.display}
                onActivate={() => router.push(`/agents/${agent.key}`)}
              >
                <td className="p-3 text-sm">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-accent">
                    {i + 1}
                  </span>
                  {agent.display}
                </td>
                <td className="p-3 text-right text-sm tabular-nums">
                  {formatTableCurrency(agent.current_cost)}
                </td>
                <td className="p-3 text-right text-sm tabular-nums">
                  {formatTableCurrency(agent.previous_cost)}
                </td>
                <td className="p-3 text-right text-sm tabular-nums">
                  <span className="mb-1 block font-semibold text-text-primary">
                    {formatSignedTableCurrency(agent.delta)}
                  </span>
                  <span className="ml-auto block h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-gray-100">
                    <span
                      className={`block h-1.5 rounded-full ${notable ? "bg-red-600" : "bg-accent"}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </span>
                  {notable && (
                    <span className="mt-1 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                      {t("costOverview.period.notableNewSpendBadge")}
                    </span>
                  )}
                </td>
                <td className="p-3 text-right text-sm tabular-nums text-text-secondary">
                  {notable
                    ? "—"
                    : agent.delta_pct !== null
                      ? `（${formatPercent(agent.delta_pct)}）`
                      : "—"}
                </td>
                <td className="p-3" aria-hidden="true">
                  <svg
                    viewBox="0 0 16 16"
                    className="h-4 w-4 flex-none fill-current text-text-secondary transition-[translate] group-hover:translate-x-1 group-hover:text-accent group-focus-visible:translate-x-1 group-focus-visible:text-accent"
                  >
                    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </td>
              </ClickableRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
