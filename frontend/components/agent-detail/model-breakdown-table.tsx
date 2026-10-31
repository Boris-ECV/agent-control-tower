"use client";

import type { ModelCostBreakdownEntry } from "@/lib/agent-detail-api";
import { formatTableCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// 簡單兩欄表格（model/cost），cost === null 顯示 "—"，不顯示 0（見
// docs/design/SDLCCT-48.md「三個區塊的對應與渲染」段落）。
export function ModelBreakdownTable({
  entries,
}: {
  entries: ModelCostBreakdownEntry[];
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3">
            {t("agentDetail.modelBreakdown.table.columns.model")}
          </th>
          <th className="py-2 pr-3 text-right">
            {t("agentDetail.modelBreakdown.table.columns.cost")}
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.model} className="border-b border-border last:border-b-0">
            <td className="py-2 pr-3 font-medium text-text-primary">{entry.model}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatTableCurrency(entry.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
