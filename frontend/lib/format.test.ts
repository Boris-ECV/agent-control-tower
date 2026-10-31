import { describe, expect, it } from "vitest";

import {
  formatCardCurrency,
  formatCurrency,
  formatDayColumnHeader,
  formatPercent,
  formatPercentGrouped,
  formatSignedCurrency,
  formatSlashDate,
  formatSlashDateTime,
  formatTableCurrency,
} from "@/lib/format";

describe("formatTableCurrency", () => {
  it("renders two decimals with grouping (1234.5)", () => {
    expect(formatTableCurrency(1234.5)).toBe("US$ 1,234.50");
  });
  it("renders zero as US$ 0.00", () => {
    expect(formatTableCurrency(0)).toBe("US$ 0.00");
  });
  it("renders small amount 0.02", () => {
    expect(formatTableCurrency(0.02)).toBe("US$ 0.02");
  });
  it("rounds up keeping two decimals", () => {
    expect(formatTableCurrency(99.999)).toBe("US$ 100.00");
  });
  it("groups multiple thousands", () => {
    expect(formatTableCurrency(1234567.891)).toBe("US$ 1,234,567.89");
  });
  it("places minus before US$ for negatives", () => {
    expect(formatTableCurrency(-1234.5)).toBe("-US$ 1,234.50");
  });
  it("drops sign when rounded value is zero", () => {
    expect(formatTableCurrency(-0.004)).toBe("US$ 0.00");
    expect(formatTableCurrency(-0)).toBe("US$ 0.00");
  });
  it("renders null/undefined as em dash", () => {
    expect(formatTableCurrency(null)).toBe("—");
    expect(formatTableCurrency(undefined)).toBe("—");
  });
  it("renders non-finite as em dash", () => {
    expect(formatTableCurrency(NaN)).toBe("—");
    expect(formatTableCurrency(Infinity)).toBe("—");
    expect(formatTableCurrency(-Infinity)).toBe("—");
  });
});

describe("formatCardCurrency", () => {
  it("rounds to integer (1746.4)", () => {
    expect(formatCardCurrency(1746.4)).toBe("US$ 1,746");
  });
  it("rounds half away from zero", () => {
    expect(formatCardCurrency(1746.5)).toBe("US$ 1,747");
  });
  it("renders zero and 0.4 as US$ 0", () => {
    expect(formatCardCurrency(0)).toBe("US$ 0");
    expect(formatCardCurrency(0.4)).toBe("US$ 0");
  });
  it("groups large values", () => {
    expect(formatCardCurrency(1234567.8)).toBe("US$ 1,234,568");
  });
  it("handles negatives", () => {
    expect(formatCardCurrency(-1746.4)).toBe("-US$ 1,746");
    expect(formatCardCurrency(-0.4)).toBe("US$ 0");
  });
  it("renders null/undefined as em dash", () => {
    expect(formatCardCurrency(null)).toBe("—");
    expect(formatCardCurrency(undefined)).toBe("—");
  });
  it("renders non-finite as em dash", () => {
    expect(formatCardCurrency(NaN)).toBe("—");
    expect(formatCardCurrency(Infinity)).toBe("—");
  });
});

describe("formatPercentGrouped", () => {
  it("signed positive with grouping", () => {
    expect(formatPercentGrouped(1893.8, { signed: true })).toBe("+1,893.8%");
  });
  it("unsigned positive with grouping", () => {
    expect(formatPercentGrouped(1893.8)).toBe("1,893.8%");
  });
  it("keeps minus for negatives with or without signed", () => {
    expect(formatPercentGrouped(-12.34, { signed: true })).toBe("-12.3%");
    expect(formatPercentGrouped(-12.34)).toBe("-12.3%");
  });
  it("zero and rounded-to-zero carry no sign", () => {
    expect(formatPercentGrouped(0, { signed: true })).toBe("0.0%");
    expect(formatPercentGrouped(0.04, { signed: true })).toBe("0.0%");
  });
  it("honours digits option", () => {
    expect(formatPercentGrouped(12.5, { digits: 0, signed: true })).toBe("+13%");
  });
  it("groups large values", () => {
    expect(formatPercentGrouped(1234567.8, { digits: 1 })).toBe("1,234,567.8%");
  });
  it("renders null/undefined as em dash", () => {
    expect(formatPercentGrouped(null)).toBe("—");
    expect(formatPercentGrouped(undefined, { signed: true })).toBe("—");
  });
  it("renders non-finite as em dash", () => {
    expect(formatPercentGrouped(NaN)).toBe("—");
    expect(formatPercentGrouped(Infinity)).toBe("—");
  });
});

