/*
 * Reporting side of the payments module: the KPI numbers, the per-network and
 * per-vertical breakdowns, the calendar, and the figures Company View needs to
 * show booked profit next to realized profit.
 *
 * TWO WAYS TO ASK THE SAME QUESTION, and they answer different things:
 *
 *   by EARNED month  — "of what we earned in August, how much has actually landed?"
 *                      Groups on payout.earnedMonth. This is the one Company View
 *                      uses, because August's cash has to be compared against
 *                      August's ad spend for realized profit to mean anything.
 *
 *   by RECEIVED month — "how much cash came in during October, from whom?"
 *                      Groups on the transaction date. This is the cash-flow view,
 *                      and October's total will include money earned in July,
 *                      August and September.
 */
const Payout = require("../models/Payout");
const PayoutTxn = require("../models/PayoutTxn");
const { round2, normVert, today, monthOfDate, addMonths } = require("../utils/helpers");
const { pendingOf, isOverdue } = require("./payouts");

/*
 * Scope, as every function in this file receives it.
 *
 * It arrives either as the bare set of allowed verticals — null for an admin,
 * meaning no restriction — or as { verticals, subcategory } when the caller is also
 * narrowing to what the header is pointed at. Only the two helpers below ever look
 * inside it; the twelve functions under them pass it straight through, which is why
 * the shape could grow at all without touching any of them.
 */
function scopeOf(scope) {
  if (scope && typeof scope === "object" && !(scope instanceof Set)) {
    return { verticals: scope.verticals || null, subcategory: scope.subcategory || "" };
  }
  return { verticals: scope || null, subcategory: "" };
}

/** Restrict a payout query to a set of verticals (null = admin, no restriction). */
function verticalFilter(scope) {
  const { verticals } = scopeOf(scope);
  if (!verticals) return {};
  return { $expr: { $in: [{ $toLower: { $trim: { input: "$vertical" } } }, [...verticals]] } };
}

/** Apply a scope in JS — simpler and safe for the row counts here. */
function inScope(p, scope) {
  const { verticals, subcategory } = scopeOf(scope);
  if (verticals && !verticals.has(normVert(p.vertical))) return false;
  /*
   * A sub-vertical filter excludes payouts that have none. They predate the field
   * and belong to no sub-vertical, so counting them under whichever one is selected
   * would inflate that one's totals with money that was never attributed to it.
   */
  if (subcategory && normVert(p.subcategory) !== normVert(subcategory)) return false;
  return true;
}

/**
 * Everything owed / received / lost for one earned month.
 * Returns company totals plus breakdowns by network and by vertical.
 */
async function byEarnedMonth(month, allowedSet) {
  const rows = (await Payout.find({ earnedMonth: month }).lean()).filter((p) => inScope(p, allowedSet));
  return summarise(rows);
}

/** The same shape, for however many earned months are asked for. */
async function byEarnedMonths(months, allowedSet) {
  const rows = (await Payout.find({ earnedMonth: { $in: months } }).lean()).filter((p) => inScope(p, allowedSet));
  return summarise(rows);
}

function blank() {
  return { expected: 0, received: 0, cut: 0, carried: 0, pending: 0, overdue: 0, writtenOff: 0, count: 0 };
}

function addPayout(acc, p) {
  acc.expected = round2(acc.expected + (p.amountExpected || 0));
  acc.received = round2(acc.received + (p.amountReceived || 0));
  acc.cut = round2(acc.cut + (p.amountCut || 0));
  acc.carried = round2(acc.carried + (p.amountCarried || 0));
  acc.count += 1;
  if (p.status === "written_off") {
    acc.writtenOff = round2(acc.writtenOff + pendingOf(p));
  } else {
    acc.pending = round2(acc.pending + pendingOf(p));
    if (isOverdue(p)) acc.overdue = round2(acc.overdue + pendingOf(p));
  }
}

function summarise(rows) {
  const total = blank();
  const byNetwork = {};
  const byVertical = {};
  rows.forEach((p) => {
    addPayout(total, p);
    const n = p.network || "—";
    const v = p.vertical || "—";
    addPayout((byNetwork[n] = byNetwork[n] || blank()), p);
    addPayout((byVertical[v] = byVertical[v] || blank()), p);
  });
  return {
    total,
    byNetwork: Object.entries(byNetwork).map(([network, t]) => ({ network, ...t })).sort((a, b) => b.expected - a.expected),
    byVertical: Object.entries(byVertical).map(([vertical, t]) => ({ vertical, ...t })).sort((a, b) => b.expected - a.expected),
  };
}

