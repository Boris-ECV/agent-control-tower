"use client";

import { useState } from "react";

import { PeriodComparisonSection } from "@/components/cost-overview/period-comparison-section";
import { SummarySection } from "@/components/cost-overview/summary-section";
import { formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";

export default function CostOverviewPage() {
  // anchor_date comes from the summary endpoint (AC4); if summary itself
  // fails, this stays null and the header shows "無法取得" rather than a
  // blank or fabricated date (docs/design/SDLCCT-32.md decision).
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-end border-b border-border bg-bg px-6 py-3">
        <span className="text-xs leading-[18px] text-text-secondary">
          {t("costOverview.header.today")}
          {anchorDate ? formatTaiwanDate(anchorDate) : t("costOverview.header.unavailable")}
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-1 text-left text-2xl leading-8 font-bold text-text-primary">
          {t("costOverview.header.title")}
        </h1>
        <p className="mb-6 text-left text-xs leading-[18px] text-text-secondary">
          {t("costOverview.header.subtitle")}
        </p>

        <section aria-label={t("costOverview.summarySection.title")} className="mb-8">
          <h2 className="mb-4 text-left text-lg leading-[26px] font-semibold text-text-primary">
            {t("costOverview.summarySection.title")}
          </h2>
          <SummarySection onAnchorDate={setAnchorDate} />
        </section>

        <section aria-label={t("costOverview.periodSection.title")} className="mb-8">
          <h2 className="mb-4 text-left text-lg leading-[26px] font-semibold text-text-primary">
            {t("costOverview.periodSection.heading")}
          </h2>
          <PeriodComparisonSection />
        </section>

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          {t("costOverview.footer.dataSource")}
        </footer>
      </main>
    </div>
  );
}
