/*
 * Payments / Receivables API.
 *
 * ACCESS. An admin sees every vertical. A manager works inside their own — the
 * verticals stored on their account — and that is re-checked here on every route
 * rather than trusted from the client. There is no third role: what lives here is
 * the company's financial position, and it belongs to the two roles accountable
 * for it.
 */
const express = require("express");
const Payout = require("../models/Payout");
const PayoutTxn = require("../models/PayoutTxn");
const Network = require("../models/Network");
const Campaign = require("../models/Campaign");
const { auth, adminOnly, ah } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const S = require("../validation/schemas");
const { verticalsInScope } = require("../utils/scope");
const { logAudit } = require("../utils/audit");
const { round2, normVert, today, monthOfDate } = require("../utils/helpers");
const svc = require("../services/payouts");
const receivables = require("../services/receivables");

const router = express.Router();

/* ------------------------------------------------------------ permissions */

/*
 * Both roles read and write here; what separates them is the vertical scope
 * checked further down, not the verb.
 *
 * Read and write are kept as two names because the routes already read that way,
 * and a future "manager may look but not settle" then lands in one place instead
 * of forty.
 */
const canRead = (user) => !!user && (user.role === "admin" || user.role === "manager");
const canWrite = canRead;

const requireRead = (req, res, next) => (canRead(req.user) ? next() : res.status(403).json({ error: "forbidden" }));
const requireWrite = (req, res, next) => (canWrite(req.user) ? next() : res.status(403).json({ error: "forbidden" }));

/** Throws unless the vertical is inside the actor's scope. */
async function assertVerticalAllowed(user, vertical) {
  const allowed = await verticalsInScope(user);
  if (!allowed) return true;                       // admin
  if (!vertical || !allowed.has(normVert(vertical))) {
    const err = new Error("forbidden_vertical");
    err.status = 403;
    err.code = "forbidden_vertical";
    throw err;
  }
  return true;
}

/** Shape a stored payout for the client, with the derived numbers filled in. */
function shape(p) {
  return {
    id: p.id,
    campaign: p.campaign || "",
    network: p.network,
    vertical: p.vertical || "",
    earnedMonth: p.earnedMonth,
    expectedMonth: monthOfDate(p.expectedDate),
    expectedDate: p.expectedDate || "",
    netTerms: p.netTerms,
    currency: p.currency || "USD",
    amountExpected: round2(p.amountExpected),
    amountReceived: round2(p.amountReceived),
    amountCut: round2(p.amountCut),
    amountCarried: round2(p.amountCarried),
    pending: svc.pendingOf(p),
    overpaid: svc.overpaidOf(p),
    status: p.status,
    isOverdue: svc.isOverdue(p),
    parentId: p.parentId ?? null,
    payMethod: p.payMethod || "",
    payAccount: p.payAccount || "",
    writeOffReason: p.writeOffReason || "",
    note: p.note || "",
    createdBy: p.createdBy ?? null,
    createdByName: p.createdByName || "",
    createdAt: p.createdAt,
  };
}

/* ------------------------------------------------------------------ lists */

/*
 * GET /api/payouts
 * Filters: month (earned), expectedMonth, status, network, vertical, campaign,
 *          overdue=1, q (free text), page/limit.
 *
 * Paged on purpose: payouts multiply — every network, every month, plus a child
 * for every carry-forward — so an unbounded read would get slow within a year.
 */
