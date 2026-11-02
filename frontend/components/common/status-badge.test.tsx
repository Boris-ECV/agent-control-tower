import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/common/status-badge";

afterEach(cleanup);

// SDLCCT-100: 共用狀態標籤元件。Scenario "樣式"：底色、外框、色點三元素；
// Scenario "對比度"：兩個 variant 的文字/底色對比皆 >= 4.5:1（色值驗證見
// docs/design/SDLCCT-100.md，此處確認 class 組合與設計文件一致，不重算對
// 比度公式）。
describe("StatusBadge", () => {
  it("renders children text inside a badge with border and background classes (success variant)", () => {
    render(<StatusBadge variant="success">正常</StatusBadge>);
    const badge = screen.getByText("正常");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).toContain("border-border");
    expect(badge.className).toContain("bg-gray-50");
    expect(badge.className).toContain("text-text-secondary");
    expect(badge.className).toContain("rounded-full");
    expect(badge.className).toContain("border");
  });

  it("renders children text inside a badge with border and background classes (danger variant)", () => {
    render(<StatusBadge variant="danger">異常</StatusBadge>);
    const badge = screen.getByText("異常");
    expect(badge.className).toContain("border-red-300");
    expect(badge.className).toContain("bg-red-50");
    expect(badge.className).toContain("text-red-700");
  });

  it("renders a decorative dot marked aria-hidden, colored to match the variant", () => {
    render(<StatusBadge variant="success">正常</StatusBadge>);
    const badge = screen.getByText("正常");
    const dot = badge.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("bg-text-secondary");
  });

  it("colors the dot red for the danger variant", () => {
    render(<StatusBadge variant="danger">異常</StatusBadge>);
    const badge = screen.getByText("異常");
    const dot = badge.querySelector("span[aria-hidden='true']");
    expect(dot?.className).toContain("bg-red-600");
  });
});

// Scenario "對比度": 文字與底色對比 >= 4.5:1。獨立重算 WCAG 相對亮度公式
// （不只比對 class 名稱），確保兩個 variant 實際使用的色值組合都通過門檻，
// 而不是信任設計文件裡已經算過的數字。
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const channel = c / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("StatusBadge contrast", () => {
  it("success variant text (text-text-secondary #475467) vs background (bg-gray-50 #F9FAFB) is >= 4.5:1", () => {
    const ratio = contrastRatio([0x47, 0x54, 0x67], [0xf9, 0xfa, 0xfb]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("danger variant text (text-red-700 #B91C1C) vs background (bg-red-50 #FEF2F2) is >= 4.5:1", () => {
    const ratio = contrastRatio([0xb9, 0x1c, 0x1c], [0xfe, 0xf2, 0xf2]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
