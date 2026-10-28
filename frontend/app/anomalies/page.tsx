"use client";

import { AnomalyErrorBanner } from "@/components/anomalies/anomaly-error-banner";
import { AnomalyTable } from "@/components/anomalies/anomaly-table";
import { ErrorCard } from "@/components/cost-overview/error-card";
import type { AnomalyRow } from "@/lib/anomalies-api";
import { fetchAnomalyFeed } from "@/lib/anomalies-api";
import { formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { useFetchOnce } from "@/lib/use-fetch-once";

export default function AnomaliesPage() {
  const state = useFetchOnce(fetchAnomalyFeed);

  const okRows: AnomalyRow[] = state.status === "success"
    ? state.data.anomalies.filter((row) => row.status === "ok")
    : [];
  const errorRows: AnomalyRow[] = state.status === "success"
    ? state.data.anomalies.filter((row) => row.status === "error")
    : [];

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
          {t("anomalies.header.title")}
        </h1>
        <p className="mb-6 text-left text-xs leading-[18px] text-text-secondary">
          {t("anomalies.header.subtitle")}
        </p>

        <section aria-label={t("anomalies.header.title")}>
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
            <ErrorCard
              title={t("anomalies.header.title")}
              error={state.error}
              onRetry={state.retry}
            />
          )}

          {state.status === "success" && (
            <>
              {errorRows.map((row, i) => (
                <AnomalyErrorBanner
                  key={i}
                  agent={row.agent}
                  anomalyType={row.anomaly_type}
                  reason={row.reason}
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