describe("legacy outputs unchanged", () => {
  it("formatPercent has no grouping and no sign", () => {
    expect(formatPercent(12.34)).toBe("12.3%");
    expect(formatPercent(1893.8)).toBe("1893.8%");
  });
});

describe("formatCurrency", () => {
  it("renders a non-zero small amount that would round to zero with 2 decimals (AC1)", () => {
    expect(formatCurrency(0.02)).toBe("US$ 0.02");
  });

  it("renders a true zero amount as US$ 0 (AC2)", () => {
    expect(formatCurrency(0)).toBe("US$ 0");
  });

  it("renders null as em dash (AC3)", () => {
    expect(formatCurrency(null)).toBe("—");
  });

  it("renders undefined as em dash (AC3)", () => {
    expect(formatCurrency(undefined)).toBe("—");
  });

  it("renders a regular amount >= 0.5 with integer rounding and thousands grouping (AC4)", () => {
    expect(formatCurrency(1234.4)).toBe("US$ 1,234");
  });

  it("renders 0.6 with 2-decimal precision now that it falls under the US$100 threshold (SDLCCT-71)", () => {
    expect(formatCurrency(0.6)).toBe("US$ 0.60");
  });

  it("renders another small non-zero amount that rounds to zero with 2 decimals", () => {
    expect(formatCurrency(0.49)).toBe("US$ 0.49");
  });

  it("renders 1.8 with 2 decimals (SDLCCT-71 scenario 2)", () => {
    expect(formatCurrency(1.8)).toBe("US$ 1.80");
  });

  it("renders 2.3 with 2 decimals (SDLCCT-71 scenario 1)", () => {
    expect(formatCurrency(2.3)).toBe("US$ 2.30");
  });

  it("renders 99.99 with 2 decimals, just under the US$100 threshold (SDLCCT-71 scenario 5)", () => {
    expect(formatCurrency(99.99)).toBe("US$ 99.99");
  });

  it("renders 100.4 with integer rounding, at/above the US$100 threshold (SDLCCT-71 scenario 6)", () => {
    expect(formatCurrency(100.4)).toBe("US$ 100");
  });
});

describe("formatSignedCurrency", () => {
  it("renders a positive non-zero small amount with sign and 2 decimals", () => {
    expect(formatSignedCurrency(0.02)).toBe("+US$ 0.02");
  });

  it("renders a negative non-zero small amount with sign and 2 decimals", () => {
    expect(formatSignedCurrency(-0.02)).toBe("-US$ 0.02");
  });

  it("renders a true zero amount as US$ 0 with no sign", () => {
    expect(formatSignedCurrency(0)).toBe("US$ 0");
  });

  it("renders null as em dash", () => {
    expect(formatSignedCurrency(null)).toBe("—");
  });

  it("renders undefined as em dash", () => {
    expect(formatSignedCurrency(undefined)).toBe("—");
  });

  it("renders a regular positive amount with integer rounding and thousands grouping", () => {
    expect(formatSignedCurrency(1234.4)).toBe("+US$ 1,234");
  });

  it("renders a regular negative amount with integer rounding and thousands grouping", () => {
    expect(formatSignedCurrency(-1234.4)).toBe("-US$ 1,234");
  });

  it("renders 2.3 with sign and 2 decimals (SDLCCT-71 scenario 10)", () => {
    expect(formatSignedCurrency(2.3)).toBe("+US$ 2.30");
  });

  it("renders -2.3 with sign and 2 decimals (SDLCCT-71 scenario 11)", () => {
    expect(formatSignedCurrency(-2.3)).toBe("-US$ 2.30");
  });

  it("renders 1234.4 with sign, integer rounding and thousands grouping (SDLCCT-71 scenario 12)", () => {
    expect(formatSignedCurrency(1234.4)).toBe("+US$ 1,234");
  });
});