router.get("/payouts", auth, requireRead, ah(async (req, res) => {
  const q = {};
  if (req.query.month) q.earnedMonth = req.query.month;
  if (req.query.expectedMonth) q.expectedDate = { $regex: `^${req.query.expectedMonth}` };
  if (req.query.status) q.status = req.query.status;
  if (req.query.network) q.network = new RegExp(`^${svc.escapeRe(req.query.network)}$`, "i");
  if (req.query.vertical) q.vertical = new RegExp(`^${svc.escapeRe(req.query.vertical)}$`, "i");
  if (req.query.campaign) q.campaign = new RegExp(`^${svc.escapeRe(req.query.campaign)}$`, "i");
  if (req.query.q) {
    const rx = new RegExp(svc.escapeRe(req.query.q), "i");
    q.$or = [{ campaign: rx }, { network: rx }, { vertical: rx }, { note: rx }];
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

  const allowed = await verticalsInScope(req.scopeUser);
  // Vertical scoping is applied after the query so the same rule is used everywhere
  // (a payout with no vertical is admin-only, exactly like company-wide overhead).
  let rows = await Payout.find(q).sort({ expectedDate: 1, id: -1 }).lean();
  if (allowed) rows = rows.filter((p) => p.vertical && allowed.has(normVert(p.vertical)));
  if (req.query.overdue === "1") rows = rows.filter((p) => svc.isOverdue(p));

  const total = rows.length;
  const items = rows.slice((page - 1) * limit, page * limit).map(shape);

  const totals = rows.reduce(
    (a, p) => ({
      expected: round2(a.expected + (p.amountExpected || 0)),
      received: round2(a.received + (p.amountReceived || 0)),
      cut: round2(a.cut + (p.amountCut || 0)),
      carried: round2(a.carried + (p.amountCarried || 0)),
      pending: round2(a.pending + (p.status === "written_off" ? 0 : svc.pendingOf(p))),
    }),
    { expected: 0, received: 0, cut: 0, carried: 0, pending: 0 }
  );

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, totals });
}));

/* ---------------------------------------------------------- dashboard etc */

/** KPI cards for a month. Registered before /:id so it isn't read as an id. */
router.get("/payouts/summary/:month", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  res.json(await receivables.dashboard(req.params.month, allowed));
}));

/** Upcoming expected payments grouped by month. */
router.get("/payouts/calendar", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  const from = req.query.from || monthOfDate(today());
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  res.json(await receivables.calendar(from, months, allowed));
}));

/** Everything still owed, right now, whatever month it came from. */
router.get("/payouts/outstanding", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  res.json(await receivables.outstanding(allowed));
}));

/* ---------------------------------------------------------------- reports */

/** "Of what we earned in August, how much is received / cut / still pending." */
router.get("/payouts/reports/earned/:month", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  res.json(await receivables.byEarnedMonth(req.params.month, allowed));
}));

/** "How much cash actually came in during October." */
router.get("/payouts/reports/received/:month", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  res.json(await receivables.receivedInMonth(req.params.month, allowed));
}));

/** Who pays on time, who cuts the most, average delay. */
router.get("/payouts/reports/networks", auth, requireRead, ah(async (req, res) => {
  const allowed = await verticalsInScope(req.scopeUser);
  res.json(await receivables.networkReliability(allowed));
}));

/**
 * The receivables trend: expected, received, cut and still-owed for each of the
 * last N earned months. Read left to right it shows how a month's money fills in
 * over time — the recent columns always look worse, because that cash is still in
 * transit rather than lost.
 */
router.get("/payouts/reports/trend", auth, requireRead, ah(async (req, res) => {
  const count = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const end = req.query.to || monthOfDate(today());
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const [y, m] = end.split("-").map(Number);
    const d = new Date(y, m - 1 - i, 1);
    months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }

  const allowed = await verticalsInScope(req.scopeUser);
  const out = [];
  for (const month of months) {
    const rz = await receivables.realizedForMonths([month], allowed);
    const t = rz.total;
    out.push({
      month,
      expected: t.expected,
      received: t.received,
      cut: t.cut,
      carried: t.carried,
      receivable: t.pending,
      collected: t.expected ? round2((t.received / t.expected) * 100) : null,
    });
  }
  res.json(out);
}));

/* --------------------------------------------------------------- one payout */

router.get("/payouts/:id", auth, requireRead, validate({ params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  const allowed = await verticalsInScope(req.scopeUser);
  if (allowed && (!p.vertical || !allowed.has(normVert(p.vertical)))) return res.status(403).json({ error: "forbidden" });

  // Ordered by insertion, not by value date: this is an audit ledger, so an
  // adjustment must always read after the entry it corrects — even when that entry
  // carries a later date than the day the correction was made.
  const txns = await PayoutTxn.find({ payoutId: p.id }).sort({ id: 1 }).lean();
  const children = await Payout.find({ parentId: p.id }).lean();
  const parent = p.parentId ? await Payout.findOne({ id: p.parentId }).lean() : null;
  res.json({
    payout: shape(p),
    txns,
    children: children.map(shape),
    parent: parent ? shape(parent) : null,
  });
}));

