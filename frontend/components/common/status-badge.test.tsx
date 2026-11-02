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
