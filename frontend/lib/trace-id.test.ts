import { describe, expect, it } from "vitest";

import { parseTraceStartTime, truncateTraceId } from "@/lib/trace-id";

describe("parseTraceStartTime", () => {
  it("parses a valid UUIDv7's embedded millisecond timestamp", () => {
    // 0x0199... encodes 2026-10-15T06:30:00.000Z -- construct directly from
    // the known millisecond value to avoid a second, independently-wrong
    // hand-computed hex literal.
    const ms = Date.UTC(2026, 9, 15, 6, 30, 0); // month is 0-indexed
    const hex12 = ms.toString(16).padStart(12, "0");
    const id = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7${"0".repeat(3)}-8${"0".repeat(3)}-${"0".repeat(12)}`;
    const date = parseTraceStartTime(id);
    expect(date).not.toBeNull();
    expect(date?.getTime()).toBe(ms);
  });

  it("returns null for a string that is not 36 chars long", () => {
    expect(parseTraceStartTime("trace-001")).toBeNull();
    expect(parseTraceStartTime("0199abcd-ef01-7234-8abc-def012345678extra")).toBeNull();
  });

  it("returns null for a 36-char string with non-hex characters", () => {
    expect(parseTraceStartTime("zzzzzzzz-ef01-7234-8abc-def012345678")).toBeNull();
  });

  it("returns null when the dash positions don't match UUID shape", () => {
    expect(parseTraceStartTime("0199abcdef01-7234-8abc-def0123456789")).toBeNull();
  });

  it("returns null when the version nibble is not 7 (e.g. a v4 UUID)", () => {
    expect(parseTraceStartTime("0199abcd-ef01-4234-8abc-def012345678")).toBeNull();
  });

  it("is case-insensitive for hex digits", () => {
    const ms = Date.UTC(2026, 0, 1, 0, 0, 0);
    const hex12 = ms.toString(16).padStart(12, "0").toUpperCase();
    const id = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7000-8000-000000000000`;
    expect(parseTraceStartTime(id)?.getTime()).toBe(ms);
  });
});

describe("truncateTraceId", () => {
  it("truncates a 36-char UUID to 前8碼…後4碼", () => {
    const id = "0199abcd-ef01-7234-8abc-def012345678";
    expect(truncateTraceId(id)).toBe("0199abcd…5678");
  });

  it("does not truncate short strings (length <= 12), e.g. existing e2e fixtures", () => {
    expect(truncateTraceId("trace-001")).toBe("trace-001");
    expect(truncateTraceId("trace-002")).toBe("trace-002");
  });

  it("does not truncate a string of exactly 12 chars", () => {
    const id = "123456789012";
    expect(truncateTraceId(id)).toBe(id);
  });

  it("truncates a string of 13 chars", () => {
    const id = "1234567890123";
    expect(truncateTraceId(id)).toBe("12345678…0123");
  });
});
