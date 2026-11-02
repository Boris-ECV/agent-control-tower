import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClickableRow } from "@/components/common/clickable-row";

afterEach(cleanup);

// SDLCCT-101: hover 底色、箭頭動效（group class）、鍵盤 Enter/空白鍵開啟、
// 可見焦點外框。渲染為 <tr>，必須包在 <table><tbody> 裡才合法。
function renderRow(onActivate: () => void) {
  render(
    <table>
      <tbody>
        <ClickableRow onActivate={onActivate} aria-label="測試列">
          <td>cell</td>
        </ClickableRow>
      </tbody>
    </table>,
  );
  return screen.getByRole("button", { name: "測試列" });
}

describe("ClickableRow", () => {
  it("renders as a <tr> with role=button, tabIndex=0, and the given aria-label", () => {
    const row = renderRow(vi.fn());
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-label", "測試列");
  });

  // Scenario "hover": 列加底色，尾端箭頭變色並右移。The arrow itself lives in
  // the caller's trailing <td> (not this component), driven by the shared
  // `group` class this component puts on the <tr> plus group-hover variants
  // on the caller's arrow <svg> (see agents/page.tsx, top-traces-table.tsx).
  // This component's own contract is: it must carry `group`, `cursor-pointer`,
  // and a hover background class for that mechanism to work at all.
  it("carries the group, cursor-pointer, and hover background classes needed for the hover effect", () => {
    const row = renderRow(vi.fn());
    expect(row.className).toContain("group");
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-gray-50");
  });

  // Scenario "焦點樣式": 顯示清楚的焦點外框 -- the design doc specifies reusing
  // docs/design-system.md §8's focus-visible outline convention.
  it("carries the focus-visible outline classes for a clear focus ring", () => {
    const row = renderRow(vi.fn());
    expect(row.className).toContain("focus-visible:outline");
    expect(row.className).toContain("focus-visible:outline-2");
    expect(row.className).toContain("focus-visible:outline-offset-2");
    expect(row.className).toContain("focus-visible:outline-accent");
  });

  it("calls onActivate when clicked", () => {
    const onActivate = vi.fn();
    const row = renderRow(onActivate);
    fireEvent.click(row);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  // Scenario "鍵盤開啟": Tab 聚焦並按 Enter 或空白鍵都要觸發，行為與點擊一致。
  it("calls onActivate on Enter key", () => {
    const onActivate = vi.fn();
    const row = renderRow(onActivate);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("calls onActivate on Space key", () => {
    const onActivate = vi.fn();
    const row = renderRow(onActivate);
    fireEvent.keyDown(row, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("does not call onActivate on an unrelated key", () => {
    const onActivate = vi.fn();
    const row = renderRow(onActivate);
    fireEvent.keyDown(row, { key: "Tab" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("renders without aria-label when none is given (TopTracesTable usage)", () => {
    const onActivate = vi.fn();
    render(
      <table>
        <tbody>
          <ClickableRow onActivate={onActivate}>
            <td>cell</td>
          </ClickableRow>
        </tbody>
      </table>,
    );
    const row = screen.getByRole("button");
    expect(row).not.toHaveAttribute("aria-label");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
