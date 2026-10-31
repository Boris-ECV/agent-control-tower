import { describe, expect, it } from "vitest";
import {
  formatCardCurrency,
  formatPercentGrouped,
  formatTableCurrency,
} from "./format";

// SDLCCT-92 acceptance tests, mapped to the Gherkin scenarios:
//  1 table amount   -> "scenario 1: table currency"
//  2 small and zero -> "scenario 2: small values and zero"
//  3 card amount    -> "scenario 3: card currency"
//  4 percent        -> "scenario 4: grouped percent"
//  5 missing value  -> "scenario 5: missing values"
//  6 unit tests     -> this file itself
// Plus edge cases: negatives, large numbers, half rounding, NaN/Infinity,
// digits option, signed true/false.

describe("scenario 1: table currency", () => {
  it("formats 1234.5 as US$ 1,234.50", () => {
    expect(formatTableCurrency(1234.5)).toBe("US$ 1,234.50");
  });
  it("handles large numbers", () => {
    expect(formatTableCurrency(1234567.891)).toBe("US$ 1,234,567.89");
  });
  it("handles negatives", () => {
    expect(formatTableCurrency(-1234.5)).toBe("-US$ 1,234.50");
  });
  it("rounds half cases (exactly representable)", () => {
    expect(formatTableCurrency(0.125)).toBe("US$ 0.13");
    expect(formatTableCurrency(2.375)).toBe("US$ 2.38");
  });
});

describe("scenario 2: small values and zero", () => {
  it("zero", () => {
    expect(formatTableCurrency(0)).toBe("US$ 0.00");
  });
  it("0.02", () => {
    expect(formatTableCurrency(0.02)).toBe("US$ 0.02");
  });
  it("tiny negative rounding to zero has no minus sign", () => {
    expect(formatTableCurrency(-0.001)).toBe("US$ 0.00");
    expect(formatTableCurrency(-0)).toBe("US$ 0.00");
  });
});

describe("scenario 3: card currency", () => {
  it("1746.4 -> US$ 1,746", () => {
    expect(formatCardCurrency(1746.4)).toBe("US$ 1,746");
  });
  it("rounds half up and zero", () => {
    expect(formatCardCurrency(2.5)).toBe("US$ 3");
    expect(formatCardCurrency(0)).toBe("US$ 0");
  });
  it("large and negative", () => {
    expect(formatCardCurrency(1234567.891)).toBe("US$ 1,234,568");
    expect(formatCardCurrency(-1746.4)).toBe("-US$ 1,746");
    expect(formatCardCurrency(-0.4)).toBe("US$ 0");
  });
});

describe("scenario 4: grouped percent", () => {
  it("signed 1893.8 -> +1,893.8%", () => {
    expect(formatPercentGrouped(1893.8, { signed: true })).toBe("+1,893.8%");
  });
  it("unsigned positive has no plus (default and explicit false)", () => {
    expect(formatPercentGrouped(1893.8)).toBe("1,893.8%");
    expect(formatPercentGrouped(1893.8, { signed: false })).toBe("1,893.8%");
  });
  it("negatives keep minus regardless of signed", () => {
    expect(formatPercentGrouped(-1893.8)).toBe("-1,893.8%");
    expect(formatPercentGrouped(-1893.8, { signed: true })).toBe("-1,893.8%");
  });
  it("zero has no sign even when signed", () => {
    expect(formatPercentGrouped(0, { signed: true })).toBe("0.0%");
    expect(formatPercentGrouped(-0.01, { signed: true })).toBe("0.0%");
  });
  it("digits option", () => {
    expect(formatPercentGrouped(1893.84, { digits: 0 })).toBe("1,894%");
    expect(formatPercentGrouped(1893.8, { digits: 3 })).toBe("1,893.800%");
    expect(formatPercentGrouped(0.125, { digits: 2 })).toBe("0.13%");
  });
  it("large number", () => {
    expect(formatPercentGrouped(1234567.891, { signed: true })).toBe("+1,234,567.9%");
  });
});

describe("scenario 5: missing values", () => {
  it("null and undefined give an em dash for every function", () => {
    for (const v of [null, undefined]) {
      expect(formatTableCurrency(v)).toBe("—");
      expect(formatCardCurrency(v)).toBe("—");
      expect(formatPercentGrouped(v)).toBe("—");
      expect(formatPercentGrouped(v, { signed: true, digits: 2 })).toBe("—");
    }
  });
  it("NaN and Infinity give an em dash", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(formatTableCurrency(v)).toBe("—");
      expect(formatCardCurrency(v)).toBe("—");
      expect(formatPercentGrouped(v)).toBe("—");
    }
  });
});
