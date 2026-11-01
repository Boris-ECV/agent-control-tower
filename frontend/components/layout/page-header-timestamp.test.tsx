import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageHeaderTimestamp } from "@/components/layout/page-header-timestamp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  container.remove();
});

function renderAt(iso: string): string {
  vi.setSystemTime(new Date(iso));
  const root = createRoot(container);
  act(() => {
    root.render(<PageHeaderTimestamp />);
  });
  const text = container.querySelector('[data-testid="page-header-timestamp"]')!.textContent!;
  act(() => root.unmount());
  return text;
}

describe("PageHeaderTimestamp", () => {
  it("shows page-load time in Taipei (UTC 06:30 -> 14:30)", () => {
    expect(renderAt("2026-10-15T06:30:00Z")).toBe("資料更新於 2026/10/15 14:30（台灣時間）");
  });

  it("rolls the date over (UTC 17:05 -> next day 01:05)", () => {
    expect(renderAt("2026-10-15T17:05:00Z")).toBe("資料更新於 2026/10/16 01:05（台灣時間）");
  });

  it("has no old wording, pure-date text or unavailable text, and makes no fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const text = renderAt("2026-10-15T06:30:00Z");
    expect(text).not.toContain("今天");
    expect(text).not.toContain("無法取得");
    expect(text).not.toMatch(/\d{4}年/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("server render is an invisible aria-hidden placeholder without a real time", () => {
    vi.setSystemTime(new Date("2026-10-15T06:30:00Z"));
    const html = renderToString(<PageHeaderTimestamp />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("invisible");
    expect(html).toContain("0000/00/00 00:00");
    expect(html).not.toContain("2026/10/15");
    expect(html.match(/whitespace-nowrap/g)).toHaveLength(2);
  });

  it("hydrates without mismatch and then fills in the real time", () => {
    vi.setSystemTime(new Date("2026-10-15T06:30:00Z"));
    container.innerHTML = renderToString(<PageHeaderTimestamp />);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, <PageHeaderTimestamp />);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(container.textContent).toBe("資料更新於 2026/10/15 14:30（台灣時間）");
    act(() => root.unmount());
  });
});
