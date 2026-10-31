// Presentation-layer formatting helpers. Taiwan-time conversion happens
// here, never in bff (docs/design/SDLCCT-32.md "台灣時間換算在前端/展示層"
// decision) -- bff returns plain UTC date strings (YYYY-MM-DD).

function groupedAbs(abs: number, digits: number): string {
  return abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** True when the value rounds to zero at the given number of decimals. */
function roundsToZero(value: number, digits: number): boolean {
  return Number(groupedAbs(Math.abs(value), digits).replace(/,/g, "")) === 0;
}

function formatMoney(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const neg = value < 0 && !roundsToZero(value, digits);
  return `${neg ? "-" : ""}US$ ${groupedAbs(Math.abs(value), digits)}`;
}

/** Table money: always two decimals, thousands separators.
 * 1234.5 -> "US$ 1,234.50", 0 -> "US$ 0.00". */
export function formatTableCurrency(value: number | null | undefined): string {
  return formatMoney(value, 2);
}

/** Summary-card money: rounded to an integer, thousands separators.
 * 1746.4 -> "US$ 1,746". */
export function formatCardCurrency(value: number | null | undefined): string {
  return formatMoney(value, 0);
}

/** Percent with thousands separators; `signed` adds "+" for positive values.
 * 1893.8 + signed -> "+1,893.8%". Negative values always keep "-". */
export function formatPercentGrouped(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const { digits = 1, signed = false } = options;
  const zero = roundsToZero(value, digits);
  const sign = zero ? "" : value < 0 ? "-" : signed ? "+" : "";
  return `${sign}${groupedAbs(Math.abs(value), digits)}%`;
}

/** @deprecated Use formatTableCurrency / formatCardCurrency. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) < 100 && value !== 0) {
    return `US$ ${value.toLocaleString("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `US$ ${Math.round(value).toLocaleString("zh-TW")}`;
}

/** @deprecated Use formatPercentGrouped. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 100 && abs !== 0) {
    return `${sign}US$ ${abs.toLocaleString("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${sign}US$ ${Math.round(abs).toLocaleString("zh-TW")}`;
}

/** Convert a bff UTC date string (YYYY-MM-DD, anchor.get_anchor_date()'s
 * UTC-midnight convention) to a Taiwan-time (UTC+8) display string. A plain
 * UTC-midnight date is always the same calendar day in UTC+8 as well (no
 * day ever rolls over), so this is a straightforward display-format
 * conversion, not a timezone-crossing recalculation. */
/** @deprecated Use formatSlashDate. */
export function formatTaiwanDate(isoDate: string): string {
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(utcMidnight);
}

/** Sister function to formatTaiwanDate for span start_time/end_time, which
 * are full ISO datetime strings (e.g. "2026-10-01T00:00:01Z"), not plain
 * YYYY-MM-DD dates -- formatTaiwanDate's `${isoDate}T00:00:00Z` construction
 * would malform them. null/missing renders as "—" (docs/design/SDLCCT-56.md
 * decision 5), matching formatCurrency/formatPercent's "missing value is an
 * em dash, never 0 or blank" convention. */
/** @deprecated Use formatSlashDateTime. */
export function formatTaiwanDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDateRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(startIso)}–${fmt(endIso)}`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** Parse a plain YYYY-MM-DD calendar date (no timezone conversion).
 * Returns null for missing, malformed or non-existent dates. */
function parseCalendarDate(
  isoDate: string | null | undefined,
): { y: number; m: number; d: number; weekday: number } | null {
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d, weekday: date.getUTCDay() };
}

/** Plain date: "2026-10-06" -> "2026/10/06". Missing/invalid -> "—". */
export function formatSlashDate(isoDate: string | null | undefined): string {
  if (!parseCalendarDate(isoDate)) return "—";
  return (isoDate as string).replace(/-/g, "/");
}

/** Datetime in Asia/Taipei, 24-hour:
 * "2026-10-06T09:18:13Z" -> "2026/10/06 17:18:13". Missing/invalid -> "—". */
export function formatSlashDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    (parts.find((p) => p.type === type)?.value ?? "").padStart(2, "0");
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${year}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Daily column header: "2026-10-09" -> "10/9 (五)". Missing/invalid -> "—". */
export function formatDayColumnHeader(isoDate: string | null | undefined): string {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) return "—";
  return `${parsed.m}/${parsed.d} (${WEEKDAYS[parsed.weekday]})`;
}
