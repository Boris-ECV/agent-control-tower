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

  it("renders a boundary amount of exactly 0.5 with integer rounding (AC4 regression boundary)", () => {
    expect(formatCurrency(0.6)).toBe("US$ 1");
  });

  it("renders another small non-zero amount that rounds to zero with 2 decimals", () => {
    expect(formatCurrency(0.49)).toBe("US$ 0.49");
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
});
