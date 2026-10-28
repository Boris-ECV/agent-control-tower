"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ErrorCard } from "@/components/cost-overview/error-card";
import type { AgentRegistryEntry, AgentTrendPoint } from "@/lib/agents-api";
import { fetchAgentsList } from "@/lib/agents-api";
import { formatCurrency, formatPercent, formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

// Sparkline: 手刻 inline SVG <polyline>（無圖表函式庫依賴，見
// docs/design/SDLCCT-43.md UI 原型段落）。null 的 trend point 不內插、不顯示
// 為 0——以斷點（拆成多條獨立 <polyline>）呈現，null 點本身不畫出任何座標。
const SPARKLINE_WIDTH = 84;
const SPARKLINE_HEIGHT = 28;

export function Sparkline({ trend }: { trend: AgentTrendPoint[] }) {
  const defined = trend.filter((p): p is { date: string; value: number } => p.value !== null);
  if (defined.length === 0) {
    return <span className="text-xs text-text-secondary">—</span>;
  }

  const values = defined.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const toXY = (index: number, value: number) => {
    const x = trend.length > 1 ? (index / (trend.length - 1)) * SPARKLINE_WIDTH : SPARKLINE_WIDTH / 2;
    const y =
      max === min
        ? SPARKLINE_HEIGHT / 2
        : SPARKLINE_HEIGHT - ((value - min) / (max - min)) * SPARKLINE_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  // 把連續非 null 的點切成多個獨立線段，null 點之間自然形成斷點（不連線）。
  const segments: string[][] = [];
  let current: string[] = [];
  trend.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push(toXY(index, point.value));
  });
  if (current.length > 0) segments.push(current);

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      className="inline-block"
      role="img"
      aria-label={t("agents.table.columns.trend")}
    >
      {segments.map((segment, i) => (
        <polyline
          key={i}
          points={segment.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-text-primary"
        />
      ))}
    </svg>
  );
}

function GovernanceBadge({ hasGap }: { hasGap: boolean }) {
  return hasGap ? (
    <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
      {t("agents.governanceBadge.hasGap")}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-border bg-gray-50 px-2 py-0.5 text-xs font-semibold text-text-secondary">
      {t("agents.governanceBadge.ok")}
    </span>
  );
}

function AgentTable({ agents }: { agents: AgentRegistryEntry[] }) {
  const router = useRouter();

  return (
    <table className="hidden w-full border-collapse text-sm md:table">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3">{t("agents.table.columns.agent")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.dept")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.owner")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.budget")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.currentPeriodSpend")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.budgetConsumedPct")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.trend")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.governance")}</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((agent) => (
          <tr
            key={agent.key}
            className="cursor-pointer border-b border-border last:border-b-0 hover:bg-gray-50"
            tabIndex={0}
            role="link"
            aria-label={agent.display}
            onClick={() => router.push(`/agents/${agent.key}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                router.push(`/agents/${agent.key}`);
              }
            }}
          >
            <td className="py-2 pr-3 font-medium text-text-primary">{agent.display}</td>
            <td className="py-2 pr-3">{agent.dept}</td>
            <td className="py-2 pr-3">{agent.owner ?? t("agents.unknownOwner")}</td>
            <td className="py-2 pr-3">
              {agent.budget !== null ? formatCurrency(agent.budget) : t("agents.unknownBudget")}
            </td>
            <td className="py-2 pr-3">{formatCurrency(agent.current_period_spend)}</td>
            <td className="py-2 pr-3">{formatPercent(agent.budget_consumed_pct)}</td>
            <td className="py-2 pr-3">
              <Sparkline trend={agent.trend} />
            </td>
            <td className="py-2 pr-3">
              <GovernanceBadge hasGap={agent.has_governance_gap} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgentCardList({ agents }: { agents: AgentRegistryEntry[] }) {
  return (
    <ul className="flex list-none flex-col gap-3 p-0 md:hidden">
      {agents.map((agent) => (
        <li key={agent.key} className="rounded-lg border border-border bg-bg p-4">
          <Link href={`/agents/${agent.key}`} className="block">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-text-primary">{agent.display}</span>
              <GovernanceBadge hasGap={agent.has_governance_gap} />
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-xs text-text-secondary">
              <dt>{t("agents.table.columns.dept")}</dt>
              <dd className="text-right text-text-primary">{agent.dept}</dd>
              <dt>{t("agents.table.columns.owner")}</dt>
              <dd className="text-right text-text-primary">
                {agent.owner ?? t("agents.unknownOwner")}
              </dd>
              <dt>{t("agents.table.columns.budget")}</dt>
              <dd className="text-right text-text-primary">
                {agent.budget !== null ? formatCurrency(agent.budget) : t("agents.unknownBudget")}
              </dd>
              <dt>{t("agents.table.columns.currentPeriodSpend")}</dt>
              <dd className="text-right text-text-primary">
                {formatCurrency(agent.current_period_spend)}
              </dd>
              <dt>{t("agents.table.columns.budgetConsumedPct")}</dt>
              <dd className="text-right text-text-primary">
                {formatPercent(agent.budget_consumed_pct)}
              </dd>
              <dt>{t("agents.table.columns.trend")}</dt>
              <dd className="text-right">
                <Sparkline trend={agent.trend} />
              </dd>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function AgentsPage() {
  const state = useFetchOnce(fetchAgentsList);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-end border-b border-border bg-bg px-6 py-3">
        <span className="text-xs leading-[18px] text-text-secondary">
          {state.status === "success"
            ? formatTaiwanDate(state.data.anchor_date)
            : t("costOverview.header.unavailable")}
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-1 text-left text-2xl leading-8 font-bold text-text-primary">
          {t("agents.header.title")}
        </h1>
        <p className="mb-6 text-left text-xs leading-[18px] text-text-secondary">
          {t("agents.header.subtitle")}
        </p>

        <section aria-label={t("agents.header.title")}>
          {state.status === "loading" && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-border bg-gray-50"
                />
              ))}
            </div>
          )}

          {state.status === "error" && (
            <ErrorCard title={t("agents.header.title")} error={state.error} onRetry={state.retry} />
          )}

          {state.status === "success" && (
            <>
              <AgentTable agents={state.data.agents} />
              <AgentCardList agents={state.data.agents} />
            </>
          )}
        </section>

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {t("agents.footer.dataSource")}
        </footer>
      </main>
    </div>
  );
}