/* ---------------------------------------------------------------- create */

router.post("/payouts", auth, requireWrite, validate({ body: S.createPayout }), ah(async (req, res) => {
  const b = req.body || {};
  const network = String(b.network || "").trim();
  const vertical = String(b.vertical || "").trim();
  const earnedMonth = String(b.earnedMonth || "").trim();
  const amount = round2(b.amountExpected);

  if (!network || !earnedMonth || !amount) return res.status(400).json({ error: "missing" });
  if (!/^\d{4}-\d{2}$/.test(earnedMonth)) return res.status(400).json({ error: "bad_month" });
  await assertVerticalAllowed(req.scopeUser, vertical);

  const p = await svc.createPayout({ ...b, network, vertical, earnedMonth, amountExpected: amount }, req.user);
  await logAudit(req.user, "payout_added", null, earnedMonth,
    `${network} · ${vertical || "—"}${p.campaign ? " · " + p.campaign : ""} · ${p.currency} ${amount} due ${p.expectedDate || "?"}`);
  res.json(shape(p));
}));

/*
 * Bulk-create for a closed month.
 *
 * A caveat worth knowing: the CRM stores a person's spend and revenue per month,
 * not per network — there is no network-level revenue anywhere in it. So this can
 * only propose ONE payout per vertical, for that vertical's whole booked revenue,
 * and whoever runs it has to split it across the real networks afterwards. It is a
 * starting point, not a reconciliation.
 */
/* ----------------------------------------------------------------- update */

/*
 * Edit a payout. The ledger columns are deliberately NOT editable — received, cut
 * and carried are rebuilt from the transactions, so changing them by hand here
 * would just be overwritten on the next reconcile and would hide a real mismatch.
 */
router.put("/payouts/:id", auth, requireWrite, validate({ body: S.updatePayout, params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) });
  if (!p) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, p.vertical);

  const b = req.body || {};
  if (b.vertical !== undefined && String(b.vertical).trim() !== p.vertical) {
    await assertVerticalAllowed(req.scopeUser, String(b.vertical).trim());
    p.vertical = String(b.vertical).trim();
  }
  if (b.campaign !== undefined) p.campaign = String(b.campaign).trim();
  if (b.network !== undefined && String(b.network).trim()) p.network = String(b.network).trim();
  if (b.earnedMonth !== undefined && /^\d{4}-\d{2}$/.test(String(b.earnedMonth))) p.earnedMonth = String(b.earnedMonth);
  if (b.amountExpected !== undefined) p.amountExpected = round2(b.amountExpected);
  if (b.netTerms !== undefined) p.netTerms = b.netTerms === "" || b.netTerms == null ? null : Number(b.netTerms);
  if (b.currency !== undefined && String(b.currency).trim()) p.currency = String(b.currency).trim().toUpperCase();
  if (b.note !== undefined) p.note = String(b.note).slice(0, 500);

  // method and account are set as a pair, so an edit that clears one clears both
  if (b.payMethod !== undefined || b.payAccount !== undefined) {
    const pay = svc.payTo({ payMethod: b.payMethod ?? p.payMethod, payAccount: b.payAccount ?? p.payAccount });
    p.payMethod = pay.payMethod;
    p.payAccount = pay.payAccount;
  }

  if (b.expectedDate !== undefined) {
    p.expectedDate = svc.normalizeExpectedDate(b.expectedDate)
      || svc.expectedDateFrom(p.earnedMonth, p.netTerms == null ? 30 : p.netTerms);
    p.overdueNotifiedAt = null;   // a new due date deserves a fresh alert if it lapses
  }

  p.status = svc.computeStatus(p);
  await p.save();
  await svc.registerNames({ network: p.network, campaign: p.campaign, vertical: p.vertical }, req.user);

  await logAudit(req.user, "payout_updated", null, p.earnedMonth,
    `#${p.id} ${p.network} · ${p.vertical || "—"} · ${p.currency} ${p.amountExpected}`);
  res.json(shape(p));
}));

/* -------------------------------------------------------------- reconcile */

/*
 * POST /api/payouts/:id/reconcile
 * body: { date, amountReceived, deduction, deductionReason, carriedForward,
 *         carriedToMonth, note }
 *
 * Writes the transaction, rebuilds the payout's totals and status, and — when
 * something was carried — creates next month's payout for it, all together.
 */
