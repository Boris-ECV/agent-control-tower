"use client";

import type { ApiError } from "@/lib/cost-overview-api";

/**
 * Per-card error state (docs/design/SDLCCT-32.md AC5 / prototype's error
 * example):明確顯示 endpoint + status，never blank/0. Does not affect any
 * other card -- each card instantiates its own fetch + error state.
 */
export function ErrorCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: ApiError;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4">
      <p className="mb-1 text-sm font-semibold text-red-700">
        無法載入「{title}」
      </p>
      <p className="mb-3 text-xs leading-[18px] text-red-700/85">
        查詢失敗：{error.endpoint} 回應 {error.status || "無法連線"}
        {error.message ? `（${error.message}）` : ""}。其他卡片資料不受影響。
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-text-primary hover:bg-gray-50"
      >
        重試
      </button>
    </div>
  );
}
