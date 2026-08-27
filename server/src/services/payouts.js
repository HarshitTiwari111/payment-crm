/*
 * Payments / Receivables engine.
 *
 * WHY THIS EXISTS. The CRM shows *booked* profit — revenue minus ad spend, in the
 * month the campaigns ran. In affiliate marketing the cash arrives later and rarely
 * matches: $5,000 earned in August on net-60 is due in October, and when October
 * comes maybe $3,500 lands, $1,000 is cut in validation, and $500 slips to November.
 * This module tracks what is owed, what actually arrived, what was lost, and what
 * moved — and from that computes *realized* profit.
 *
 * WORKED EXAMPLE:
 *   Aug earnings, CPS, Network X — expected $5,000, due October        [pending]
 *   Oct reconcile: received 3500 | cut 1000 (validation) | carry 500 → Nov
 *      → payout now 3500 + 1000 + 500 = 5000, fully accounted         [received]
 *      → a November payout for $500 is created automatically          [pending]
 *   Nov reconcile: received 500                                        [received]
 *   Result: of $5,000 booked, $4,000 real cash, $1,000 lost to validation.
 *
 * The running totals on a payout are always REBUILT from its transactions rather
 * than incremented in place, so a half-finished write can never leave a payout
 * quietly disagreeing with its own ledger.
 */
const Payout = require("../models/Payout");
const PayoutTxn = require("../models/PayoutTxn");
const Network = require("../models/Network");
const Campaign = require("../models/Campaign");
const { withTransaction } = require("../config/db");
const { logAudit } = require("../utils/audit");
const {
  round2, today, daysInMonthOf, monthOfDate, addMonths, toISODate,
} = require("../utils/helpers");

/* ------------------------------------------------------------------ dates */

/**
 * When payment is expected: the last day of the earning month plus the net terms.
 * Net-60 on August earnings lands in late October, which is how the networks
 * actually count it.
 */
function expectedDateFrom(earnedMonth, netTerms) {
  const days = Number(netTerms);
  if (!earnedMonth || !Number.isFinite(days)) return "";
  const [y, m] = String(earnedMonth).split("-").map(Number);
  if (!y || !m) return "";
  const end = new Date(y, m - 1, daysInMonthOf(earnedMonth));
  end.setDate(end.getDate() + days);
  return toISODate(end);
}

/** Accepts a full date or a bare YYYY-MM (treated as the end of that month). */
function normalizeExpectedDate(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    return toISODate(new Date(y, m - 1, daysInMonthOf(s)));
  }
  return "";
}

/* ------------------------------------------------------------------ status */

/**
 * Status from the ledger, in order:
 *   settled (received + cut + carried >= expected)  → received
 *   anything received but not settled               → partial
 *   nothing received and the due date has passed    → overdue
 *   otherwise                                       → pending
 * A written-off payout keeps that status regardless.
 *
 * NOTE: a *partial* payment past its due date stays "partial", because the spec
 * puts partial above overdue. The separate `isOverdue()` flag below is what the
 * alerts and the Overdue KPI use, so a late partial still gets chased.
 */
function computeStatus(p, ref = today()) {
  if (p.status === "written_off") return "written_off";
  const expected = round2(p.amountExpected);
  const received = round2(p.amountReceived);
  const settled = round2(received + (p.amountCut || 0) + (p.amountCarried || 0));
  if (expected > 0 && settled >= expected - 0.005) return "received";
  if (received > 0) return "partial";
  const due = p.expectedDate || "";
  if (due && due < ref) return "overdue";
  return "pending";
}

/** Not fully settled, not written off, and past its due date. Drives alerts + KPI. */
function isOverdue(p, ref = today()) {
  if (!p || p.status === "written_off") return false;
  const settled = round2((p.amountReceived || 0) + (p.amountCut || 0) + (p.amountCarried || 0));
  if (settled >= round2(p.amountExpected) - 0.005) return false;
  return !!(p.expectedDate && p.expectedDate < ref);
}

