"use client";

import { useState } from "react";

import { useParams, useRouter } from "next/navigation";

import { ClickableRow } from "@/components/common/clickable-row";
import type { TopTraceItem } from "@/lib/agent-detail-api";
import { formatSlashDateTimeMinute, formatTableCurrency } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import { parseTraceStartTime, truncateTraceId } from "@/lib/trace-id";

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

// Trace ID 儲存格：截斷顯示（原始字串 <= 12 字元時完整顯示，見
// `lib/trace-id.ts` `truncateTraceId`）、原生 `title` 屬性 hover 顯示完整
// ID、旁邊一個複製按鈕。複製按鈕的 onClick/onKeyDown 必須
// `stopPropagation()`，與 `MetadataCell` 的「更多/收合」按鈕使用完全相同
// 的相容模式（ClickableRow 把 onClick/onKeyDown 掛在 <tr> 本身，見該元件
// 與 docs/design/SDLCCT-110.md 決策 5）。
function TraceIdCell({
  traceId,
  copiedId,
  setCopiedId,
}: {
  traceId: string;
  copiedId: string | null;
  setCopiedId: (id: string | null | ((cur: string | null) => string | null)) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1" title={traceId}>
      {truncateTraceId(traceId)}
      <button
        type="button"
        aria-label={t("agentDetail.topTraces.traceId.copyAriaLabel")}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(traceId);
          setCopiedId(traceId);
          window.setTimeout(() => setCopiedId((cur) => (cur === traceId ? null : cur)), 1500);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
          }
        }}
        className="rounded p-1 text-text-secondary hover:bg-gray-100 hover:text-accent"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none fill-current">
          <path d="M5 2a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H5Zm6 10H4V5h7v7Zm1-2V3H6v1h4a1 1 0 0 1 1 1v5h1Z" />
        </svg>
      </button>
      {copiedId === traceId && (
        <span aria-live="polite" className="text-xs text-text-secondary">
          {t("agentDetail.topTraces.traceId.copied")}
        </span>
      )}
    </span>
  );
}

export function TopTracesTable({ traces }: { traces: TopTraceItem[] }) {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const goToTrace = (traceId: string) => {
    router.push(`/agents/${encodeURIComponent(params.key)}/traces/${encodeURIComponent(traceId)}`);
  };

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3">{t("agentDetail.topTraces.table.columns.id")}</th>
          <th className="py-2 pr-3">{t("agentDetail.topTraces.table.columns.startTime")}</th>
          <th className="py-2 pr-3 text-right">{t("agentDetail.topTraces.table.columns.cost")}</th>
          <th className="py-2 pr-3">
            {t("agentDetail.topTraces.table.columns.metadata")}
          </th>
          <th className="py-2 pr-3" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {traces.map((trace) => (
          <ClickableRow key={trace.id} onActivate={() => goToTrace(trace.id)}>
            <td className="py-2 pr-3 font-medium text-text-primary">
              <TraceIdCell traceId={trace.id} copiedId={copiedId} setCopiedId={setCopiedId} />
            </td>
            <td className="py-2 pr-3 whitespace-nowrap">
              {formatSlashDateTimeMinute(parseTraceStartTime(trace.id) ?? new Date(NaN))}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatTableCurrency(trace.total_estimated_cost)}</td>
            <td className="py-2 pr-3">
              {trace.metadata === null ? (
                t("agentDetail.unknown")
              ) : (
                <MetadataCell metadata={trace.metadata} />
              )}
            </td>
            <td className="py-2 pr-3" aria-hidden="true">
              {/* SDLCCT-101 CI fix: see app/agents/page.tsx's arrow <svg> for
                  the full rationale -- `translate-x-*` sets the native CSS
                  `translate` property in Tailwind v4, not `transform`, so
                  only `translate` belongs in the transition list here. */}
              <svg
                viewBox="0 0 16 16"
                className="h-4 w-4 flex-none fill-current text-text-secondary transition-[translate] group-hover:translate-x-1 group-hover:text-accent group-focus-visible:translate-x-1 group-focus-visible:text-accent"
              >
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </td>
          </ClickableRow>
        ))}
      </tbody>
    </table>
  );
}
