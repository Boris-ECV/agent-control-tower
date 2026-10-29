import { describe, expect, it } from "vitest";

import { formatCurrency, formatSignedCurrency } from "@/lib/format";

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
