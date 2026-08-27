/*
 * Who is making this request.
 *
 * The access token is verified on every call and the user is re-read from the
 * database, so a deactivated account, a changed role or a revoked session takes
 * effect immediately rather than at token expiry.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET, ACCESS_COOKIE, REQUIRE_2FA_FOR_ADMIN } = require("../config/env");

/*
 * When 2FA is compulsory for admins, an admin who has not enrolled yet gets a
 * session that can do exactly one thing: enrol.
 *
 * Refusing the login outright reads as the stricter choice and is actually the
 * broken one — on a fresh install the only admin has no second factor yet, so the
 * account that needs to set 2FA up is precisely the account being locked out. The
 * session is issued instead, then fenced to the routes below until enrolment is
 * finished.
 */
const ENROLMENT_ONLY = new Set([
  "/api/me", "/api/me/2fa/start", "/api/me/2fa/enable", "/api/logout", "/api/logout-all",
]);

/** Is this account required to set up 2FA before it can do anything else? */
const mustEnrollTwoFactor = (u) =>
  !!(REQUIRE_2FA_FOR_ADMIN && u && u.role === "admin" && !u.twoFactorEnabled);

/** Require a signed-in, still-active user. Attaches the user document to req.user. */
async function auth(req, res, next) {
  const t = req.cookies && req.cookies[ACCESS_COOKIE];
  if (!t) return res.status(401).json({ error: "not_authenticated" });

  let payload;
  try {
    payload = jwt.verify(t, JWT_SECRET);
  } catch (e) {
    // expired is its own answer: the client should refresh rather than sign in again
    return res.status(401).json({ error: e.name === "TokenExpiredError" ? "token_expired" : "not_authenticated" });
  }
  if (payload.typ && payload.typ !== "access") return res.status(401).json({ error: "not_authenticated" });

  const u = await User.findOne({ id: payload.id }).lean();
  if (!u || !u.active) return res.status(401).json({ error: "not_authenticated" });

  /*
   * Tokens issued before this instant are dead. Changing a password or signing out
   * everywhere moves the line forward, which invalidates anything already stolen
   * without waiting for it to expire.
   *
   * Compared on `iatMs` — the millisecond stamp this app adds — because the two
   * cases that land inside the same second need opposite outcomes: the browser
   * that just changed its own password must survive, and a token issued a moment
   * before a theft was detected must not. A token without `iatMs` predates that
   * claim, so it falls back to seconds and is treated strictly.
   */
  const cutoff = u.tokensValidFrom ? new Date(u.tokensValidFrom).getTime() : 0;
  if (cutoff) {
    const issued = payload.iatMs || (payload.iat ? payload.iat * 1000 : 0);
    if (issued && issued < cutoff) return res.status(401).json({ error: "session_revoked" });
  }

  /*
   * Checked here rather than on each route so a new endpoint cannot quietly opt out
   * of the policy: everything that requires a session passes through this function.
   */
  if (mustEnrollTwoFactor(u)) {
    // originalUrl, not path — inside a mounted router req.url has the prefix stripped
    const route = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "") || "/";
    if (!ENROLMENT_ONLY.has(route)) return res.status(403).json({ error: "two_factor_required" });
  }

  req.user = u;

  /*
   * "View team".
   *
   * An admin can read the app through one manager's eyes — same screens, narrowed
   * to that manager's verticals — which is the only way to answer "what does Priya
   * actually see?" without signing in as her.
   *
   * `scopeUser` is what every scoped query filters on; `user` stays whoever is
   * really signed in, so auditing still records the admin. The header can only ever
   * NARROW: it is ignored for anyone who is not an admin, and pointing it at another
   * admin changes nothing, because an admin has no restriction to inherit.
   */
  req.scopeUser = u;
  const as = Number(req.get("X-View-As"));
  if (as && u.role === "admin" && as !== u.id) {
    const target = await User.findOne({ id: as }).lean();
    if (target) req.scopeUser = target;
  }

  return next();
}

const adminOnly = (req, res, next) =>
  req.user && req.user.role === "admin" ? next() : res.status(403).json({ error: "forbidden" });

/** Any of the given roles. */
const roles = (...allowed) => (req, res, next) =>
  req.user && allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "forbidden" });

/** Wrap an async handler so a rejected promise becomes a 500 instead of a hang. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { auth, adminOnly, roles, ah, mustEnrollTwoFactor };
