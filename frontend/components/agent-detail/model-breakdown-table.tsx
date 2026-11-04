"use client";

import type { ModelCostBreakdownEntry } from "@/lib/agent-detail-api";
import { formatTableCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// 簡單兩欄表格（model/cost），cost === null 顯示 "—"，不顯示 0（見
// docs/design/SDLCCT-48.md「三個區塊的對應與渲染」段落）。
//
// 第一欄標題為「維度／標籤／成本」；目前所有 entries 皆屬於同一個
// 「model」維度分組，整組放在同一個 <tbody> 分組容器內。本票只實作
// model 這一個維度，不預先搭建多維度分組的通用機制（見
// docs/design/SDLCCT-109.md 決策 2）；分組間的較深分隔線規則在只有
// 一組時不會產生可見效果（見決策 4）。
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
      {/* 單一「model」分組容器 */}
      <tbody className="border-b border-border last-of-type:border-b-0">
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
