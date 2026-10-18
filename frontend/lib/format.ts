// Presentation-layer formatting helpers. Taiwan-time conversion happens
// here, never in bff (docs/design/SDLCCT-32.md "台灣時間換算在前端/展示層"
// decision) -- bff returns plain UTC date strings (YYYY-MM-DD).

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `NT$ ${Math.round(value).toLocaleString("zh-TW")}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}NT$ ${Math.round(Math.abs(value)).toLocaleString("zh-TW")}`;
}

/** Convert a bff UTC date string (YYYY-MM-DD, anchor.get_anchor_date()'s
 * UTC-midnight convention) to a Taiwan-time (UTC+8) display string. A plain
 * UTC-midnight date is always the same calendar day in UTC+8 as well (no
 * day ever rolls over), so this is a straightforward display-format
 * conversion, not a timezone-crossing recalculation. */
export function formatTaiwanDate(isoDate: string): string {
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(utcMidnight);
}

export function formatDateRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(startIso)}–${fmt(endIso)}`;
}