/** Still owed on this payout. Never negative — an overpayment is not a debt. */
function pendingOf(p) {
  const settled = (p.amountReceived || 0) + (p.amountCut || 0) + (p.amountCarried || 0);
  return round2(Math.max(0, (p.amountExpected || 0) - settled));
}

/*
 * The other side of pendingOf: cash that arrived beyond what was owed.
 *
 * Networks do true up — a late correction in your favour, or a bonus on volume —
 * and that money is real. Pending floors at zero so a settled payout never reads as
 * owing a negative amount, but the surplus has to be visible somewhere or it looks
 * like the books simply lost it.
 */
function overpaidOf(p) {
  const settled = (p.amountReceived || 0) + (p.amountCut || 0) + (p.amountCarried || 0);
  return round2(Math.max(0, settled - (p.amountExpected || 0)));
}

/* ------------------------------------------------------------- recalc */

/**
 * Rebuild a payout's running totals from its transactions and re-derive its status.
 * Everything that changes a ledger goes through here.
 */
async function recalcPayout(payoutId, session = null) {
  const q = PayoutTxn.find({ payoutId: Number(payoutId) });
  if (session) q.session(session);
  const txns = await q.lean();

  const totals = txns.reduce(
    (a, t) => ({
      received: a.received + (Number(t.amountReceived) || 0),
      cut: a.cut + (Number(t.deduction) || 0),
      carried: a.carried + (Number(t.carriedForward) || 0),
    }),
    { received: 0, cut: 0, carried: 0 }
  );

  const pq = Payout.findOne({ id: Number(payoutId) });
  if (session) pq.session(session);
  const payout = await pq;
  if (!payout) return null;

  payout.amountReceived = round2(totals.received);
  payout.amountCut = round2(totals.cut);
  payout.amountCarried = round2(totals.carried);
  payout.status = computeStatus(payout);
  await payout.save({ session: session || undefined });
  return payout;
}

/* ------------------------------------------------------------- create */

/** Register a network / campaign name the first time it is used, so filters stay clean. */
async function registerNames({ network, campaign, vertical }, actor, session = null) {
  if (network) {
    const exists = await Network.findOne({ name: new RegExp(`^${escapeRe(network)}$`, "i") }).session(session || null);
    if (!exists) {
      await Network.create([{ name: network, createdBy: actor && actor.id, createdByName: actor && actor.name }], { session: session || undefined });
    }
  }
  if (campaign) {
    const exists = await Campaign.findOne({
      name: new RegExp(`^${escapeRe(campaign)}$`, "i"),
      vertical: vertical || "",
    }).session(session || null);
    if (!exists) {
      await Campaign.create([{ name: campaign, vertical: vertical || "", createdBy: actor && actor.id, createdByName: actor && actor.name }], { session: session || undefined });
    }
  }
}

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create one expected receivable.
 * If no expectedDate is given it is derived from the net terms — the payout's own,
 * else the network's default.
 */
const PAY_METHODS = ["bank", "paypal", "crypto"];

/**
 * Normalise the payment method and its account into the pair that gets stored.
 *
 * The two move together or not at all: an unrecognised method drops the account
 * with it, so a row can never claim "paid by nothing, to this wallet". Trimmed
 * here rather than at the edge because both the create and the update path need
 * exactly the same answer.
 */
function payTo(data) {
  const method = String(data.payMethod || "").trim().toLowerCase();
  if (!PAY_METHODS.includes(method)) return { payMethod: "", payAccount: "" };
  return { payMethod: method, payAccount: String(data.payAccount || "").trim().slice(0, 200) };
}

