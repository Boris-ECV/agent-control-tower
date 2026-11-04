import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceIdCopy } from "@/components/trace-detail/trace-id-copy";

afterEach(cleanup);

describe("TraceIdCopy", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders the trace id with the font-mono utility class", () => {
    render(<TraceIdCopy traceId="trc_a1b2c3d4e5f6" />);
    const idText = screen.getByText("trc_a1b2c3d4e5f6");
    expect(idText.className).toContain("font-mono");
  });

  it("writes the full trace id to the clipboard when the copy button is clicked", async () => {
    render(<TraceIdCopy traceId="trc_a1b2c3d4e5f6" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "複製 Trace ID" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("trc_a1b2c3d4e5f6");
  });

  it('shows "已複製" feedback after a successful copy and reverts after ~2s', async () => {
    vi.useFakeTimers();
    render(<TraceIdCopy traceId="trc_a1b2c3d4e5f6" />);
    const button = screen.getByRole("button", { name: "複製 Trace ID" });

    await act(async () => {
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button).toHaveTextContent("已複製");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(button).toHaveTextContent("複製");
    expect(button).not.toHaveTextContent("已複製");

    vi.useRealTimers();
  });

  it("does not prematurely dismiss feedback when clicked twice in quick succession", async () => {
    vi.useFakeTimers();
    render(<TraceIdCopy traceId="trc_a1b2c3d4e5f6" />);
    const button = screen.getByRole("button", { name: "複製 Trace ID" });

    await act(async () => {
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button).toHaveTextContent("已複製");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button).toHaveTextContent("已複製");

    // Without clearing the old timer, this would have fired at the
    // 2000ms mark of the FIRST click (1000ms from now) and prematurely
    // reverted the feedback from the second click.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(button).toHaveTextContent("已複製");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(button).toHaveTextContent("複製");

    vi.useRealTimers();
  });

  it("does not throw when unmounted while the revert timer is still pending", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<TraceIdCopy traceId="trc_a1b2c3d4e5f6" />);
    const button = screen.getByRole("button", { name: "複製 Trace ID" });

    await act(async () => {
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button).toHaveTextContent("已複製");

    expect(() => unmount()).not.toThrow();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    vi.useRealTimers();
  });
});
