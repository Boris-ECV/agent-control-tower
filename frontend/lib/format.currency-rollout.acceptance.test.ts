import { describe, expect, it } from "vitest";
import { formatSignedTableCurrency } from "./format";

// SDLCCT-94 acceptance: signed table currency (period comparison delta).
describe("formatSignedTableCurrency edge cases", () => {
  it.each([
    [250, "+US$ 250.00"],
    [-1234.567, "-US$ 1,234.57"],
    [1e6, "+US$ 1,000,000.00"],
    [0, "US$ 0.00"],
    [-0, "US$ 0.00"],
    [0.004, "US$ 0.00"],
    [-0.004, "US$ 0.00"],
    [0.005, "+US$ 0.01"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatSignedTableCurrency(input)).toBe(expected);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    "returns an em dash for %s",
    (input) => {
      expect(formatSignedTableCurrency(input as number | null | undefined)).toBe("—");
    },
  );

  it("never emits a negative zero or a bare plus sign", () => {
    for (const v of [0, -0, 0.004, -0.004]) {
      const out = formatSignedTableCurrency(v);
      expect(out).not.toMatch(/^[+-]/);
    }
  });
});
