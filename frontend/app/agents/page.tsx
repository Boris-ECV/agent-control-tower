"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ClickableRow } from "@/components/common/clickable-row";
import { ProgressBar } from "@/components/common/progress-bar";
import { SegmentedFilter } from "@/components/common/segmented-filter";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorCard } from "@/components/cost-overview/error-card";
import { PageHeaderTimestamp } from "@/components/layout/page-header-timestamp";
import type { AgentRegistryEntry, AgentTrendPoint } from "@/lib/agents-api";
import { fetchAgentsList } from "@/lib/agents-api";
import { formatDateRange, formatTableCurrency, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

// SDLCCT-108 決策 4：狀態篩選沿用既有 SegmentedFilter，三態
// "all" | "gap" | "ok"，標籤重用既有 agents.governanceBadge 文案。
type GovernanceStatusFilter = "all" | "gap" | "ok";

// 「全部」文案沿用既有 anomalies.filter.all（同為「篩選器『全部』選項」語意，
// 非跨模組不同語意的字串，不新增重複 key——決策 6 列出的新 key 僅
// searchLabel/deptLabel/statusAriaLabel 三個）。
const STATUS_FILTER_OPTIONS: { value: GovernanceStatusFilter; label: string }[] = [
  { value: "all", label: t("anomalies.filter.all") },
  { value: "gap", label: t("agents.governanceBadge.hasGap") },
  { value: "ok", label: t("agents.governanceBadge.ok") },
];

// SDLCCT-108 決策 2：部門下拉的 "all" sentinel 值。
const DEPT_FILTER_ALL = "all";

// Sparkline: 手刻 inline SVG <polyline>（無圖表函式庫依賴，見
// docs/design/SDLCCT-43.md UI 原型段落）。null 的 trend point 不內插、不顯示
// 為 0——以斷點（拆成多條獨立 <polyline>）呈現，null 點本身不畫出任何座標。
const SPARKLINE_WIDTH = 84;
const SPARKLINE_HEIGHT = 28;

// SDLCCT-106 決策 1：與 Sparkline 同檔共置，兩者都要對同一份 trend 陣列做
// 「過濾 null」的操作——sparkline 畫線用非 null 點，合計也用非 null 點。
// 過濾後長度為 0（全為 null）時回傳 null，交給 formatTableCurrency 顯示「—」。
export function sumTrend(trend: AgentTrendPoint[]): number | null {
  const values = trend.filter((p): p is { date: string; value: number } => p.value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, p) => sum + p.value, 0);
}

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

// SDLCCT-106 決策 3：合計文字疊在 Sparkline 下方（flex-col），不並排，
// 避免 SPARKLINE_WIDTH 固定 84px 的欄寬因金額文字長度變動。表格與手機卡片
// 版共用同一元件、同一邏輯。
function SparklineWithTotal({ trend }: { trend: AgentTrendPoint[] }) {
  return (
    <div className="flex flex-col gap-1">
      <Sparkline trend={trend} />
      <span className="text-xs text-text-secondary tabular-nums">{formatTableCurrency(sumTrend(trend))}</span>
    </div>
  );
}

// 「預算消耗%」欄共用渲染（SDLCCT-107）。budget_consumed_pct 為 null 恆等於
// budget 為 null（見 docs/design/SDLCCT-107.md「介面/API 契約」，後端
// bff/api/agents.py 的一對一不變性），語意上就是「預算未設定」，故沿用
// SDLCCT-105 定案的 agents.unknownBudget 文案與 text-text-tertiary 淡色、
// 不渲染進度條；非 null 時維持既有 formatPercent 數字顯示，並在數字旁加上
// 進度條（寬度 clamp 到 0-100%，>100% 用警示色，沿用 SDLCCT-82 門檻）。
function BudgetConsumedPct({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-text-tertiary">{t("agents.unknownBudget")}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span>{formatPercent(pct)}</span>
      <ProgressBar pct={pct} danger={pct > 100} />
    </div>
  );
}