/** Cash that actually arrived during a calendar month, whatever it was earned for. */
async function receivedInMonth(month, allowedSet) {
  const txns = await PayoutTxn.find({ date: { $regex: `^${month}` } }).lean();
  if (!txns.length) return { total: blank(), byNetwork: [], byVertical: [], byEarnedMonth: [] };

  const payoutIds = [...new Set(txns.map((t) => t.payoutId))];
  const payouts = await Payout.find({ id: { $in: payoutIds } }).lean();
  const byId = Object.fromEntries(payouts.map((p) => [p.id, p]));

  const total = blank();
  const nets = {}, verts = {}, earned = {};
  txns.forEach((t) => {
    const p = byId[t.payoutId];
    if (!p || !inScope(p, allowedSet)) return;
    const bump = (acc) => {
      acc.received = round2(acc.received + (t.amountReceived || 0));
      acc.cut = round2(acc.cut + (t.deduction || 0));
      acc.carried = round2(acc.carried + (t.carriedForward || 0));
      acc.count += 1;
    };
    bump(total);
    bump((nets[p.network || "—"] = nets[p.network || "—"] || blank()));
    bump((verts[p.vertical || "—"] = verts[p.vertical || "—"] || blank()));
    bump((earned[p.earnedMonth] = earned[p.earnedMonth] || blank()));
  });

  return {
    total,
    byNetwork: Object.entries(nets).map(([network, t]) => ({ network, ...t })).sort((a, b) => b.received - a.received),
    byVertical: Object.entries(verts).map(([vertical, t]) => ({ vertical, ...t })).sort((a, b) => b.received - a.received),
    byEarnedMonth: Object.entries(earned).map(([m, t]) => ({ earnedMonth: m, ...t })).sort((a, b) => a.earnedMonth.localeCompare(b.earnedMonth)),
  };
}

/** Payouts whose money is expected in this calendar month. */
async function expectedInMonth(month, allowedSet) {
  const rows = (await Payout.find({
    expectedDate: { $regex: `^${month}` },
    status: { $ne: "written_off" },
  }).lean()).filter((p) => inScope(p, allowedSet));
  const total = blank();
  rows.forEach((p) => addPayout(total, p));
  return { total, rows };
}

/** Everything still outstanding right now, regardless of month. */
async function outstanding(allowedSet) {
  const rows = (await Payout.find({
    status: { $in: ["pending", "partial", "overdue"] },
  }).lean()).filter((p) => inScope(p, allowedSet));
  return summarise(rows);
}

/**
 * Dashboard KPIs for one month.
 * `expectedThisMonth` / `receivedThisMonth` read the CALENDAR month (cash flow),
 * while `earned` reads what that month's earnings have turned into so far.
 */
async function dashboard(month, allowedSet) {
  const [out, exp, recv, earned] = await Promise.all([
    outstanding(allowedSet),
    expectedInMonth(month, allowedSet),
    receivedInMonth(month, allowedSet),
    byEarnedMonth(month, allowedSet),
  ]);
  return {
    month,
    outstanding: out.total,
    expectedThisMonth: exp.total,
    receivedThisMonth: recv.total,
    earned: earned.total,
    byNetwork: out.byNetwork,
    byVertical: out.byVertical,
    receivedByNetwork: recv.byNetwork,
    asOf: today(),
  };
}

/**
 * Upcoming expected payments grouped by month, then by date —
 * "in October, $X is due, from which networks".
 */
async function calendar(fromMonth, months = 6, allowedSet) {
  const rows = (await Payout.find({
    status: { $nin: ["received", "written_off"] },
    expectedDate: { $ne: "" },
  }).sort({ expectedDate: 1 }).lean()).filter((p) => inScope(p, allowedSet));

  const ref = today();
  const nowMonth = monthOfDate(ref);
  // the last month inside the requested window
  const toMonth = fromMonth ? addMonths(fromMonth, Math.max(0, months - 1)) : null;

  const groups = {};
  rows.forEach((p) => {
    const m = monthOfDate(p.expectedDate);

    /*
     * Genuinely late money is pinned to its own group so it cannot hide in a month
     * that has already gone by. "Before the window" is a different thing entirely —
     * scrolling the calendar forward must not relabel a payment that is simply not
     * due yet as overdue, so that check is against today, never against the window.
     */
    if (isOverdue(p, ref)) {
      const g = (groups.__overdue = groups.__overdue || { month: "overdue", total: 0, items: [] });
      g.total = round2(g.total + pendingOf(p));
      g.items.push(shape(p));
      return;
    }
    if (fromMonth && (m < fromMonth || (toMonth && m > toMonth))) return;   // outside the window

    const g = (groups[m] = groups[m] || { month: m, total: 0, items: [] });
    g.total = round2(g.total + pendingOf(p));
    g.items.push(shape(p));
  });

  const overdueGroup = groups.__overdue;
  delete groups.__overdue;
  const list = Object.values(groups).sort((a, b) => a.month.localeCompare(b.month)).slice(0, months);

  // the overdue pile belongs on screen whenever the window includes the present
  const showOverdue = overdueGroup && (!fromMonth || fromMonth <= nowMonth);
  return showOverdue ? [overdueGroup, ...list] : list;
}

