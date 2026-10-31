import { describe, expect, it } from "vitest";
import {
  formatDayColumnHeader,
  formatSlashDate,
  formatSlashDateTime,
} from "./format";

// SDLCCT-93 acceptance tests, mapped to the Gherkin scenarios:
//  1 date            -> "scenario 1: slash date"
//  2 datetime        -> "scenario 2: slash datetime (Asia/Taipei)"
//  3 day column head -> "scenario 3: day column header"
//  4 missing value   -> "scenario 4: missing and invalid values"
//  5 unit tests      -> this file itself
// Edge cases: no day shift for date-only, tz boundaries, midnight, year
// rollover, offset input, all 7 weekdays (2026-10-04 is a Sunday).

describe("scenario 1: slash date", () => {
  it("formats 2026-10-06", () => {
    expect(formatSlashDate("2026-10-06")).toBe("2026/10/06");
  });
  it.each([
    ["2026-01-01", "2026/01/01"],
    ["2026-12-31", "2026/12/31"],
    ["2024-02-29", "2024/02/29"],
  ])("does not shift day for %s", (input, expected) => {
    expect(formatSlashDate(input)).toBe(expected);
  });
});

describe("scenario 2: slash datetime (Asia/Taipei)", () => {
  it.each([
    ["2026-10-06T09:18:13Z", "2026/10/06 17:18:13"],
    ["2026-10-06T16:30:00Z", "2026/10/07 00:30:00"],
    ["2026-10-06T16:00:00Z", "2026/10/07 00:00:00"],
    ["2026-12-31T16:00:00Z", "2027/01/01 00:00:00"],
    ["2026-10-06T17:18:13+08:00", "2026/10/06 17:18:13"],
  ])("formats %s", (input, expected) => {
    expect(formatSlashDateTime(input)).toBe(expected);
  });
  it("never renders 24:00:00 at midnight", () => {
    expect(formatSlashDateTime("2026-10-06T16:00:00Z")).not.toContain("24:");
  });
});

describe("scenario 3: day column header", () => {
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
  ])("weekday for %s", (input, expected) => {
    expect(formatDayColumnHeader(input)).toBe(expected);
  });
  it("does not zero-pad month or day", () => {
    expect(formatDayColumnHeader("2026-01-02")).toBe("1/2 (五)");
  });
});

describe("scenario 4: missing and invalid values", () => {
  const fns = [formatSlashDate, formatSlashDateTime, formatDayColumnHeader];
  it.each([null, undefined, "", "abc", "2026-02-30"])(
    "returns em dash for %j in all functions",
    (input) => {
      for (const fn of fns) expect(fn(input)).toBe("—");
    },
  );
});
