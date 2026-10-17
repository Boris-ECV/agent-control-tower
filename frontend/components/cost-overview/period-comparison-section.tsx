"use client";

import { fetchPeriodComparison } from "@/lib/cost-overview-api";
import { formatDateRange, formatPercent, formatSignedCurrency } from "@/lib/format";
import { useFetchOnce } from "@/lib/use-fetch-once";

import { ErrorCard } from "./error-card";

export function PeriodComparisonSection() {
  const state = useFetchOnce(fetchPeriodComparison);

  if (state.status === "loading") {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-gray-50" />;
  }

  if (state.status === "error") {
    return (
      <ErrorCard title="跨 Agent 期間比較" error={state.error} onRetry={state.retry} />
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
              本期花費（{formatDateRange(current_period.start, current_period.end)}）
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              前期花費（{formatDateRange(previous_period.start, previous_period.end)}）
            </th>
            <th className="border-b border-border p-2 text-right text-xs font-normal text-text-secondary">
              漲幅
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
                {agent.delta_pct !== null ? `（${formatPercent(agent.delta_pct)}）` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
