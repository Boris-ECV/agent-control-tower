import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TraceSummaryRow } from "@/components/trace-detail/trace-summary-row";

afterEach(cleanup);

describe("TraceSummaryRow", () => {
  it("renders start time, duration, span count and cost when all values are present", () => {
    const { container } = render(
      <TraceSummaryRow
        startIso="2026-10-01T00:00:01Z"
        durationSeconds={7.2}
        spanCount={5}
        totalEstimatedCost={12.5}
      />,
    );
    expect(container.textContent).toContain("2026/10/01");
    expect(container.textContent).toContain("7.2s");
    expect(container.textContent).toContain("5");
    expect(container.textContent).toContain("US$");
  });

  it("falls back to em dash for start time and duration when spans are empty, but keeps span count 0 and cost's own value", () => {
    const { container } = render(
      <TraceSummaryRow
        startIso={null}
        durationSeconds={null}
        spanCount={0}
        totalEstimatedCost={42}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toContain("0");
    expect(text).toContain("US$");
  });
});