router.post("/payouts/:id/reconcile", auth, requireWrite, validate({ body: S.reconcile, params: S.idParam }), ah(async (req, res) => {
  const existing = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!existing) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, existing.vertical);

  let out;
  try {
    out = await svc.reconcile(existing.id, req.body || {}, req.user);
  } catch (e) {
    if (e.code === "empty_reconcile") return res.status(400).json({ error: "empty_reconcile" });
    if (e.code === "deduction_needs_reason") return res.status(400).json({ error: "deduction_needs_reason" });
    if (e.code === "written_off") return res.status(409).json({ error: "written_off" });
    if (e.code === "not_found") return res.status(404).json({ error: "not_found" });
    throw e;
  }

  const { payout, txn, child } = out;
  const bits = [];
  if (txn.amountReceived) bits.push(`received ${payout.currency} ${txn.amountReceived}`);
  if (txn.deduction) bits.push(`cut ${txn.deduction} (${txn.deductionReason})`);
  if (txn.carriedForward) bits.push(`carried ${txn.carriedForward} → ${txn.carriedToMonth}`);
  await logAudit(req.user, "payout_reconciled", null, payout.earnedMonth,
    `#${payout.id} ${payout.network} · ${bits.join(" | ")} → ${payout.status}`);
  if (child) {
    await logAudit(req.user, "payout_carry_created", null, child.earnedMonth,
      `#${child.id} ${child.network} · ${child.currency} ${child.amountExpected} now expected ${child.expectedDate}`);
  }

  res.json({ payout: shape(payout), txn, child: child ? shape(child) : null });
}));

/*
 * A correction. Transactions are immutable, so this posts an opposite
 * entry that references the original instead of editing history.
 */
router.post("/payouts/:id/adjust", auth, requireWrite, validate({ body: S.adjust, params: S.idParam }), ah(async (req, res) => {
  const existing = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!existing) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, existing.vertical);

  const txnId = Number((req.body || {}).txnId);
  if (!txnId) return res.status(400).json({ error: "missing_txn" });

  let out;
  try {
    out = await svc.adjust(existing.id, txnId, req.body || {}, req.user);
  } catch (e) {
    if (e.code === "txn_not_found") return res.status(404).json({ error: "txn_not_found" });
    if (e.code === "not_found") return res.status(404).json({ error: "not_found" });
    throw e;
  }
  await logAudit(req.user, "payout_adjusted", null, out.payout.earnedMonth,
    `#${out.payout.id} adjusting txn #${txnId} → ${out.payout.status}`);
  res.json({ payout: shape(out.payout), txn: out.txn });
}));

router.get("/payouts/:id/txns", auth, requireRead, validate({ params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, p.vertical);
  res.json(await PayoutTxn.find({ payoutId: p.id }).sort({ id: 1 }).lean());
}));

/* -------------------------------------------------------------- write-off */

router.post("/payouts/:id/writeoff", auth, requireWrite, validate({ body: S.writeoff, params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, p.vertical);
  const updated = await svc.writeOff(p.id, (req.body || {}).reason, req.user);
  res.json(shape(updated));
}));

/** Undo a write-off — the ledger is untouched, so the status simply re-derives. */
router.post("/payouts/:id/unwriteoff", auth, requireWrite, validate({ params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!p) return res.status(404).json({ error: "not_found" });
  await assertVerticalAllowed(req.scopeUser, p.vertical);
  const updated = await svc.unWriteOff(p.id);
  await logAudit(req.user, "payout_updated", null, p.earnedMonth, `#${p.id} write-off reversed`);
  res.json(shape(updated));
}));

/*
 * Delete. Only when the payout has no transactions and spawned no children —
 * anything with a ledger gets written off instead, so the history survives.
 */
