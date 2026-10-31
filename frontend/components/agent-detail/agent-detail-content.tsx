"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";

import { ModelBreakdownTable } from "@/components/agent-detail/model-breakdown-table";
import { TopTracesTable } from "@/components/agent-detail/top-traces-table";
import { VersionCostChart } from "@/components/agent-detail/version-cost-chart";
import { BackLink } from "@/components/common/back-link";
import { ErrorCard } from "@/components/cost-overview/error-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { rememberAgentDisplayName } from "@/lib/agent-display";
import { buildAgentBreadcrumbs } from "@/lib/breadcrumbs";
import { formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

// 本頁是這個 repo 第一個動態路由段（`/agents/[key]`），依 Next.js App
// Router 標準 client component 慣例以 useParams() 取得路由參數（見
// docs/design/SDLCCT-48.md 決策 5：沒有既有慣例可完全照搬，不新增路由
// 輔助層）。GET /api/agents/{key}/cost-breakdown 是單一原子呼叫，三個區
// 塊的資料全部包在同一個 200 回應裡，因此這裡只用一個 useFetchOnce
// instance（決策 1：唯一的失敗模式是整頁失敗，不實作 per-section 錯誤）。
//
// 這個 client component 的內容被上層 app/agents/[key]/page.tsx（server
// component）包在 <Suspense> 裡 -- route param 只在 request time 才知
// 道，無法在 build time 靜態 prerender（next.config.ts 的
// `cacheComponents: true` 要求動態 hook 包在 Suspense 裡才允許 blocking
// fallback）。這純粹是 Next.js build-time 機制要求的拆檔，不是本票 spec
// 的產品行為；頁面本身的 loading/error/success 三態渲染仍完全由
// useFetchOnce 負責（Suspense fallback 只在極短暫的 route-param 解析期間
// 顯示，和 useFetchOnce 的 loading 骨架是兩個不同層次）。
export function AgentDetailContent() {
  const params = useParams<{ key: string }>();
  const key = params.key;

  const fetcher = useCallback(
    () =>
      fetchAgentCostBreakdown(key).then((d) => {
        rememberAgentDisplayName(key, d.display);
        return d;
      }),
    [key],
  );
  const state = useFetchOnce(fetcher);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg px-6 py-3">
        <Breadcrumbs
          items={buildAgentBreadcrumbs({
            agentKey: key,
            agentName: state.status === "success" && state.data.display ? state.data.display : key,
          })}
        />
        <div className="flex items-center justify-between">
          <BackLink href="/agents" label={t("agentDetail.header.backToList")} />
          <span className="text-xs leading-[18px] text-text-secondary">
            {state.status === "success"
              ? formatTaiwanDate(state.data.anchor_date)
              : t("costOverview.header.unavailable")}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-1 text-left text-2xl leading-8 font-bold text-text-primary">
          {state.status === "success" ? state.data.display : t("agentDetail.header.title")}
        </h1>

        {state.status === "loading" && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg border border-border bg-gray-50"
              />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <ErrorCard
            title={t("agentDetail.header.title")}
            error={state.error}
            onRetry={state.retry}
          />
        )}

        {state.status === "success" && (
          <>
            <section aria-label={t("agentDetail.versionSeries.title")} className="mb-8">
              <h2 className="mb-3 text-lg leading-7 font-semibold text-text-primary">
                {t("agentDetail.versionSeries.title")}
              </h2>
              <VersionCostChart
                entries={state.data.version_cost_series}
                anchorDate={state.data.anchor_date}
              />
            </section>

            <section aria-label={t("agentDetail.modelBreakdown.title")} className="mb-8">
              <h2 className="mb-3 text-lg leading-7 font-semibold text-text-primary">
                {t("agentDetail.modelBreakdown.title")}
              </h2>
              <ModelBreakdownTable entries={state.data.model_cost_breakdown} />
            </section>

            <section aria-label={t("agentDetail.topTraces.title")} className="mb-8">
              <h2 className="mb-3 text-lg leading-7 font-semibold text-text-primary">
                {t("agentDetail.topTraces.title")}
              </h2>
              <TopTracesTable traces={state.data.top_traces} />
            </section>
          </>
        )}

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {t("agentDetail.footer.dataSource")}
        </footer>
      </main>
    </div>
  );
}