function GovernanceBadge({ hasGap }: { hasGap: boolean }) {
  return (
    <StatusBadge variant={hasGap ? "danger" : "success"}>
      {hasGap ? t("agents.governanceBadge.hasGap") : t("agents.governanceBadge.ok")}
    </StatusBadge>
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
          <th className="py-2 pr-3 text-right">{t("agents.table.columns.budget")}</th>
          <th className="py-2 pr-3 text-right">{t("agents.table.columns.currentPeriodSpend")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.budgetConsumedPct")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.trend")}</th>
          <th className="py-2 pr-3">{t("agents.table.columns.governance")}</th>
          <th className="py-2 pr-3" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {agents.map((agent) => (
          <ClickableRow
            key={agent.key}
            aria-label={agent.display}
            onActivate={() => router.push(`/agents/${agent.key}`)}
          >
            <td className="py-2 pr-3 font-medium text-text-primary">{agent.display}</td>
            <td className="py-2 pr-3">{agent.dept}</td>
            <td className="py-2 pr-3">
              {agent.owner ?? <span className="text-text-tertiary">{t("agents.unknownOwner")}</span>}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {agent.budget !== null ? (
                formatTableCurrency(agent.budget)
              ) : (
                <span className="text-text-tertiary">{t("agents.unknownBudget")}</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatTableCurrency(agent.current_period_spend)}</td>
            <td className="py-2 pr-3">
              <BudgetConsumedPct pct={agent.budget_consumed_pct} />
            </td>
            <td className="py-2 pr-3">
              <SparklineWithTotal trend={agent.trend} />
            </td>
            <td className="py-2 pr-3">
              <GovernanceBadge hasGap={agent.has_governance_gap} />
            </td>
            <td className="py-2 pr-3" aria-hidden="true">
              {/* SDLCCT-101 CI fix: Tailwind v4's `translate-x-*` utility sets
                  the native CSS `translate` property, not `transform` (a v3
                  assumption baked into the original `transition-[color,
                  transform]`, same category of v3/v4 drift noted in
                  app/globals.css). Since `transform` never actually changes,
                  only `color` was animated while `translate` snapped
                  instantly -- in CI this meant the arrow's hover color was
                  still mid-fade at the exact instant translate (the e2e
                  wait signal) already reported its final value, so the test
                  observed an intermediate, not-yet-settled color. Fix: keep
                  the slide ("箭頭動效") as the one animated property via
                  `transition-[translate]`; color snaps together with the
                  group-hover/group-focus-visible state change (no fade),
                  so it is always already final by the time translate moves
                  at all. */}
              <svg
                viewBox="0 0 16 16"
                className="h-4 w-4 flex-none fill-current text-text-secondary transition-[translate] group-hover:translate-x-1 group-hover:text-accent group-focus-visible:translate-x-1 group-focus-visible:text-accent"
              >
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </td>
          </ClickableRow>
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
                {agent.owner ?? <span className="text-text-tertiary">{t("agents.unknownOwner")}</span>}
              </dd>
              <dt>{t("agents.table.columns.budget")}</dt>
              <dd className="text-right tabular-nums text-text-primary">
                {agent.budget !== null ? (
                  formatTableCurrency(agent.budget)
                ) : (
                  <span className="text-text-tertiary">{t("agents.unknownBudget")}</span>
                )}
              </dd>
              <dt>{t("agents.table.columns.currentPeriodSpend")}</dt>
              <dd className="text-right tabular-nums text-text-primary">
                {formatTableCurrency(agent.current_period_spend)}
              </dd>
              <dt>{t("agents.table.columns.budgetConsumedPct")}</dt>
              <dd className="text-right text-text-primary">
                <BudgetConsumedPct pct={agent.budget_consumed_pct} />
              </dd>
              <dt>{t("agents.table.columns.trend")}</dt>
              <dd className="text-right">
                <SparklineWithTotal trend={agent.trend} />
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
  const [searchTerm, setSearchTerm] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>(DEPT_FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState<GovernanceStatusFilter>("all");

  // SDLCCT-108 決策 3：部門下拉選項來自未篩選的原始 agents 清單（dedup +
  // 排序），不隨其他篩選條件縮小。
  const deptOptions = useMemo(() => {
    if (state.status !== "success") return [];
    return Array.from(new Set(state.data.agents.map((agent) => agent.dept))).sort();
  }, [state]);

  // SDLCCT-108 決策 2：集中一個 useMemo 同時套用 search／dept／status 三個
  // AND 條件，結果同時傳給 AgentTable 與 AgentCardList，避免兩處各自重算
  // 或產生不一致的過濾結果。
  const term = searchTerm.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (state.status !== "success") return [];
    return state.data.agents.filter((agent) => {
      if (deptFilter !== DEPT_FILTER_ALL && agent.dept !== deptFilter) return false;
      if (statusFilter === "gap" && !agent.has_governance_gap) return false;
      if (statusFilter === "ok" && agent.has_governance_gap) return false;
      if (
        term &&
        !agent.display.toLowerCase().includes(term) &&
        !agent.dept.toLowerCase().includes(term) &&
        !(agent.owner !== null && agent.owner.toLowerCase().includes(term)) &&
        !agent.key.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [state, term, deptFilter, statusFilter]);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-end border-b border-border bg-bg px-6 py-3">
        <PageHeaderTimestamp />
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
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="agents-search" className="text-sm text-text-secondary">
                    {t("agents.filter.searchLabel")}
                  </label>
                  <input
                    id="agents-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agents-dept-filter" className="text-sm text-text-secondary">
                    {t("agents.filter.deptLabel")}
                  </label>
                  <select
                    id="agents-dept-filter"
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary"
                  >
                    <option value={DEPT_FILTER_ALL}>{t("anomalies.filter.all")}</option>
                    {deptOptions.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
                <SegmentedFilter<GovernanceStatusFilter>
                  aria-label={t("agents.filter.statusAriaLabel")}
                  options={STATUS_FILTER_OPTIONS}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>

              {filteredAgents.length === 0 ? (
                <p className="text-sm text-text-secondary">{t("agents.filter.empty")}</p>
              ) : (
                <>
                  <AgentTable agents={filteredAgents} />
                  <AgentCardList agents={filteredAgents} />
                </>
              )}
            </>
          )}
        </section>

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {state.status === "success" && (
            <p>{t("agents.footer.period")(formatDateRange(state.data.period_start, state.data.anchor_date))}</p>
          )}
          <p>{t("agents.footer.dataSource")}</p>
        </footer>
      </main>
    </div>
  );
}
