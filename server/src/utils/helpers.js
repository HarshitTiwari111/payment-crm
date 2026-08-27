/* Small pure helpers shared across services and routes. */

/** Money rounding — 2 decimals, always a number. */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Vertical names are compared case- and space-insensitively everywhere.
 * A row saved as "Pay per call" must not hide from a filter sending "Pay Per Call".
 */
function normVert(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Days in a YYYY-MM month. */
function daysInMonthOf(m) {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return 30;
  return new Date(y, mo, 0).getDate();
}

/** The YYYY-MM before the given one. */
function prevMonthOf(month) {
  const [y, m] = String(month).split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/** Add `n` months to a YYYY-MM. */
function addMonths(month, n) {
  const [y, m] = String(month).split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/** YYYY-MM-DD for a Date (local, not UTC — the app thinks in local business days). */
function toISODate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

/** Today as YYYY-MM-DD. */
function today() {
  return toISODate(new Date());
}

/** The YYYY-MM a YYYY-MM-DD falls in. */
function monthOfDate(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

/**
 * Split [from,to] (YYYY-MM-DD) into per-month chunks: { month, d1, d2, dim }.
 * Days are 1-indexed and both ends are inclusive. Returns [] on a bad range.
 */
function rangeSegments(from, to) {
  const out = [];
  const F = String(from || "").split("-").map(Number);
  const T = String(to || "").split("-").map(Number);
  if (F.length !== 3 || T.length !== 3 || !F[0] || !F[1] || !T[0] || !T[1]) return out;
  if (F[0] > T[0] || (F[0] === T[0] && F[1] > T[1])) return out;
  let y = F[0], m = F[1];
  for (let guard = 0; guard < 240; guard++) {
    const mo = y + "-" + String(m).padStart(2, "0");
    const dim = daysInMonthOf(mo);
    const d1 = (y === F[0] && m === F[1]) ? Math.min(dim, Math.max(1, F[2] || 1)) : 1;
    const d2 = (y === T[0] && m === T[1]) ? Math.min(dim, Math.max(1, T[2] || dim)) : dim;
    if (d1 <= d2) out.push({ month: mo, d1, d2, dim });
    if (y === T[0] && m === T[1]) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The whole month as a single segment. */
function fullMonthSegment(mo) {
  const dim = daysInMonthOf(mo);
  return [{ month: mo, d1: 1, d2: dim, dim }];
}

/** Read a value that may be a JSON array, a single string, or already an array. */
function asArray(val) {
  if (val == null || val === "") return [];
  if (Array.isArray(val)) return val;
  try {
    const p = JSON.parse(val);
    if (Array.isArray(p)) return p;
    if (p == null) return [];
    return [String(p)];
  } catch (e) {
    return [String(val)];
  }
}

/** Escape a string for use inside a RegExp — vertical names are looked up case-insensitively. */
function escapeRegex(str) {
  return String(str == null ? "" : str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  round2, normVert, daysInMonthOf, prevMonthOf, addMonths,
  toISODate, today, monthOfDate, rangeSegments, fullMonthSegment,
  asArray, escapeRegex,
};
