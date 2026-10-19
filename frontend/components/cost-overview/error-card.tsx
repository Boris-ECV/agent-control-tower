"use client";

import type { ApiError } from "@/lib/api-client";
import { t } from "@/lib/i18n/t";

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
        {t("errorCard.loadFailedTitle")(title)}
      </p>
      <p className="mb-3 text-xs leading-[18px] text-red-700/85">
        {t("errorCard.queryFailed")(
          error.endpoint,
          error.status ? String(error.status) : t("errorCard.connectionUnavailable"),
          error.message,
        )}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-border bg-bg px-4 py-2 text-sm text-text-primary hover:bg-gray-50"
      >
        {t("errorCard.retry")}
      </button>
    </div>
  );
}
