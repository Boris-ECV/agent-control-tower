"use client";

import { t } from "@/lib/i18n/t";

import { AnomalyTypeBadge, ReasonText } from "./anomaly-table";

/**
 * AC4 的錯誤呈現元件：這個端點 200 回應內某一列 status="error"（SDLCCT-51
 * per-rule-error-row 設計），與 ErrorCard 表達的「整個請求失敗」是不同的
 *錯誤通道（docs/design/SDLCCT-52.md 決策 2）。比照 error-card.tsx 的紅色
 * banner 視覺慣例，但 prop 形狀是本票自己的、沒有 onRetry（沒有對應的重試
 * 動作）。SDLCCT-84：anomalyType 分色標籤與 reason 的 <code> 片段渲染沿用
 * AnomalyTable 同一套邏輯（AnomalyTypeBadge/ReasonText），但本橫幅是獨立
 * <div>、不是表格列，不套用 ClickableRow（見 docs/design/SDLCCT-84.md 關
 * 鍵技術決策 7）。
 */
export function AnomalyErrorBanner({
  agent,
  anomalyType,
  reason,
  reasonSegments,
}: {
  agent: string | null;
  anomalyType: string;
  reason: string;
  reasonSegments?: { text: string; code: boolean }[] | null;
}) {
  return (
    <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-4">
      <p className="mb-1 text-sm font-semibold text-red-700">
        {t("anomalies.errorBanner.title")}
      </p>
      <p className="text-xs leading-[18px] text-red-700/85">
        {agent ?? t("anomalies.errorBanner.unknownAgent")}（
        <AnomalyTypeBadge anomalyType={anomalyType} />
        ）：<ReasonText reason={reason} segments={reasonSegments ?? null} />
      </p>
    </div>
  );
}
