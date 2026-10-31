import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnomalyTable, formatAnomalyDate } from "@/components/anomalies/anomaly-table";
import type { AnomalyRow } from "@/lib/anomalies-api";

afterEach(cleanup);

const row: AnomalyRow = {
  agent: "agent-1",
  anomaly_type: "model_switch",
  date: "2026-10-18",
  reason: "r",
  status: "open",
};

describe("formatAnomalyDate (SDLCCT-95)", () => {
  it("formats a date as YYYY/MM/DD", () => {
    expect(formatAnomalyDate("2026-10-18")).toBe("2026/10/18");
  });

  it("keeps the ongoing label for null", () => {
    expect(formatAnomalyDate(null)).toBe("持續中");
  });
});

describe("AnomalyTable dates (SDLCCT-95)", () => {
  it("shows the slash date in both the table and the mobile card list", () => {
    const { container } = render(<AnomalyTable rows={[row]} />);
    expect(container.querySelector("table tbody")?.textContent).toContain("2026/10/18");
    expect(container.querySelector("ul")?.textContent).toContain("2026/10/18");
    expect(container.textContent).not.toContain("2026年");
  });
});
