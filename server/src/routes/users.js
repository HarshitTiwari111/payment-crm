/*
 * Account management.
 *
 * There are two roles and only an admin hands them out. A manager can read the
 * list — it is how they find out who else covers a vertical — but every write here
 * is admin-only, which keeps privilege escalation off the table entirely. Nobody
 * edits or deactivates their own account.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Vertical = require("../models/Vertical");
const { auth, adminOnly, ah } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const S = require("../validation/schemas");
const { allowedRolesFor, canManageTarget } = require("../utils/scope");
const { logAudit } = require("../utils/audit");

const router = express.Router();

/** Register a vertical the moment it is used, so the dropdown never falls behind. */
async function ensureVerticalApproved(name) {
  if (!name) return;
  await Vertical.updateOne(
    { name },
    { $set: { status: "approved" }, $setOnInsert: { name } },
    { upsert: true }
  );
}

const ROLE_ORDER = { admin: 2, manager: 1 };
const sortPeople = (a, b) =>
  (ROLE_ORDER[b.role] || 0) - (ROLE_ORDER[a.role] || 0) || String(a.name).localeCompare(String(b.name));

const publicShape = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  active: u.active,
  vertical: u.vertical || "",
  verticals: u.verticals || [],
  twoFactorEnabled: !!u.twoFactorEnabled,
  lastLoginAt: u.lastLoginAt || null,
});

/*
 * The list. An admin sees deactivated accounts too — they are the ones who restore
 * them; a manager sees only the accounts still in use.
 */
router.get("/users", auth, ah(async (req, res) => {
  const q = req.user.role === "admin" ? {} : { active: true };
  const rows = await User.find(q).lean();
  res.json(rows.map(publicShape).sort(sortPeople));
}));

router.post("/users", auth, adminOnly, validate({ body: S.createUser }), ah(async (req, res) => {
  const actor = req.user;
  const b = req.body || {};
  const { username, password, name } = b;
  if (!username || !password || !name) return res.status(400).json({ error: "missing" });

  const r = b.role || "manager";
  if (!allowedRolesFor(actor.role).includes(r)) return res.status(403).json({ error: "role_not_allowed" });

  const verts = Array.isArray(b.verticals) ? b.verticals : [];
  let vert = b.vertical || "";
  if (verts.length && !vert) vert = verts[0];

  // Re-adding someone who was removed reactivates their old account, so their whole
  // history relinks instead of failing on the taken username or forking a duplicate.
  const existing = await User.findOne({ username: String(username).toLowerCase() });
  if (existing) {
    if (existing.active) return res.status(409).json({ error: "username_taken" });
    Object.assign(existing, {
      passwordHash: bcrypt.hashSync(password, 12),
      name, role: r, vertical: vert, verticals: verts, active: true,
    });
    await existing.save();
    await ensureVerticalApproved(vert);
    for (const v of verts) await ensureVerticalApproved(v);
    await logAudit(actor, "user_reactivated", existing.id, null, `${name} (${r}) — re-added, history relinked`);
    return res.json({ id: existing.id, reactivated: true });
  }

  try {
    const created = await User.create({
      username: String(username).toLowerCase(),
      passwordHash: bcrypt.hashSync(password, 12),
      name, role: r, vertical: vert, verticals: verts,
    });
    await ensureVerticalApproved(vert);
    for (const v of verts) await ensureVerticalApproved(v);
    await logAudit(actor, "user_created", created.id, null, `${name} (${r})`);
    res.json({ id: created.id });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: "username_taken" });
    throw e;
  }
}));

router.put("/users/:id", auth, adminOnly, validate({ body: S.updateUser, params: S.idParam }), ah(async (req, res) => {
  const actor = req.user;
  if (!canManageTarget(actor, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const target = await User.findOne({ id: Number(req.params.id) });
  if (!target) return res.status(404).json({ error: "not_found" });

  const b = req.body || {};
  const r = ["admin", "manager"].includes(b.role) ? b.role : target.role;

  /*
   * The last admin cannot be demoted. Losing the only account that can create
   * accounts is not recoverable from inside the app.
   */
  if (target.role === "admin" && r !== "admin") {
    const admins = await User.countDocuments({ role: "admin", active: true });
    if (admins <= 1) return res.status(400).json({ error: "last_admin" });
  }

  const verts = Array.isArray(b.verticals) ? b.verticals : [];
  let vert = b.vertical || "";
  if (verts.length && !vert) vert = verts[0];

  Object.assign(target, { name: b.name, role: r, vertical: vert, verticals: verts });
  await target.save();

  await ensureVerticalApproved(vert);
  for (const v of verts) await ensureVerticalApproved(v);
  await logAudit(actor, "user_updated", target.id, null, b.name);
  res.json({ ok: true });
}));

router.post("/users/:id/password", auth, adminOnly, validate({ body: S.setPassword, params: S.idParam }), ah(async (req, res) => {
  if (!canManageTarget(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  await User.updateOne(
    { id: Number(req.params.id) },
    { $set: { passwordHash: bcrypt.hashSync(req.body.password, 12), tokensValidFrom: new Date() } }
  );
  await logAudit(req.user, "password_reset", Number(req.params.id), null, "password set by admin");
  res.json({ ok: true });
}));

/*
 * Soft delete. Deactivating keeps every payout, transaction and audit line attached
 * to the account, so it can be restored intact; a hard delete would orphan all of it.
 */
router.delete("/users/:id", auth, adminOnly, ah(async (req, res) => {
  if (!canManageTarget(req.user, req.params.id)) return res.status(403).json({ error: "forbidden" });
  const r = await User.updateOne(
    { id: Number(req.params.id), role: { $ne: "admin" } },
    { $set: { active: false, tokensValidFrom: new Date() } }
  );
  if (r.modifiedCount) {
    await logAudit(req.user, "user_deactivated", Number(req.params.id), null, "account deactivated (data kept)");
  }
  res.json({ ok: true, deactivated: r.modifiedCount > 0 });
}));

router.post("/users/:id/reactivate", auth, adminOnly, ah(async (req, res) => {
  const u = await User.findOne({ id: Number(req.params.id) });
  if (!u) return res.status(404).json({ error: "not_found" });
  u.active = true;
  await u.save();
  await logAudit(req.user, "user_reactivated", u.id, null, "account restored");
  res.json({ ok: true });
}));

module.exports = { router, ensureVerticalApproved };