router.delete("/payouts/:id", auth, requireWrite, validate({ params: S.idParam }), ah(async (req, res) => {
  const p = await Payout.findOne({ id: Number(req.params.id) }).lean();
  if (!p) return res.json({ ok: true });
  await assertVerticalAllowed(req.scopeUser, p.vertical);
  const txnCount = await PayoutTxn.countDocuments({ payoutId: p.id });
  const childCount = await Payout.countDocuments({ parentId: p.id });
  if (txnCount || childCount) return res.status(409).json({ error: "has_history", txns: txnCount, children: childCount });
  await Payout.deleteOne({ id: p.id });
  await logAudit(req.user, "payout_deleted", null, p.earnedMonth, `#${p.id} ${p.network} · ${p.currency} ${p.amountExpected}`);
  res.json({ ok: true });
}));

/** Run the overdue sweep now instead of waiting for the timer. */
router.post("/payouts/scan-overdue", auth, adminOnly, ah(async (req, res) => {
  res.json(await svc.scanOverdue());
}));

/* ------------------------------------------------------- networks & campaigns */

router.get("/networks", auth, requireRead, ah(async (req, res) => {
  const q = req.query.all === "1" ? {} : { active: true };
  res.json(await Network.find(q).sort({ name: 1 }).lean());
}));

router.post("/networks", auth, requireWrite, validate({ body: S.network }), ah(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "empty" });
  // case-insensitive duplicate check — the whole reason networks are a collection
  const dupe = await Network.findOne({ name: new RegExp(`^${svc.escapeRe(name)}$`, "i") }).lean();
  if (dupe) return res.status(409).json({ error: "exists" });
  /*
   * The check above is a read, so two requests can both pass it and only the
   * unique index decides. That collision is the same answer as the check's —
   * the name is taken — and it was reaching the client as a 500.
   */
  let n;
  try {
    n = await Network.create({
      name,
      netTerms: b.netTerms == null || b.netTerms === "" ? 30 : Number(b.netTerms),
      defaultCurrency: String(b.defaultCurrency || "USD").trim().toUpperCase(),
      contact: String(b.contact || "").trim(),
      note: String(b.note || "").trim(),
      createdBy: req.user.id, createdByName: req.user.name,
    });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: "exists" });
    throw e;
  }
  await logAudit(req.user, "network_created", null, null, `${name} · net-${n.netTerms} · ${n.defaultCurrency}`);
  res.json(n);
}));

router.put("/networks/:id", auth, requireWrite, validate({ body: S.networkUpdate, params: S.objectIdParam }), ah(async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.name !== undefined && String(b.name).trim()) set.name = String(b.name).trim();
  if (b.netTerms !== undefined) set.netTerms = Number(b.netTerms) || 0;
  if (b.defaultCurrency !== undefined) set.defaultCurrency = String(b.defaultCurrency).trim().toUpperCase();
  if (b.contact !== undefined) set.contact = String(b.contact).trim();
  if (b.note !== undefined) set.note = String(b.note).trim();
  if (b.active !== undefined) set.active = !!b.active;
  const n = await Network.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
  if (!n) return res.status(404).json({ error: "not_found" });
  await logAudit(req.user, "network_updated", null, null, n.name);
  res.json(n);
}));

/** Removing a network is blocked while payouts still reference it. */
router.delete("/networks/:id", auth, adminOnly, validate({ params: S.objectIdParam }), ah(async (req, res) => {
  const n = await Network.findById(req.params.id).lean();
  if (!n) return res.json({ ok: true });
  const used = await Payout.countDocuments({ network: new RegExp(`^${svc.escapeRe(n.name)}$`, "i") });
  if (used) return res.status(409).json({ error: "in_use", payouts: used });
  await Network.deleteOne({ _id: n._id });
  await logAudit(req.user, "network_deleted", null, null, n.name);
  res.json({ ok: true });
}));

router.get("/campaigns", auth, requireRead, ah(async (req, res) => {
  const q = { active: true };
  if (req.query.vertical) q.vertical = req.query.vertical;
  res.json(await Campaign.find(q).sort({ name: 1 }).lean());
}));

router.post("/campaigns", auth, requireWrite, validate({ body: S.campaign }), ah(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const vertical = String(b.vertical || "").trim();
  if (!name) return res.status(400).json({ error: "empty" });
  await assertVerticalAllowed(req.scopeUser, vertical);
  try {
    const c = await Campaign.create({ name, vertical, createdBy: req.user.id, createdByName: req.user.name });
    res.json(c);
  } catch (e) {
    res.status(409).json({ error: "exists" });
  }
}));

module.exports = router;
