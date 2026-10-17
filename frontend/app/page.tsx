"use client";

import { useState } from "react";

import { PeriodComparisonSection } from "@/components/cost-overview/period-comparison-section";
import { SummarySection } from "@/components/cost-overview/summary-section";
import { formatTaiwanDate } from "@/lib/format";

export default function CostOverviewPage() {
  // anchor_date comes from the summary endpoint (AC4); if summary itself
  // fails, this stays null and the header shows "無法取得" rather than a
  // blank or fabricated date (docs/design/SDLCCT-32.md decision).
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-3">
        <span className="text-lg leading-[26px] font-semibold text-text-primary">
          Agent Control Tower
        </span>
        <span className="text-xs leading-[18px] text-text-secondary">
          今天（台灣時間）：
          {anchorDate ? formatTaiwanDate(anchorDate) : "無法取得"}
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <h1 className="mb-1 text-left text-2xl leading-8 font-bold text-text-primary">
          成本總覽
        </h1>
        <p className="mb-6 text-left text-xs leading-[18px] text-text-secondary">
          本月成本 vs 預算、預估月底超支、跨 Agent 期間比較
        </p>

        <section aria-label="本月成本 vs 預算總覽" className="mb-8">
          <h2 className="mb-4 text-left text-lg leading-[26px] font-semibold text-text-primary">
            本月成本 vs 預算總覽
          </h2>
          <SummarySection onAnchorDate={setAnchorDate} />
        </section>

        <section aria-label="跨 Agent 期間比較" className="mb-8">
          <h2 className="mb-4 text-left text-lg leading-[26px] font-semibold text-text-primary">
            跨 Agent 期間比較（誰漲最多）
          </h2>
          <PeriodComparisonSection />
        </section>

        <footer className="mt-12 border-t border-border py-4 text-left text-xs leading-[18px] text-text-secondary">
          資料來源：Agent registry ＋ 觀測性後端成本查詢。
        </footer>
      </main>
    </div>
  );
}
