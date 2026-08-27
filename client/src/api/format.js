/* Display helpers — kept identical to the original build so numbers read the same. */

export const money = (n, cur = "USD") => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sym = { USD: "$", EUR: "€", GBP: "£", INR: "₹" }[cur] || (cur ? cur + " " : "$");
  const v = Number(n);
  return (v < 0 ? "-" : "") + sym + Math.abs(v).toLocaleString("en-US");
};

export const pct = (n) => (!isFinite(n) || isNaN(n) ? "—" : Math.round(n * 10) / 10 + "%");

export const curMonthStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};

export const monthLabel = (m) => {
  if (!m || !/^\d{4}-\d{2}/.test(m)) return m || "—";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export const monthShort = (m) => {
  if (!m || !/^\d{4}-\d{2}/.test(m)) return m || "—";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

export const addMonths = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};

export const daysInMonthOf = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return 30;
  return new Date(y, mo, 0).getDate();
};

export const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

export const dateLabel = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

/** Every vertical an account holds — never just the primary one. */
export function vertsOf(u) {
  if (!u) return [];
  let vs = [];
  if (Array.isArray(u.verticals)) vs = u.verticals;
  else if (typeof u.verticals === "string" && u.verticals) {
    try { vs = JSON.parse(u.verticals); } catch (e) { vs = []; }
  }
  if (!Array.isArray(vs)) vs = [];
  vs = vs.filter(Boolean);
  if (!vs.length && u.vertical) vs = [u.vertical];
  return vs;
}

/* rate colouring, shared by the cards and the collection bars */
export const statusClass = (p) => (isNaN(p) ? "n" : p >= 90 ? "g" : p >= 70 ? "a" : "r");
export const barColor = (p) => (isNaN(p) ? "var(--muted)" : p >= 90 ? "var(--green)" : p >= 70 ? "var(--amber)" : "var(--red)");
