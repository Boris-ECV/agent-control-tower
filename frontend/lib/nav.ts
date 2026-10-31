/**
 * 判斷側邊選單項目是否為目前頁面（含其子路徑）。
 * - pathname 為 usePathname() 的值（不含 query／hash）；仍防禦性剝除 `?`／`#` 之後的字元。
 * - 尾端斜線視同無斜線（根路徑 "/" 除外）。
 * - href 為 "/"：僅 pathname 正規化後恰為 "/" 時 active（根項目不得吃掉所有頁面）。
 * - 其他 href：pathname === href，或 pathname 以 `${href}/` 開頭（段邊界比對）。
 * - pathname 為 null／空字串 -> false。
 */
function normalize(p: string): string {
  const base = p.split(/[?#]/, 1)[0];
  return base.length > 1 ? base.replace(/\/+$/, "") || "/" : base;
}

export function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const p = normalize(pathname);
  const h = normalize(href);
  if (h === "/") return p === "/";
  return p === h || p.startsWith(`${h}/`);
}