async function createPayout(data, actor, session = null) {
  const network = String(data.network || "").trim();
  const vertical = String(data.vertical || "").trim();
  const campaign = String(data.campaign || "").trim();
  const earnedMonth = String(data.earnedMonth || "").trim();

  let netTerms = data.netTerms == null || data.netTerms === "" ? null : Number(data.netTerms);
  let currency = String(data.currency || "").trim().toUpperCase();

  const netDoc = await Network.findOne({ name: new RegExp(`^${escapeRe(network)}$`, "i") }).lean();
  if (netTerms == null && netDoc) netTerms = netDoc.netTerms;
  if (!currency) currency = (netDoc && netDoc.defaultCurrency) || "USD";

  let expectedDate = normalizeExpectedDate(data.expectedDate);
  if (!expectedDate) expectedDate = expectedDateFrom(earnedMonth, netTerms == null ? 30 : netTerms);

  const doc = {
    campaign,
    network,
    vertical,
    earnedMonth,
    amountExpected: round2(data.amountExpected),
    expectedDate,
    netTerms: netTerms == null ? null : netTerms,
    currency,
    status: "pending",
    amountReceived: 0,
    amountCut: 0,
    amountCarried: 0,
    parentId: data.parentId == null ? null : Number(data.parentId),
    ...payTo(data),
    note: String(data.note || "").slice(0, 500),
    createdBy: actor ? actor.id : null,
    createdByName: actor ? actor.name : "",
  };
  doc.status = computeStatus(doc);

  const [created] = await Payout.create([doc], { session: session || undefined });
  await registerNames({ network, campaign, vertical }, actor, session);
  return created;
}

/* ------------------------------------------------------------- reconcile */

/**
 * Record one installment against a payout.
 *
 * All of this happens together: the transaction row is written, the
 * payout's totals and status are rebuilt, and — when part of the money has slipped
 * — a child payout is created for the month it slipped to, pointing back at this
 * one via parentId.
 *
 * On a replica set this runs inside a real MongoDB transaction. On a standalone
 * mongod (no replica set, so no transactions) it runs the same steps unwrapped;
 * see config/db.js.
 */
async function reconcile(payoutId, body, actor) {
  const received = Math.max(0, round2(body.amountReceived));
  const deduction = Math.max(0, round2(body.deduction));
  const carried = Math.max(0, round2(body.carriedForward));
  const reason = String(body.deductionReason || "").trim();
  const note = String(body.note || "").slice(0, 500);
  const date = normalizeExpectedDate(body.date) || today();

  if (!received && !deduction && !carried) {
    const err = new Error("empty_reconcile");
    err.code = "empty_reconcile";
    throw err;
  }
  if (deduction > 0 && !reason) {
    const err = new Error("deduction_needs_reason");
    err.code = "deduction_needs_reason";
    throw err;
  }

  return withTransaction(async (session) => {
    const payout = await Payout.findOne({ id: Number(payoutId) }).session(session || null);
    if (!payout) {
      const err = new Error("not_found");
      err.code = "not_found";
      throw err;
    }
    if (payout.status === "written_off") {
      const err = new Error("written_off");
      err.code = "written_off";
      throw err;
    }

    // Where the carried amount is now expected. Default: the month after the one
    // this payout was due in, so a slip always lands somewhere sensible.
    let carriedToMonth = String(body.carriedToMonth || "").trim();
    if (carried > 0 && !carriedToMonth) {
      const base = monthOfDate(payout.expectedDate) || payout.earnedMonth;
      carriedToMonth = addMonths(base, 1);
    }

    const [txn] = await PayoutTxn.create(
      [{
        payoutId: payout.id,
        date,
        amountReceived: received,
        deduction,
        deductionReason: deduction > 0 ? reason : "",
        carriedForward: carried,
        carriedToMonth: carried > 0 ? carriedToMonth : "",
        note,
        createdBy: actor ? actor.id : null,
        createdByName: actor ? actor.name : "",
      }],
      { session: session || undefined }
    );

    // The carry-forward becomes a brand new receivable for the later month.
    let child = null;
    if (carried > 0) {
      child = await createPayout(
        {
          campaign: payout.campaign,
          network: payout.network,
          vertical: payout.vertical,
          earnedMonth: payout.earnedMonth,          // it is still August money
          amountExpected: carried,
          expectedDate: carriedToMonth,             // ...just expected later
          netTerms: payout.netTerms,
          currency: payout.currency,
          // same network, same route: the remainder arrives the way the rest did
          payMethod: payout.payMethod,
          payAccount: payout.payAccount,
          parentId: payout.id,
          note: `Carried forward from payout #${payout.id}`,
        },
        actor,
        session
      );
      txn.spawnedPayoutId = child.id;
      await txn.save({ session: session || undefined });
    }

    const updated = await recalcPayout(payout.id, session);
    return { payout: updated, txn, child };
  });
}

