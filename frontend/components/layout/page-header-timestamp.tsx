"use client";

import { useState, useSyncExternalStore } from "react";

import { formatSlashDateTimeMinute } from "@/lib/format";
import { t } from "@/lib/i18n/t";

// Same length/structure as a real value so the placeholder reserves the
// exact space (no layout shift). See docs/design/SDLCCT-103.md.
const PLACEHOLDER = "0000/00/00 00:00";

const subscribe = () => () => {};
const getServerSnapshot = () => null;

/** Page-load time in Asia/Taipei. Read from the browser clock on the client
 * only; server snapshot is null so SSR/hydration render the placeholder. */
export function PageHeaderTimestamp() {
  const [store] = useState(() => ({ cached: null as string | null }));
  const time = useSyncExternalStore(
    subscribe,
    () => (store.cached ??= formatSlashDateTimeMinute(new Date())),
    getServerSnapshot,
  );

  return (
    <span
      data-testid="page-header-timestamp"
      className="text-right text-xs leading-[18px] text-text-secondary"
    >
      {time === null ? (
        <span aria-hidden="true" className="invisible">
          <span className="whitespace-nowrap">{t("pageHeader.updatedAt")(PLACEHOLDER)}</span>
          <span className="whitespace-nowrap">{t("pageHeader.timezone")}</span>
        </span>
      ) : (
        <>
          <span className="whitespace-nowrap">{t("pageHeader.updatedAt")(time)}</span>
          <span className="whitespace-nowrap">{t("pageHeader.timezone")}</span>
        </>
      )}
    </span>
  );
}
