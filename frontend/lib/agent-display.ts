"use client";

import { useCallback } from "react";

import { fetchAgentCostBreakdown } from "@/lib/agent-detail-api";
import { useFetchOnce } from "@/lib/use-fetch-once";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export function peekAgentDisplayName(key: string): string | undefined {
  return cache.get(key);
}

export function rememberAgentDisplayName(key: string, display: string): void {
  if (display.trim() === "") return;
  cache.set(key, display);
}

export function getAgentDisplayName(key: string): Promise<string> {
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = fetchAgentCostBreakdown(key)
    .then((r) => {
      rememberAgentDisplayName(key, r.display);
      return r.display;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export function clearAgentDisplayCache(): void {
  cache.clear();
  inflight.clear();
}

export function useAgentDisplayName(key: string): string {
  const fetcher = useCallback(() => getAgentDisplayName(key), [key]);
  const state = useFetchOnce(fetcher);
  const peeked = peekAgentDisplayName(key);
  if (peeked) return peeked;
  if (state.status === "success" && state.data.trim() !== "") return state.data;
  return key;
}
