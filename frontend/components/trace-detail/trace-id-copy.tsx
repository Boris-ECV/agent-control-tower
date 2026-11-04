"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n/t";

// SDLCCT-114: standalone copy-to-clipboard control for the trace detail
// header's Trace ID row. No reusable clipboard/copy component exists
// elsewhere in the codebase (confirmed by architect search, see
// docs/design/SDLCCT-114.md decision 3) -- intentionally not coordinated
// with SDLCCT-110 (separate in-flight sibling ticket adding similar
// functionality on a different page). A future shared `CopyButton`
// component consolidating both is out of scope for this ticket.
export function TraceIdCopy({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(traceId);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be denied due to browser permissions or a
      // non-HTTPS context; the AC does not define failure-state UI, and
      // this is a local-permission issue, not a data-correctness one, so
      // we fail silently (see docs/design/SDLCCT-114.md decision 4).
    }
  }, [traceId]);

  return (
    <div className="mt-1 mb-6 flex items-center gap-2">
      <span className="font-mono text-sm text-text-secondary">{traceId}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t("traceDetail.header.copyAriaLabel")}
        className="rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-gray-100"
      >
        {copied ? t("traceDetail.header.copied") : t("traceDetail.header.copyButton")}
      </button>
    </div>
  );
}
