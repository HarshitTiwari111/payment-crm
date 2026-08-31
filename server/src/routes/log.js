/*
 * The log — who signed in, and who changed what.
 *
 * None of this is new data. Every write already lands in Audit and every sign-in
 * attempt in LoginEvent; the trail simply had no way out of the database, so the
 * only way to answer "who wrote this payout off?" was to open a Mongo shell. These
 * two routes are that way out, and nothing more: they read, they never write.
 *
 * Admin only, and not because a manager could do damage with it — they could not,
 * it is read-only — but because it is a record of everyone. A manager scoped to one
 * vertical has no business reading when a colleague last signed in or from which
 * address. Scoping it per vertical was the other option and it would produce a
 * half-truth: an audit trail that omits rows is worse than one you cannot open,
 * because it still looks complete.
 */
const express = require("express");
const Audit = require("../models/Audit");
const LoginEvent = require("../models/LoginEvent");
const User = require("../models/User");
const { auth, adminOnly, ah } = require("../middleware/auth");
const { ACTION_LABELS } = require("../utils/audit");
const { escapeRe } = require("../services/payouts");

const router = express.Router();

/*
 * A log is read newest-first and nobody scrolls to the end of one, so it pages
 * rather than returning everything. The ceiling is deliberate: this collection only
 * grows, and "give me all of it" on a two-year-old install is a request that
 * succeeds slowly and then runs the browser out of memory.
 */
function paging(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  return { page, limit, skip: (page - 1) * limit };
}

/*
 * Query values arrive as strings and go straight into a mongo filter, where a value
 * that cannot be cast raises inside the driver and reaches the client as a 500. The
 * two below refuse it as the bad request it is; app.js turns a thrown err.status
 * into that response.
 */
function badRequest() {
  const e = new Error("invalid_input");
  e.status = 400;
  e.code = "invalid_input";
  return e;
}

/** A date range from YYYY-MM-DD strings, either end optional. */
function range(from, to) {
  const q = {};
  if (from) {
    const d = new Date(from + "T00:00:00.000Z");
    if (isNaN(d)) throw badRequest();
    q.$gte = d;
  }
  if (to) {
    // the day itself, not the instant it starts — a range of 5th–5th has to include
    // the 5th, which it would not if this were midnight at the front of it
    const d = new Date(to + "T23:59:59.999Z");
    if (isNaN(d)) throw badRequest();
    q.$lte = d;
  }
  return Object.keys(q).length ? q : null;
}

/** An id from the query string, or a 400. */
function idFrom(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest();
  return n;
}

const like = (s) => new RegExp(escapeRe(String(s).trim()), "i");

/*
 * GET /api/log/activity
 *
 * Filters: q (actor name or detail), action, actorId, from, to (YYYY-MM-DD).
 */
router.get("/log/activity", auth, adminOnly, ah(async (req, res) => {
  const { page, limit, skip } = paging(req);
  const q = {};

  if (req.query.action) q.action = String(req.query.action);
  if (req.query.actorId) q.actorId = idFrom(req.query.actorId);

  const ts = range(req.query.from, req.query.to);
  if (ts) q.ts = ts;

  if (req.query.q) {
    const re = like(req.query.q);
    q.$or = [{ actorName: re }, { detail: re }, { action: re }];
  }

  const [total, rows] = await Promise.all([
    Audit.countDocuments(q),
    Audit.find(q).sort({ ts: -1, id: -1 }).skip(skip).limit(limit).lean(),
  ]);

  /*
   * targetUserId is stored as a number and means nothing on screen. Resolve the
   * names for this page only — one query for the whole page rather than one per
   * row, and none at all when no row on it names a target.
   */
  const ids = [...new Set(rows.map((r) => r.targetUserId).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const users = await User.find({ id: { $in: ids } }).select("id name").lean();
    users.forEach((u) => { names[u.id] = u.name; });
  }

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      actorId: r.actorId,
      actorName: r.actorName || "system",
      action: r.action,
      label: ACTION_LABELS[r.action] || r.action,
      targetUserId: r.targetUserId,
      targetName: r.targetUserId ? (names[r.targetUserId] || null) : null,
      month: r.month,
      detail: r.detail || "",
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1,
  });
}));

/*
 * GET /api/log/signins
 *
 * Filters: q (username or address), result (ok | fail), from, to.
 *
 * Failures are the reason this is separate from the activity feed. A successful
 * sign-in belongs to a user; a failed one belongs to nobody — there may be no such
 * account — so it has a username string and a null id, and merging the two lists
 * would mean a column that is a user on some rows and a guess on others.
 */
router.get("/log/signins", auth, adminOnly, ah(async (req, res) => {
  const { page, limit, skip } = paging(req);
  const q = {};

  if (req.query.result === "ok") q.success = true;
  if (req.query.result === "fail") q.success = false;

  const at = range(req.query.from, req.query.to);
  if (at) q.at = at;

  if (req.query.q) {
    const re = like(req.query.q);
    q.$or = [{ username: re }, { ip: re }];
  }

  const [total, rows] = await Promise.all([
    LoginEvent.countDocuments(q),
    LoginEvent.find(q).sort({ at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  res.json({
    items: rows.map((r) => ({
      id: String(r._id),
      at: r.at,
      userId: r.userId,
      username: r.username || "",
      success: !!r.success,
      reason: r.reason || "",
      ip: r.ip || "",
      userAgent: r.userAgent || "",
      newDevice: !!r.newDevice,
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1,
  });
}));

/*
 * What the filter dropdowns need.
 *
 * Actions come from the data rather than from ACTION_LABELS, so the list only ever
 * offers something that would actually return rows — an empty result from a filter
 * you were invited to pick reads as a broken screen.
 */
router.get("/log/meta", auth, adminOnly, ah(async (req, res) => {
  const [actions, actorIds] = await Promise.all([
    Audit.distinct("action"),
    Audit.distinct("actorId"),
  ]);

  const ids = actorIds.filter((n) => n != null);
  const users = ids.length
    ? await User.find({ id: { $in: ids } }).select("id name").lean()
    : [];

  res.json({
    actions: actions
      .filter(Boolean)
      .map((a) => ({ value: a, label: ACTION_LABELS[a] || a }))
      .sort((x, y) => x.label.localeCompare(y.label)),
    actors: users
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((x, y) => x.name.localeCompare(y.name)),
  });
}));

/*
 * One person's own sign-in history, for the account menu. Not admin-gated — it is
 * your own, and you are the one who would notice a login you did not make.
 */
router.get("/log/mine", auth, ah(async (req, res) => {
  const rows = await LoginEvent.find({ userId: req.user.id })
    .sort({ at: -1 }).limit(20).lean();
  res.json(rows.map((r) => ({
    at: r.at, success: !!r.success, ip: r.ip || "", userAgent: r.userAgent || "", newDevice: !!r.newDevice,
  })));
}));

module.exports = router;