describe("formatSlashDate", () => {
  it("formats 2026-10-06 as 2026/10/06", () => {
    expect(formatSlashDate("2026-10-06")).toBe("2026/10/06");
  });
  it("keeps zero padding at year/month boundaries", () => {
    expect(formatSlashDate("2026-01-01")).toBe("2026/01/01");
    expect(formatSlashDate("2026-12-31")).toBe("2026/12/31");
  });
  it("handles leap day", () => {
    expect(formatSlashDate("2024-02-29")).toBe("2024/02/29");
  });
  it.each([null, undefined, ""])("renders %j as em dash", (v) => {
    expect(formatSlashDate(v)).toBe("—");
  });
  it.each(["abc", "2026-02-30", "2026-13-01", "2026-10-06T00:00:00Z"])(
    "renders invalid %j as em dash",
    (v) => {
      expect(formatSlashDate(v)).toBe("—");
    },
  );
});

describe("formatSlashDateTime", () => {
  it.each([
    ["2026-10-06T09:18:13Z", "2026/10/06 17:18:13"],
    ["2026-10-06T16:30:00Z", "2026/10/07 00:30:00"],
    ["2026-10-06T16:00:00Z", "2026/10/07 00:00:00"],
    ["2026-12-31T16:00:01Z", "2027/01/01 00:00:01"],
    ["2026-10-06T15:59:59Z", "2026/10/06 23:59:59"],
    ["2026-10-06T17:18:13+08:00", "2026/10/06 17:18:13"],
  ])("formats %s as %s (Asia/Taipei)", (input, expected) => {
    expect(formatSlashDateTime(input)).toBe(expected);
  });
  it.each([null, undefined, ""])("renders %j as em dash", (v) => {
    expect(formatSlashDateTime(v)).toBe("—");
  });
  it("renders an invalid date as em dash", () => {
    expect(formatSlashDateTime("not-a-date")).toBe("—");
  });
  it.each(["2026-02-30", "2026-02-30T10:00:00Z", "2026-13-01T00:00:00Z"])(
    "renders non-existent calendar date %s as em dash",
    (v) => {
      expect(formatSlashDateTime(v)).toBe("—");
    },
  );
  it("accepts a leap day", () => {
    expect(formatSlashDateTime("2024-02-29T00:00:00Z")).toBe("2024/02/29 08:00:00");
  });
});

describe("formatDayColumnHeader", () => {
  it("formats 2026-10-09 as 10/9 (五)", () => {
    expect(formatDayColumnHeader("2026-10-09")).toBe("10/9 (五)");
  });
  it.each([
    ["2026-10-04", "10/4 (日)"],
    ["2026-10-05", "10/5 (一)"],
    ["2026-10-06", "10/6 (二)"],
    ["2026-10-07", "10/7 (三)"],
    ["2026-10-08", "10/8 (四)"],
    ["2026-10-09", "10/9 (五)"],
    ["2026-10-10", "10/10 (六)"],
  ])("renders every weekday: %s -> %s", (input, expected) => {
    expect(formatDayColumnHeader(input)).toBe(expected);
  });
  it("does not zero-pad month/day", () => {
    expect(formatDayColumnHeader("2026-01-05")).toBe("1/5 (一)");
    expect(formatDayColumnHeader("2026-12-31")).toBe("12/31 (四)");
  });
  it("handles month and year boundaries", () => {
    expect(formatDayColumnHeader("2026-11-01")).toBe("11/1 (日)");
    expect(formatDayColumnHeader("2027-01-01")).toBe("1/1 (五)");
  });
  it.each([null, undefined, ""])("renders %j as em dash", (v) => {
    expect(formatDayColumnHeader(v)).toBe("—");
  });
  it.each(["2026-02-30", "abc"])("renders invalid %j as em dash", (v) => {
    expect(formatDayColumnHeader(v)).toBe("—");
  });
});
