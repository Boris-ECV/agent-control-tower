"use client";

import { useMemo, useState } from "react";

import { AnomalyErrorBanner } from "@/components/anomalies/anomaly-error-banner";
import type { EnrichedAnomalyRow } from "@/components/anomalies/anomaly-table";
import { ANOMALY_TYPE_LABELS, AnomalyTable } from "@/components/anomalies/anomaly-table";
import { SegmentedFilter } from "@/components/common/segmented-filter";
import { ErrorCard } from "@/components/cost-overview/error-card";
import { PageHeaderTimestamp } from "@/components/layout/page-header-timestamp";
import { fetchAgentsList } from "@/lib/agents-api";
import type { AnomalyRow } from "@/lib/anomalies-api";
import { fetchAnomalyFeed } from "@/lib/anomalies-api";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

// SDLCCT-84 決策 6：「全部」＋既有 5 種異常類型（沿用 ANOMALY_TYPE_LABELS
// 的 key 與文案，不新增第 6 種類型）。
type AnomalyTypeFilter = "all" | keyof typeof ANOMALY_TYPE_LABELS;

// SDLCCT-123：第二個獨立篩選維度（依 Agent），與既有 anomaly-type 篩選
// 完全不互相依賴，以 AND 條件組合（見 docs/design/SDLCCT-123.md）。
type AgentFilterValue = "all" | string;

const FILTER_OPTIONS: { value: AnomalyTypeFilter; label: string }[] = [
  { value: "all", label: t("anomalies.filter.all") },
  ...(Object.keys(ANOMALY_TYPE_LABELS) as (keyof typeof ANOMALY_TYPE_LABELS)[]).map((key) => ({
    value: key,
    label: ANOMALY_TYPE_LABELS[key],
  })),
];

export default function AnomaliesPage() {
  const anomaliesState = useFetchOnce(fetchAnomalyFeed);
  const agentsState = useFetchOnce(fetchAgentsList);
  const [filter, setFilter] = useState<AnomalyTypeFilter>("all");
  const [agentFilter, setAgentFilter] = useState<AgentFilterValue>("all");

  // SDLCCT-84 決策 4：anomalies 本身是主要資料來源，agents 列表失敗時不阻
  // 斷整頁渲染——改走 agentDisplayNames 為空 Map 的 fallback（AgentCell 顯
  // 示系統代號本身），只有 anomalies 自己失敗（或兩者皆失敗，優先顯示
  // anomalies 的錯誤）才整頁顯示 ErrorCard。
  const agentDisplayNames = useMemo(() => {
    const map = new Map<string, string>();
    if (agentsState.status === "success") {
      for (const agent of agentsState.data.agents) {
        map.set(agent.key, agent.display);
      }
    }
    return map;
  }, [agentsState]);

  const allRows: EnrichedAnomalyRow[] = useMemo(
    () =>
      anomaliesState.status === "success"
        ? anomaliesState.data.anomalies.map((row: AnomalyRow) => ({
            ...row,
            agentDisplay: row.agent !== null ? agentDisplayNames.get(row.agent) : undefined,
          }))
        : [],
    [anomaliesState, agentDisplayNames],
  );

  // SDLCCT-123：篩選選項來自未篩選的原始 allRows（不隨另一個篩選條件縮
  // 小，沿用 SDLCCT-108/111 既有慣例），排除 agent === null 的列，依顯示
  // 名稱 localeCompare("zh-Hant") 排序（見 docs/design/SDLCCT-123.md 決策
  // 1）。
  const agentFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of allRows) {
      if (row.agent !== null && !seen.has(row.agent)) {
        seen.set(row.agent, agentDisplayNames.get(row.agent) ?? row.agent);
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"))
      .map(([code, label]) => ({ value: code, label }));
  }, [allRows, agentDisplayNames]);

  // AND 組合：先套用既有類型篩選，再套用新 Agent 篩選（鏈式 .filter()，
  // 兩者互相獨立，任一個改回 "all" 不影響另一個已套用的條件）。
  const typeFilteredRows =
    filter === "all" ? allRows : allRows.filter((row) => row.anomaly_type === filter);
  const filteredRows =
    agentFilter === "all"
      ? typeFilteredRows
      : typeFilteredRows.filter((row) => row.agent === agentFilter);

  const okRows = filteredRows.filter((row) => row.status === "ok");
  const errorRows = filteredRows.filter((row) => row.status === "error");

  // 兩個請求都需要成功才能渲染表格（名稱必須先 join 完才顯示列）；任一個
  // loading 就顯示 skeleton。
  const isLoading = anomaliesState.status === "loading" || agentsState.status === "loading";

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-end border-b border-border bg-bg px-6 py-3">
        <PageHeaderTimestamp />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-1 text-left text-2xl leading-8 font-bold text-text-primary">
          {t("anomalies.header.title")}
        </h1>
        <p className="mb-6 text-left text-xs leading-[18px] text-text-secondary">
          {t("anomalies.header.subtitle")}
        </p>

        <section aria-label={t("anomalies.header.title")}>
          {isLoading && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-border bg-gray-50"
                />
              ))}
            </div>
          )}

          {!isLoading && anomaliesState.status === "error" && (
            <ErrorCard
              title={t("anomalies.header.title")}
              error={anomaliesState.error}
              onRetry={anomaliesState.retry}
            />
          )}

          {!isLoading && anomaliesState.status === "success" && (
            <>
              <div className="mb-4 flex flex-col gap-3">
                <SegmentedFilter<AgentFilterValue>
                  aria-label={t("anomalies.filter.agentAriaLabel")}
                  options={[
                    { value: "all", label: t("anomalies.filter.all") },
                    ...agentFilterOptions,
                  ]}
                  value={agentFilter}
                  onChange={setAgentFilter}
                />
                <SegmentedFilter<AnomalyTypeFilter>
                  aria-label={t("anomalies.filter.ariaLabel")}
                  options={FILTER_OPTIONS}
                  value={filter}
                  onChange={setFilter}
                  countLabel={t("anomalies.filter.count")(filteredRows.length, allRows.length)}
                />
              </div>

              {errorRows.map((row, i) => (
                <AnomalyErrorBanner
                  key={i}
                  agent={row.agent}
                  anomalyType={row.anomaly_type}
                  reason={row.reason}
                  reasonSegments={row.reason_segments}
                />
              ))}

              {okRows.length === 0 && errorRows.length === 0 && (
                <p className="text-sm text-text-secondary">{t("anomalies.empty")}</p>
              )}

              {okRows.length > 0 && <AnomalyTable rows={okRows} />}
            </>
          )}
        </section>

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {t("anomalies.footer.dataSource")}
        </footer>
      </main>
    </div>
  );
}
