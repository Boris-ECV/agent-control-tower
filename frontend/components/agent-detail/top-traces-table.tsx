"use client";

import type { TopTraceItem } from "@/lib/agent-detail-api";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// metadata 是未型別化的 dict | None，原樣以 JSON.stringify 顯示，不嘗試解析
// 特定欄位（見 docs/design/SDLCCT-48.md 決策 4）。每列有 cursor-pointer/
// hover 樣式但刻意不加任何 onClick/<Link>/onKeyDown（AC4：視覺上可點擊，
// 點擊不觸發任何導覽或 API 呼叫——執行詳情畫面是另一張未來票）。
export function TopTracesTable({ traces }: { traces: TopTraceItem[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3">{t("agentDetail.topTraces.table.columns.id")}</th>
          <th className="py-2 pr-3">{t("agentDetail.topTraces.table.columns.cost")}</th>
          <th className="py-2 pr-3">
            {t("agentDetail.topTraces.table.columns.metadata")}
          </th>
        </tr>
      </thead>
      <tbody>
        {traces.map((trace) => (
          <tr
            key={trace.id}
            className="cursor-pointer border-b border-border last:border-b-0 hover:bg-gray-50"
          >
            <td className="py-2 pr-3 font-medium text-text-primary">{trace.id}</td>
            <td className="py-2 pr-3">{formatCurrency(trace.total_estimated_cost)}</td>
            <td className="py-2 pr-3">
              {trace.metadata === null ? (
                t("agentDetail.unknown")
              ) : (
                <code className="text-xs break-all">
                  {JSON.stringify(trace.metadata)}
                </code>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