/**
 * A correction. Transactions are immutable, so fixing a mistake means
 * posting an opposite entry that references the original rather than editing it.
 */
async function adjust(payoutId, originalTxnId, body, actor) {
  return withTransaction(async (session) => {
    const payout = await Payout.findOne({ id: Number(payoutId) }).session(session || null);
    if (!payout) {
      const err = new Error("not_found");
      err.code = "not_found";
      throw err;
    }
    const original = await PayoutTxn.findOne({ id: Number(originalTxnId), payoutId: payout.id }).session(session || null);
    if (!original) {
      const err = new Error("txn_not_found");
      err.code = "txn_not_found";
      throw err;
    }
    const [txn] = await PayoutTxn.create(
      [{
        payoutId: payout.id,
        date: normalizeExpectedDate(body.date) || today(),
        amountReceived: round2(body.amountReceived),   // may be negative — that is the point
        deduction: round2(body.deduction),
        deductionReason: String(body.deductionReason || "").trim(),
        carriedForward: round2(body.carriedForward),
        carriedToMonth: String(body.carriedToMonth || "").trim(),
        reversalOf: original.id,
        note: String(body.note || `Adjustment to txn #${original.id}`).slice(0, 500),
        createdBy: actor ? actor.id : null,
        createdByName: actor ? actor.name : "",
      }],
      { session: session || undefined }
    );
    const updated = await recalcPayout(payout.id, session);
    return { payout: updated, txn };
  });
}

/* ------------------------------------------------------------- write-off */

async function writeOff(payoutId, reason, actor) {
  const payout = await Payout.findOne({ id: Number(payoutId) });
  if (!payout) return null;
  payout.status = "written_off";
  payout.writeOffReason = String(reason || "").slice(0, 500);
  await payout.save();
  await logAudit(actor, "payout_writeoff", null, payout.earnedMonth,
    `${payout.network} · ${payout.vertical || "—"} · ${payout.currency} ${pendingOf(payout)} unrecoverable${reason ? " · " + reason : ""}`);
  return payout;
}

/** Undo a write-off — the ledger is untouched, so the status just re-derives. */
async function unWriteOff(payoutId) {
  const payout = await Payout.findOne({ id: Number(payoutId) });
  if (!payout) return null;
  payout.status = "pending";
  payout.writeOffReason = "";
  payout.status = computeStatus(payout);
  await payout.save();
  return payout;
}

/* ------------------------------------------------------------- overdue scan */

/**
 * Find payouts whose due date has passed and that are not fully settled, refresh
 * their status, and announce each one once (overdueNotifiedAt stops the same payout
 * being announced on every scan).
 */
async function scanOverdue() {
  const ref = today();
  const candidates = await Payout.find({
    status: { $nin: ["received", "written_off"] },
    expectedDate: { $ne: "", $lt: ref },
  });
  const fresh = [];
  for (const p of candidates) {
    if (!isOverdue(p, ref)) continue;
    const next = computeStatus(p, ref);
    if (next !== p.status) p.status = next;
    if (!p.overdueNotifiedAt) {
      p.overdueNotifiedAt = new Date();
      fresh.push(p);
    }
    await p.save();
  }
  for (const p of fresh) {
    await logAudit(
      { id: null, name: "system" },
      "payout_overdue",
      null,
      p.earnedMonth,
      `${p.network} · ${p.vertical || "—"}${p.campaign ? " · " + p.campaign : ""} · ${p.currency} ${pendingOf(p)} was due ${p.expectedDate}`
    );
  }
  return { checked: candidates.length, notified: fresh.length };
}

module.exports = {
  expectedDateFrom, normalizeExpectedDate,
  computeStatus, isOverdue, pendingOf, overpaidOf,
  recalcPayout, createPayout, reconcile, adjust, payTo,
  writeOff, unWriteOff, scanOverdue, registerNames, escapeRe,
};
