"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";

import { SpanTreeRow } from "@/components/trace-detail/span-tree-row";
import { ErrorCard } from "@/components/cost-overview/error-card";
import { fetchTraceSpans } from "@/lib/trace-spans-api";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

// Execution detail screen (SDLCCT-56): consumes SDLCCT-55's
// GET /api/agents/{key}/traces/{trace_id}/spans. Same client-component
// split as agent-detail-content.tsx -- this file is wrapped in <Suspense>
// by app/agents/[key]/traces/[traceId]/page.tsx (server component) because
// useParams() here needs two dynamic route params (key, traceId), which
// next.config.ts's `cacheComponents: true` requires to be inside Suspense
// (see docs/design/SDLCCT-48.md decision 5, reused verbatim here per
// docs/design/SDLCCT-56.md "介面/API 契約").
//
// Three states only (loading/error/success), matching
// agent-detail-content.tsx/anomalies/page.tsx -- "no data" (Scenario 4) is
// a sub-branch of success (spans.length === 0), not a fourth fetch state.
export function TraceDetailContent() {
  const params = useParams<{ key: string; traceId: string }>();
  const { key, traceId } = params;

  const fetcher = useCallback(() => fetchTraceSpans(key, traceId), [key, traceId]);
  const state = useFetchOnce(fetcher);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-3">
        <span className="text-lg leading-[26px] font-semibold text-text-primary">
          Agent Control Tower
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-6 text-left text-2xl leading-8 font-bold text-text-primary">
          {t("traceDetail.header.title")} — {traceId}
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
            title={t("traceDetail.header.title")}
            error={state.error}
            onRetry={state.retry}
          />
        )}

        {state.status === "success" && state.data.spans.length === 0 && (
          <p className="text-sm text-text-secondary">{t("traceDetail.empty")}</p>
        )}

        {state.status === "success" && state.data.spans.length > 0 && (
          <div className="rounded-lg border border-border bg-bg">
            <SpanTreeRow nodes={state.data.spans} depth={0} />
          </div>
        )}

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {t("traceDetail.footer.dataSource")}
        </footer>
      </main>
    </div>
  );
}
