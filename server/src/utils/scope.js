/*
 * Who may see what.
 *
 * With two roles the question is not "who reports to whom" but "which verticals is
 * this account responsible for". An admin has no restriction; a manager is limited
 * to the verticals stored on their own account. Every scoped query filters on that
 * set, and the check always runs on the server — the client is never trusted with it.
 */
const { normVert, asArray } = require("./helpers");

/** A user's canonical vertical — the first one they hold. */
function primaryVertical(u) {
  if (!u) return "Unassigned";
  if (u.vertical) return u.vertical;
  const a = asArray(u.verticals);
  if (a.length) return a[0];
  return "Unassigned";
}

/** Every vertical a person works in (multi list, else their single one). */
function ownVerticalsOf(u) {
  const vs = asArray(u && u.verticals);
  if (vs.length) return vs;
  return u && u.vertical ? [u.vertical] : [];
}

/** Which roles this actor is allowed to create/assign. Only an admin creates accounts. */
function allowedRolesFor(role) {
  return role === "admin" ? ["admin", "manager"] : [];
}

/** Can the actor edit/deactivate this account? (Nobody manages themselves.) */
function canManageTarget(actor, targetId) {
  if (!actor || actor.role !== "admin") return false;
  return Number(targetId) !== actor.id;
}

/**
 * The set of verticals a person may touch.
 * Returns null for an admin, meaning "no restriction".
 */
async function verticalsInScope(user) {
  if (!user) return new Set();
  if (user.role === "admin") return null;
  const set = new Set();
  ownVerticalsOf(user).forEach((v) => { if (v) set.add(normVert(v)); });
  return set;
}

module.exports = {
  allowedRolesFor, canManageTarget, primaryVertical, ownVerticalsOf, verticalsInScope,
};