function shape(p) {
  return {
    id: p.id, campaign: p.campaign, network: p.network, vertical: p.vertical,
    subcategory: p.subcategory || "",
    earnedMonth: p.earnedMonth, expectedDate: p.expectedDate,
    amountExpected: p.amountExpected, amountReceived: p.amountReceived,
    amountCut: p.amountCut, amountCarried: p.amountCarried,
    pending: pendingOf(p), status: p.status, currency: p.currency,
    isOverdue: isOverdue(p),
  };
}

/**
 * Network reliability: who pays on time, who cuts the most, average delay.
 * Delay is measured from the date the payment was expected to the date cash actually
 * arrived, averaged over that network's transactions.
 */
async function networkReliability(allowedSet) {
  const payouts = (await Payout.find({}).lean()).filter((p) => inScope(p, allowedSet));
  if (!payouts.length) return [];
  const byId = Object.fromEntries(payouts.map((p) => [p.id, p]));
  const txns = await PayoutTxn.find({ payoutId: { $in: payouts.map((p) => p.id) } }).lean();

  const acc = {};
  payouts.forEach((p) => {
    const n = p.network || "—";
    const a = (acc[n] = acc[n] || {
      network: n, expected: 0, received: 0, cut: 0, carried: 0, pending: 0,
      payouts: 0, settled: 0, onTime: 0, late: 0, delayDays: [], writtenOff: 0,
    });
    a.expected = round2(a.expected + (p.amountExpected || 0));
    a.received = round2(a.received + (p.amountReceived || 0));
    a.cut = round2(a.cut + (p.amountCut || 0));
    a.carried = round2(a.carried + (p.amountCarried || 0));
    a.payouts += 1;
    if (p.status === "written_off") a.writtenOff = round2(a.writtenOff + pendingOf(p));
    else a.pending = round2(a.pending + pendingOf(p));
    if (p.status === "received") a.settled += 1;
  });

  txns.forEach((t) => {
    const p = byId[t.payoutId];
    if (!p || !t.date || !p.expectedDate) return;
    const a = acc[p.network || "—"];
    if (!a) return;
    const days = Math.round((new Date(t.date) - new Date(p.expectedDate)) / 864e5);
    if (!Number.isFinite(days)) return;
    a.delayDays.push(days);
    if (days <= 0) a.onTime += 1; else a.late += 1;
  });

  return Object.values(acc)
    .map((a) => {
      const avgDelay = a.delayDays.length
        ? Math.round(a.delayDays.reduce((x, y) => x + y, 0) / a.delayDays.length)
        : null;
      const paidTxns = a.onTime + a.late;
      return {
        network: a.network,
        payouts: a.payouts, settled: a.settled,
        expected: a.expected, received: a.received, cut: a.cut, carried: a.carried,
        pending: a.pending, writtenOff: a.writtenOff,
        cutRate: a.expected ? round2((a.cut / a.expected) * 100) : 0,
        collectionRate: a.expected ? round2((a.received / a.expected) * 100) : 0,
        avgDelayDays: avgDelay,
        onTimeRate: paidTxns ? round2((a.onTime / paidTxns) * 100) : null,
      };
    })
    .sort((a, b) => b.expected - a.expected);
}

/**
 * What Company View needs on top of booked profit, keyed by canonical vertical name
 * plus a company-wide total. Earned-month basis — see the note at the top.
 */
async function realizedForMonths(months, allowedSet) {
  const rows = (await Payout.find({ earnedMonth: { $in: months } }).lean()).filter((p) => inScope(p, allowedSet));
  const total = blank();
  const byVert = {};
  rows.forEach((p) => {
    addPayout(total, p);
    const key = normVert(p.vertical);
    addPayout((byVert[key] = byVert[key] || blank()), p);
  });
  return { total, byVertical: byVert };
}

module.exports = {
  byEarnedMonth, byEarnedMonths, receivedInMonth, expectedInMonth,
  outstanding, dashboard, calendar, networkReliability, realizedForMonths,
  summarise, blank, shape, inScope, verticalFilter,
};
