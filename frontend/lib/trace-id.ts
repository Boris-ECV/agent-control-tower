// Trace ID 展示層純函式（docs/design/SDLCCT-110.md 決策 1-3）：解析 UUIDv7
// 編碼的執行開始時間，以及截斷長字串供表格顯示。純函式，無元件相依，與
// `lib/format.ts`（數字/日期格式化）同屬展示層分類但職責不同，故獨立成檔。

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a UUIDv7 trace id's embedded 48-bit millisecond timestamp into a
 * `Date`. Strictly requires: exactly 36 chars, standard UUID dash shape, and
 * the version nibble (first char of the third group) equal to "7" -- all
 * three are required for "a legal UUIDv7", not just length/hex shape,
 * otherwise a syntactically valid but non-v7 UUID would have its random bits
 * misread as a timestamp (worse than showing an em dash; see design doc
 * decision 2). Returns `null` for anything that fails validation, or for the
 * (not expected to happen in practice) defensive case where the computed
 * timestamp itself is an Invalid Date. */
export function parseTraceStartTime(traceId: string): Date | null {
  if (traceId.length !== 36) return null;
  if (!UUID_SHAPE.test(traceId)) return null;
  const versionNibble = traceId[14];
  if (versionNibble !== "7") return null;

  const hex12 = traceId.replace(/-/g, "").slice(0, 12);
  const ms = parseInt(hex12, 16);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Truncate a long trace id to "前8碼…後4碼" for table display. Only
 * truncates when `traceId.length > 12` -- short ids (e.g. existing e2e
 * fixtures like "trace-001") are returned unchanged, since truncating them
 * would produce output longer than (or no shorter than) the original
 * string, with no visual benefit (design doc decision 3). */
export function truncateTraceId(traceId: string): string {
  if (traceId.length <= 12) return traceId;
  return `${traceId.slice(0, 8)}…${traceId.slice(-4)}`;
}
