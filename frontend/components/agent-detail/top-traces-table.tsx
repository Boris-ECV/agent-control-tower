"use client";

import { useState } from "react";

import { useParams, useRouter } from "next/navigation";

import type { TopTraceItem } from "@/lib/agent-detail-api";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// metadata 是未型別化的 dict | None（SDLCCT-74，見 docs/design/SDLCCT-74.md）。
// 4 個常用欄位（plant/deployed_version/dept/trigger）固定依此陣列順序以標籤
// 顯示，缺少的欄位不顯示空白；其餘欄位（包含未知 key）預設收合，點擊「更多」
// 展開查看 key:value，再點擊收回。metadata 為 null 時維持既有
// t("agentDetail.unknown") 行為，不渲染標籤/展開控制項。
const KNOWN_METADATA_FIELDS: Array<{
  key: string;
  labelKey: "plant" | "deployedVersion" | "dept" | "trigger";
}> = [
  { key: "plant", labelKey: "plant" },
  { key: "deployed_version", labelKey: "deployedVersion" },
  { key: "dept", labelKey: "dept" },
  { key: "trigger", labelKey: "trigger" },
];

function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const knownEntries = KNOWN_METADATA_FIELDS.filter(({ key }) =>
    Object.prototype.hasOwnProperty.call(metadata, key),
  );
  const knownKeys = new Set(KNOWN_METADATA_FIELDS.map(({ key }) => key));
  const otherEntries = Object.entries(metadata).filter(([key]) => !knownKeys.has(key));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {knownEntries.map(({ key, labelKey }) => (
        <span
          key={key}
          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-text-secondary"
        >
          {t(`agentDetail.topTraces.metadata.fields.${labelKey}`)}: {String(metadata[key])}
        </span>
      ))}
      {otherEntries.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
              }
            }}
            className="text-xs text-text-secondary underline"
          >
            {expanded
              ? t("agentDetail.topTraces.metadata.collapse")
              : t("agentDetail.topTraces.metadata.more")}
          </button>
          {expanded && (
            <span className="flex flex-wrap items-center gap-1.5">
              {otherEntries.map(([key, value]) => (
                <code key={key} className="text-xs break-all">
                  {key}: {String(value)}
                </code>
              ))}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function TopTracesTable({ traces }: { traces: TopTraceItem[] }) {
  const router = useRouter();
  const params = useParams<{ key: string }>();

  const goToTrace = (traceId: string) => {
    router.push(`/agents/${encodeURIComponent(params.key)}/traces/${encodeURIComponent(traceId)}`);
  };

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
            role="button"
            tabIndex={0}
            onClick={() => goToTrace(trace.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                goToTrace(trace.id);
              }
            }}
            className="cursor-pointer border-b border-border last:border-b-0 hover:bg-gray-50"
          >
            <td className="py-2 pr-3 font-medium text-text-primary">{trace.id}</td>
            <td className="py-2 pr-3">{formatCurrency(trace.total_estimated_cost)}</td>
            <td className="py-2 pr-3">
              {trace.metadata === null ? (
                t("agentDetail.unknown")
              ) : (
                <MetadataCell metadata={trace.metadata} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
