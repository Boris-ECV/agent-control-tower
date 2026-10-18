"use client";

import { fetchCostOverviewSummary } from "@/lib/cost-overview-api";
import { formatCurrency, formatPercent } from "@/lib/format";
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
      <ErrorCard title="本月成本 vs 預算總覽" error={state.error} onRetry={state.retry} />
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
          label="本月總花費（含未登錄 Agent）"
          value={formatCurrency(summary.total_spend)}
          sub="9 個 Agent 累計（COST，本月至今）"
        />
        <Card
          label="本月總預算"
          value={formatCurrency(summary.total_budget)}
          sub="已登錄 Agent 的 budget 加總"
        />
        <Card
          label="預算消耗百分比"
          value={formatPercent(summary.budget_consumed_pct)}
          sub={overBudget ? "已超過本月預算" : "尚在預算內"}
          danger={overBudget}
        />
        <Card
          label="預估月底超支金額"
          value={formatCurrency(summary.projected_overspend)}
          sub={`依目前花費速度線性外推至月底（第 ${summary.days_in_month} 天）`}
          danger={overspend}
        />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-bg p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            {summary.unregistered.agents.length > 0
              ? `⚠ 治理缺口：${summary.unregistered.agents.length} 個 Agent 未登錄`
              : "✓ 無治理缺口：所有 Agent 皆已登錄"}
          </span>
          <span className="text-xs text-text-secondary">
            花費計入總花費，但不計入總預算分母
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
                    未登錄
                  </span>
                </span>
                <span className="text-right font-semibold">{formatCurrency(a.spend)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
