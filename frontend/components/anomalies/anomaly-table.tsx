"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClickableRow } from "@/components/common/clickable-row";
import { StatusBadge } from "@/components/common/status-badge";
import type { AnomalyRow } from "@/lib/anomalies-api";
import { formatSlashDate } from "@/lib/format";
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
  return date === null ? t("anomalies.table.ongoing") : formatSlashDate(date);
}

// SDLCCT-84: 列表中與告警對應的 Agent，附帶前端 join 出的中文顯示名稱
// （找不到對照、或 agent 本身為 null 時 agentDisplay 為 undefined，呈現層
// fallback 顯示系統代號本身／「不明」，見 docs/design/SDLCCT-84.md 關鍵技
// 術決策 4）。
export type EnrichedAnomalyRow = AnomalyRow & { agentDisplay?: string };

/** SDLCCT-84 決策 2：治理缺口沿用既有 danger variant，模型切換用新
 * warning variant；其餘 3 種異常類型維持現狀純文字，不套用 badge。 */
export function AnomalyTypeBadge({ anomalyType }: { anomalyType: string }) {
  const label = ANOMALY_TYPE_LABELS[anomalyType] ?? anomalyType;
  if (anomalyType === "governance_gap") {
    return <StatusBadge variant="danger">{label}</StatusBadge>;
  }
  if (anomalyType === "model_switch") {
    return <StatusBadge variant="warning">{label}</StatusBadge>;
  }
  return <>{label}</>;
}

/** SDLCCT-84 決策 8：「持續中」改用既有 success（中性灰）variant 的
 * StatusBadge 取代純文字，與一般日期文字產生視覺區隔；有實際日期時維持
 * 現狀純文字呈現。 */
export function AnomalyDateCell({ date }: { date: string | null }) {
  if (date === null) {
    return <StatusBadge variant="success">{t("anomalies.table.ongoing")}</StatusBadge>;
  }
  return <>{formatSlashDate(date)}</>;
}

/** SDLCCT-84 決策 5：reason_segments 非 null 時（目前只有 model_switch）
 * 逐段渲染，code: true 的片段（模型名稱）以 <code> 等寬樣式標示；為 null
 * 時維持現狀直接渲染 reason 純文字。anomaly-error-banner.tsx 共用此邏輯。 */
export function ReasonText({
  reason,
  segments,
}: {
  reason: string;
  segments: AnomalyRow["reason_segments"];
}) {
  if (!segments) {
    return <>{reason}</>;
  }
  return (
    <>
      {segments.map((segment, i) =>
        segment.code ? (
          <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">
            {segment.text}
          </code>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** SDLCCT-84 決策 4：Agent 欄中文名稱為主要文字、系統代號等寬字放名稱下
 * 一行。agentDisplay 為 undefined（agent 為 null，或在 agent registry 中
 * 找不到對照）時，直接顯示系統代號本身（或「不明」），不疊顯第二行。 */
export function AgentCell({
  agent,
  agentDisplay,
}: {
  agent: string | null;
  agentDisplay: string | undefined;
}) {
  if (agent === null) {
    return <>{t("anomalies.table.unknownAgent")}</>;
  }
  if (agentDisplay === undefined) {
    return <>{agent}</>;
  }
  return (
    <div className="flex flex-col">
      <span>{agentDisplay}</span>
      <span className="font-mono text-xs text-text-secondary">{agent}</span>
    </div>
  );
}

function AnomalyDesktopTable({ rows }: { rows: EnrichedAnomalyRow[] }) {
  const router = useRouter();

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
        {rows.map((row, i) => {
          const cells = (
            <>
              <td className="py-2 pr-3 font-medium text-text-primary">
                <AgentCell agent={row.agent} agentDisplay={row.agentDisplay} />
              </td>
              <td className="py-2 pr-3">
                <AnomalyTypeBadge anomalyType={row.anomaly_type} />
              </td>
              <td className="py-2 pr-3">
                <AnomalyDateCell date={row.date} />
              </td>
              <td className="py-2 pr-3">
                <ReasonText reason={row.reason} segments={row.reason_segments} />
              </td>
            </>
          );

          // SDLCCT-84 決策 7：row.agent === null 的列沒有有效 Agent key 可
          // 供導航，不套用 ClickableRow，維持既有不可點擊 <tr>。
          if (row.agent === null) {
            return (
              <tr key={i} className="border-b border-border last:border-b-0">
                {cells}
              </tr>
            );
          }

          return (
            <ClickableRow
              key={i}
              aria-label={row.agentDisplay ?? row.agent}
              onActivate={() => router.push(`/agents/${row.agent}`)}
            >
              {cells}
            </ClickableRow>
          );
        })}
      </tbody>
    </table>
  );
}

function AnomalyCardList({ rows }: { rows: EnrichedAnomalyRow[] }) {
  return (
    <ul className="flex list-none flex-col gap-3 p-0 md:hidden">
      {rows.map((row, i) => {
        const card = (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-text-primary">
                <AgentCell agent={row.agent} agentDisplay={row.agentDisplay} />
              </span>
              <span className="text-xs text-text-secondary">
                <AnomalyTypeBadge anomalyType={row.anomaly_type} />
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-xs text-text-secondary">
              <dt>{t("anomalies.table.columns.date")}</dt>
              <dd className="text-right text-text-primary">
                <AnomalyDateCell date={row.date} />
              </dd>
              <dt>{t("anomalies.table.columns.reason")}</dt>
              <dd className="text-right text-text-primary">
                <ReasonText reason={row.reason} segments={row.reason_segments} />
              </dd>
            </dl>
          </>
        );

        if (row.agent === null) {
          return (
            <li key={i} className="rounded-lg border border-border bg-bg p-4">
              {card}
            </li>
          );
        }

        return (
          <li key={i} className="rounded-lg border border-border bg-bg p-4">
            <Link href={`/agents/${row.agent}`} className="block">
              {card}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AnomalyTable({ rows }: { rows: EnrichedAnomalyRow[] }) {
  return (
    <>
      <AnomalyDesktopTable rows={rows} />
      <AnomalyCardList rows={rows} />
    </>
  );
}
