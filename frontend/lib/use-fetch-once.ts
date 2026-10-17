"use client";

import { useCallback, useEffect, useState } from "react";

import type { ApiError } from "@/lib/cost-overview-api";

type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "success"; data: T };

/**
 * Per-card data fetching hook: each card/section owns its own instance, so
 * one card's failure can never affect another's (docs/design/SDLCCT-32.md
 * "per-card 錯誤呈現" decision -- error isolation at the HTTP-fetch level,
 * not a page-level error boundary).
 */
export function useFetchOnce<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: ApiError) => {
        if (!cancelled) setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // Resetting to "loading" happens here (a user-event handler), not
  // synchronously inside the effect body above, per
  // react-hooks/set-state-in-effect.
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setRetryKey((k) => k + 1);
  }, []);

  return { ...state, retry };
}
