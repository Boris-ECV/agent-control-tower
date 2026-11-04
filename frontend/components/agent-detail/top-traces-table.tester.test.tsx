import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopTracesTable } from "@/components/agent-detail/top-traces-table";

// Tester-authored, independent verification of SDLCCT-110. Deliberately
// does NOT just re-check `push` was not called (that alone could pass even
// if a differently-broken implementation happened to never call `push` for
// unrelated reasons) -- instead spies directly on the native
// `Event.prototype.stopPropagation` to trace through that the copy
// button's click handler actually invokes it, which is the real mechanism
// `ClickableRow`'s React-level `onClick` prop relies on to not fire.
//
// Note on an earlier draft of this file: a first attempt here tried to
// prove non-bubbling by attaching a raw `addEventListener("click", ...)`
// directly on the <tr> DOM node and asserting it never fires. That failed
// even against this correct implementation -- not because of a bug, but
// because React 17+ delegates synthetic events from a single root
// listener; native bubbling reaches a listener attached directly on an
// *intermediate* DOM node (the <tr>, between the <button> target and
// React's root container) before React's own synthetic dispatch (and thus
// its internal stopPropagation) ever runs. `ClickableRow`'s onClick is a
// React prop, not a raw native listener, so that test's premise did not
// match this architecture -- it is removed in favor of the two checks
// below, which trace the mechanism that actually matters here.

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ key: "agent-1" }),
}));

afterEach(cleanup);

beforeEach(() => {
  push.mockClear();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function tracesWith(id: string) {
  return [{ id, total_estimated_cost: 42, metadata: null }] as unknown as Parameters<
    typeof TopTracesTable
  >[0]["traces"];
}

describe("SDLCCT-110 AC3 (tester): copy button click does not trigger row navigation", () => {
  it("clicking the copy button actually invokes the native event's stopPropagation (traced via a spy), and push is never called", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);

    const stopPropagationSpy = vi.spyOn(Event.prototype, "stopPropagation");

    const copyButton = screen.getByRole("button", { name: "複製完整 Trace ID" });
    fireEvent.click(copyButton);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(id);

    stopPropagationSpy.mockRestore();
  });

  it("control: clicking the row itself (not the button) does NOT call stopPropagation, and DOES navigate -- proves the spy only fires when the button's own handler runs it", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    render(<TopTracesTable traces={tracesWith(id)} />);

    const stopPropagationSpy = vi.spyOn(Event.prototype, "stopPropagation");

    const row = document.querySelector('tr[role="button"]') as HTMLElement;
    fireEvent.click(row);

    expect(stopPropagationSpy).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      `/agents/agent-1/traces/${encodeURIComponent(id)}`,
    );

    stopPropagationSpy.mockRestore();
  });
});

describe("SDLCCT-110 AC1/AC2 (tester): execution-time column renders independently per row, invalid rows don't affect siblings", () => {
  it("a mix of one valid and one invalid trace id in the same table renders the correct value for each row independently", () => {
    const ms = Date.UTC(2026, 11, 25, 3, 0, 0); // -> 2026/12/25 11:00 Asia/Taipei
    const hex12 = ms.toString(16).padStart(12, "0");
    const validId = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7000-8000-000000000000`;
    const invalidId = "not-a-real-trace-id-at-all-36-chars!";

    const traces = [
      { id: validId, total_estimated_cost: 10, metadata: null },
      { id: invalidId, total_estimated_cost: 20, metadata: null },
    ] as unknown as Parameters<typeof TopTracesTable>[0]["traces"];

    render(<TopTracesTable traces={traces} />);

    expect(screen.getByText("2026/12/25 11:00")).toBeInTheDocument();
    // Both rows' cost cells still render correctly regardless of trace-id
    // validity, confirming the invalid row's em dash is scoped to its own
    // time cell and doesn't poison the row or the table.
    expect(screen.getByText("US$ 10.00")).toBeInTheDocument();
    expect(screen.getByText("US$ 20.00")).toBeInTheDocument();
  });
});
