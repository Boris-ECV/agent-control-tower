"use client";

import type { AnomalyRow } from "@/lib/anomalies-api";
import { formatTaiwanDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// anomaly_type 的本地化標籤（5 個，逐一列出，供後續故事沿用同一組文案，
// 見 docs/design/SDLCCT-52.md 決策 5）。未知值 fallback 顯示原始字串本身
// （防禦性寫法，不因未來新增第 6 種規則而顯示空白）。
export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  tool_retry_loop: t("anomalies.anomalyTypes.toolRetryLoop"),
  context_bloat: t("anomalies.anomalyTypes.contextBloat"),
  night_batch_burst: t("anomalies.anomalyTypes.nightBatchBurst"),
  model_switch: t("anomalies.anomalyTypes.modelSwitch"),
  governance_gap: t("anomalies.anomalyTypes.governanceGap"),
};

export function formatAnomalyDate(date: string | null): string {
  return date === null ? t("anomalies.table.ongoing") : formatTaiwanDate(date);
}

function AnomalyDesktopTable({ rows }: { rows: AnomalyRow[] }) {
  return (
    <table className="hidden w-full border-collapse text-sm md:table">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3">{t("anomalies.table.columns.agent")}</th>
          <th className="py-2 pr-3">{t("anomalies.table.columns.anomalyType")}</th>
          <th className="py-2 pr-3">{t("anomalies.table.columns.date")}</th>
          <th className="py-2 pr-3">{t("anomalies.table.columns.reason")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border last:border-b-0">
            <td className="py-2 pr-3 font-medium text-text-primary">
              {row.agent ?? t("anomalies.table.unknownAgent")}
            </td>
            <td className="py-2 pr-3">
              {ANOMALY_TYPE_LABELS[row.anomaly_type] ?? row.anomaly_type}
            </td>
            <td className="py-2 pr-3">{formatAnomalyDate(row.date)}</td>
            <td className="py-2 pr-3">{row.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnomalyCardList({ rows }: { rows: AnomalyRow[] }) {
  return (
    <ul className="flex list-none flex-col gap-3 p-0 md:hidden">
      {rows.map((row, i) => (
        <li key={i} className="rounded-lg border border-border bg-bg p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-text-primary">
              {row.agent ?? t("anomalies.table.unknownAgent")}
            </span>
            <span className="text-xs text-text-secondary">
              {ANOMALY_TYPE_LABELS[row.anomaly_type] ?? row.anomaly_type}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-xs text-text-secondary">
            <dt>{t("anomalies.table.columns.date")}</dt>
            <dd className="text-right text-text-primary">{formatAnomalyDate(row.date)}</dd>
            <dt>{t("anomalies.table.columns.reason")}</dt>
            <dd className="text-right text-text-primary">{row.reason}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function AnomalyTable({ rows }: { rows: AnomalyRow[] }) {
  return (
    <>
      <AnomalyDesktopTable rows={rows} />
      <AnomalyCardList rows={rows} />
    </>
  );
}
