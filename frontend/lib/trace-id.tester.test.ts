import { describe, expect, it } from "vitest";

import { parseTraceStartTime, truncateTraceId } from "@/lib/trace-id";

// Tester-authored, independent verification of SDLCCT-110's acceptance
// criteria against the pure functions, written without reading the
// developer's own trace-id.test.ts assertions first. Deliberately uses a
// different timestamp / id fixture than the developer's tests so this is
// not just a byte-for-byte restatement of the same check.

describe("SDLCCT-110 AC1 (tester): parseTraceStartTime on a legal UUIDv7", () => {
  it("recovers the exact embedded millisecond timestamp for a known date", () => {
    // 2027-03-02T01:15:00.000Z, independently computed via Date.UTC rather
    // than copied from any existing fixture.
    const ms = Date.UTC(2027, 2, 2, 1, 15, 0);
    const hex12 = ms.toString(16).padStart(12, "0");
    const id = `${hex12.slice(0, 8)}-${hex12.slice(8, 12)}-7abc-9def-0123456789ab`;
    const parsed = parseTraceStartTime(id);
    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(ms);
  });
});

describe("SDLCCT-110 AC2 (tester): parseTraceStartTime rejects non-legal-UUIDv7 inputs", () => {
  it.each([
    ["empty string", ""],
    ["short id (e2e fixture style)", "trace-042"],
    ["36 chars but wrong dash shape", "0199abcdef01-7234-8abc-def0123456789"],
    ["36 hex-shaped chars but version nibble is 4 (a v4 UUID)", "0199abcd-ef01-4234-8abc-def012345678"],
    ["36 hex-shaped chars but version nibble is 1", "0199abcd-ef01-1234-8abc-def012345678"],
    ["37 chars (one char too many)", "0199abcd-ef01-7234-8abc-def0123456789"],
    ["contains a non-hex character in an otherwise valid shape", "0199abcg-ef01-7234-8abc-def012345678"],
  ])("returns null for %s", (_label, input) => {
    expect(parseTraceStartTime(input)).toBeNull();
  });
});

describe("SDLCCT-110 AC3 (tester): truncateTraceId", () => {
  it("truncates a full 36-char trace id to front-8…last-4, preserving the exact original characters at each end", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    const result = truncateTraceId(id);
    expect(result).toBe("abcdef12…7890");
    // Confirms the function is reading from the real start/end of the
    // original string, not just producing the right-shaped output by
    // coincidence of this particular fixture.
    expect(result.startsWith(id.slice(0, 8))).toBe(true);
    expect(result.endsWith(id.slice(-4))).toBe(true);
  });

  it("does not truncate strings at or under the 12-char boundary (boundary re-check independent of dev's own fixture)", () => {
    expect(truncateTraceId("abc")).toBe("abc");
    expect(truncateTraceId("123456789012")).toBe("123456789012"); // exactly 12
  });
});
