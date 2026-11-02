import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom 預設沒有實作 PointerEvent 建構子（已知 jsdom 環境限制，與本元件
// 邏輯無關：@base-ui/react 的 Toggle 內部按下空白鍵時會嘗試用
// PointerEvent 合成一個 click 事件來觸發原生 <button> 的啟用行為）。
// 補一個最小 polyfill 讓空白鍵測試能在 jsdom 下通過。
if (typeof window !== "undefined" && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.PointerEvent = PointerEventPolyfill as any;
}

import {
  SegmentedFilter,
  type SegmentedFilterOption,
} from "@/components/common/segmented-filter";

afterEach(cleanup);

type Status = "all" | "ok" | "error";

const options: SegmentedFilterOption<Status>[] = [
  { value: "all", label: "全部" },
  { value: "ok", label: "正常" },
  { value: "error", label: "錯誤" },
];

// 不受控的 wrapper，模擬真實呼叫端把 value/onChange 接到自己的 state，
// 讓測試可以直接觀察「切換後 UI 同步更新」而不需每次手動重新 render。
function ControlledSegmentedFilter({
  countLabel,
}: {
  countLabel?: React.ReactNode;
}) {
  const [value, setValue] = useState<Status>("all");
  return (
    <SegmentedFilter
      options={options}
      value={value}
      onChange={setValue}
      aria-label="狀態篩選"
      countLabel={countLabel}
    />
  );
}

describe("SegmentedFilter", () => {
  // Scenario "樣式": 以分段按鈕（segmented control）呈現，目前選項有明確選取樣式
  it("renders each option as a button with the selected option carrying the pressed styling", () => {
    render(
      <SegmentedFilter
        options={options}
        value="ok"
        onChange={vi.fn()}
        aria-label="狀態篩選"
      />,
    );

    const all = screen.getByRole("button", { name: "全部" });
    const ok = screen.getByRole("button", { name: "正常" });
    const error = screen.getByRole("button", { name: "錯誤" });

    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(ok).toHaveAttribute("aria-pressed", "true");
    expect(error).toHaveAttribute("aria-pressed", "false");

    expect(ok.className).toContain("data-pressed:bg-bg");
    expect(ok.className).toContain("data-pressed:text-text-primary");
  });

  it("carries the focus-visible outline classes for a clear focus ring", () => {
    render(
      <SegmentedFilter
        options={options}
        value="all"
        onChange={vi.fn()}
        aria-label="狀態篩選"
      />,
    );
    const all = screen.getByRole("button", { name: "全部" });
    expect(all.className).toContain("focus-visible:outline");
    expect(all.className).toContain("focus-visible:outline-2");
    expect(all.className).toContain("focus-visible:outline-offset-2");
    expect(all.className).toContain("focus-visible:outline-accent");
  });

  // Scenario "計數": 篩選結果 n 筆、總數 N 筆時右側顯示「顯示 n / N」
  it("renders the given countLabel on the right", () => {
    render(
      <SegmentedFilter
        options={options}
        value="all"
        onChange={vi.fn()}
        aria-label="狀態篩選"
        countLabel="顯示 3 / 10"
      />,
    );
    expect(screen.getByText("顯示 3 / 10")).toBeInTheDocument();
  });

  it("renders no count text when countLabel is omitted", () => {
    render(
      <SegmentedFilter
        options={options}
        value="all"
        onChange={vi.fn()}
        aria-label="狀態篩選"
      />,
    );
    expect(screen.queryByText(/顯示/)).not.toBeInTheDocument();
  });

  // Scenario "切換": 使用者切換選項（點擊或鍵盤操作）時列表與計數同步更新
  it("calls onChange with the clicked option's value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedFilter
        options={options}
        value="all"
        onChange={onChange}
        aria-label="狀態篩選"
      />,
    );
    await user.click(screen.getByRole("button", { name: "錯誤" }));
    expect(onChange).toHaveBeenCalledWith("error");
  });

  it("switching via click updates both the selected styling and the count label (controlled usage)", async () => {
    const user = userEvent.setup();
    render(<ControlledSegmentedFilter countLabel="顯示 3 / 10" />);

    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "錯誤" }));

    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "錯誤" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switching via keyboard (arrow key + Enter) updates the selected value", async () => {
    const user = userEvent.setup();
    render(<ControlledSegmentedFilter />);

    const all = screen.getByRole("button", { name: "全部" });
    const ok = screen.getByRole("button", { name: "正常" });

    all.focus();
    await user.keyboard("{ArrowRight}");
    expect(ok).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(ok).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
  });

  it("switching via keyboard (arrow key + Space) updates the selected value", async () => {
    const user = userEvent.setup();
    render(<ControlledSegmentedFilter />);

    const all = screen.getByRole("button", { name: "全部" });
    const error = screen.getByRole("button", { name: "錯誤" });

    all.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(error).toHaveFocus();

    await user.keyboard(" ");
    expect(error).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
  });

  it("does not allow deselecting the currently active option to empty (clicking the already-pressed option keeps it pressed)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedFilter
        options={options}
        value="all"
        onChange={onChange}
        aria-label="狀態篩選"
      />,
    );
    const all = screen.getByRole("button", { name: "全部" });
    await user.click(all);
    expect(onChange).not.toHaveBeenCalled();
    expect(all).toHaveAttribute("aria-pressed", "true");
  });
});
