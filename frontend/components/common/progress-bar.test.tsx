import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProgressBar } from "@/components/common/progress-bar";

afterEach(cleanup);

// SDLCCT-107: 共用進度條元件，搬用 SDLCCT-82 summary-section.tsx 的視覺慣例
// （容器/填充 class、clamp 邏輯），本測試確認搬用結果正確、未走樣。
describe("ProgressBar", () => {
  it("renders a track and a fill sized to pct, using the normal (accent) color when not over budget", () => {
    const { container } = render(<ProgressBar pct={45} danger={false} />);
    const track = container.firstChild as HTMLElement;
    expect(track.className).toContain("h-1.5");
    expect(track.className).toContain("w-full");
    expect(track.className).toContain("overflow-hidden");
    expect(track.className).toContain("rounded-full");
    expect(track.className).toContain("bg-gray-100");

    const fill = track.firstChild as HTMLElement;
    expect(fill.className).toContain("bg-accent");
    expect(fill.className).not.toContain("bg-red-600");
    expect(fill.style.width).toBe("45%");
  });

  it("clamps the fill width to 100% and uses the danger color when pct exceeds 100", () => {
    const { container } = render(<ProgressBar pct={120} danger={true} />);
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.className).toContain("bg-red-600");
    expect(fill.style.width).toBe("100%");
  });

  it("clamps the fill width to 0% for a negative pct", () => {
    const { container } = render(<ProgressBar pct={-10} danger={false} />);
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  // Boundary: the component itself does not decide the danger threshold
  // (the caller passes `danger` in, per the comment above), but it must
  // still render exactly 100% width -- not over-clamp or under-clamp -- at
  // the boundary value itself, with whichever color the caller chose.
  it("renders exactly 100% width at pct=100 without forcing the danger color", () => {
    const { container } = render(<ProgressBar pct={100} danger={false} />);
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(fill.className).toContain("bg-accent");
    expect(fill.className).not.toContain("bg-red-600");
  });
});
