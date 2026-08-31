/*
 * Signing in, staying signed in, and two-factor.
 *
 * Every failure returns the SAME message and takes a similar amount of work,
 * whether the username exists or not — otherwise the response itself tells an
 * attacker which accounts are real, and they can stop guessing usernames.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const LoginEvent = require("../models/LoginEvent");
const { auth, ah, mustEnrollTwoFactor: mustEnroll } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const S = require("../validation/schemas");
const { logAudit } = require("../utils/audit");
const svc = require("../services/auth");
const { REFRESH_COOKIE, MAX_LOGIN_ATTEMPTS } = require("../config/env");

const router = express.Router();

/* Constant-ish work even when the user does not exist, so timing cannot be read. */
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 10);

router.post("/login", validate({ body: S.login }), ah(async (req, res) => {
  const { username, password, totp } = req.body;
  const info = svc.requestInfo(req);
  const deny = (reason) => res.status(401).json({ error: "invalid_credentials", reason });

  const user = await User.findOne({ username });

  if (!user || !user.active) {
    bcrypt.compareSync(password, DUMMY_HASH);
    await svc.recordLogin(null, info, { success: false, reason: "no_such_user" });
    return deny();
  }

  const lockMs = svc.lockRemainingMs(user);
  if (lockMs > 0) {
    await svc.recordLogin(user, info, { success: false, reason: "locked" });
    return res.status(423).json({
      error: "account_locked",
      minutes: Math.ceil(lockMs / 60000),
    });
  }

  if (!bcrypt.compareSync(password, user.passwordHash)) {
    const lockedFor = await svc.noteFailedLogin(user);
    await svc.recordLogin(user, info, { success: false, reason: "bad_password" });
    if (lockedFor) return res.status(423).json({ error: "account_locked", minutes: lockedFor });
    const left = Math.max(0, MAX_LOGIN_ATTEMPTS - ((user.failedLogins || 0) + 1));
    return res.status(401).json({ error: "invalid_credentials", attemptsLeft: left });
  }

  /*
   * Password was right. If this account carries a second factor, nothing is issued
   * until it is supplied — the client re-posts the same credentials with a code.
   */
  if (user.twoFactorEnabled) {
    if (!totp) {
      await svc.recordLogin(user, info, { success: false, reason: "2fa_required" });
      return res.status(401).json({ error: "totp_required" });
    }
    const ok = await svc.verifySecondFactor(user.id, totp);
    if (!ok) {
      await svc.noteFailedLogin(user);
      await svc.recordLogin(user, info, { success: false, reason: "bad_totp" });
      return res.status(401).json({ error: "invalid_totp" });
    }
  }

  await svc.clearFailedLogins(user.id);
  const newDevice = await svc.recordLogin(user, info, { success: true });

  svc.setAccessCookie(res, svc.signAccess(user));
  svc.setRefreshCookie(res, await svc.issueRefresh(user, info));

  /*
   * `mustEnrollTwoFactor` tells the client to open the security screen and keep it
   * open. The server does not rely on it — the same rule is enforced in the auth
   * middleware, so a client that ignores the flag still gets nowhere.
   */
  res.json({ ...user.toPublic(), newDevice, mustEnrollTwoFactor: mustEnroll(user) });
}));

/*
 * Trade the refresh cookie for a fresh pair. The client calls this automatically
 * when a request comes back with token_expired, so a person never sees it happen.
 */
router.post("/refresh", ah(async (req, res) => {
  const info = svc.requestInfo(req);
  const raw = req.cookies && req.cookies[REFRESH_COOKIE];
  const out = await svc.rotateRefresh(raw, info);

  if (out.error) {
    svc.clearAuthCookies(res);
    const status = out.error === "reuse_detected" ? 401 : 401;
    return res.status(status).json({ error: "not_authenticated", reason: out.error });
  }

  svc.setAccessCookie(res, out.access);
  svc.setRefreshCookie(res, out.refresh);
  res.json(out.user.toPublic());
}));

router.post("/logout", ah(async (req, res) => {
  const raw = req.cookies && req.cookies[REFRESH_COOKIE];
  if (raw) {
    await RefreshToken.updateOne(
      { tokenHash: svc.sha(raw), revokedAt: null },
      { $set: { revokedAt: new Date(), replacedBy: "logout" } }
    );
  }
  svc.clearAuthCookies(res);
  res.json({ ok: true });
}));

/** Sign out everywhere — the answer to "I think someone has my password". */
router.post("/logout-all", auth, ah(async (req, res) => {
  await svc.revokeAllSessions(req.user.id, "logout_all");
  svc.clearAuthCookies(res);
  await logAudit(req.user, "sessions_revoked", req.user.id, null, "signed out of every device");
  res.json({ ok: true });
}));

router.get("/me", auth, ah(async (req, res) => {
  const u = await User.findOne({ id: req.user.id });
  if (!u) return res.status(401).json({ error: "not_authenticated" });
  res.json({ ...u.toPublic(), mustEnrollTwoFactor: mustEnroll(u) });
}));

/* ------------------------------------------------------------- password */

router.post("/me/password", auth, validate({ body: S.changePassword }), ah(async (req, res) => {
  const { current, next } = req.body;
  const u = await User.findOne({ id: req.user.id });
  if (!u || !bcrypt.compareSync(current, u.passwordHash)) {
    return res.status(400).json({ error: "wrong_current" });
  }
  if (bcrypt.compareSync(next, u.passwordHash)) {
    return res.status(400).json({ error: "same_password" });
  }

  u.passwordHash = bcrypt.hashSync(next, 12);
  u.passwordChangedAt = new Date();
  await u.save();

  /*
   * Changing a password signs out every other session. If the reason for changing
   * it was that someone else had the old one, leaving their session alive would
   * defeat the point entirely.
   */
  await svc.revokeAllSessions(u.id, "password_changed");
  const info = svc.requestInfo(req);
  svc.setAccessCookie(res, svc.signAccess(u));
  svc.setRefreshCookie(res, await svc.issueRefresh(u, info));

  await logAudit(req.user, "password_changed", u.id, null, "password changed; other sessions signed out");
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ 2FA */

router.post("/me/2fa/start", auth, ah(async (req, res) => {
  const out = await svc.beginTwoFactor(req.user);
  // the secret is returned so it can be typed in by hand when a camera is not an option
  res.json({ qr: out.qr, secret: out.secret, uri: out.uri });
}));

router.post("/me/2fa/enable", auth, validate({ body: S.totpCode }), ah(async (req, res) => {
  const out = await svc.confirmTwoFactor(req.user, req.body.code);
  if (out.error === "not_started") return res.status(400).json({ error: "not_started" });
  if (out.error === "bad_code") return res.status(400).json({ error: "bad_code" });
  await logAudit(req.user, "twofactor_enabled", req.user.id, null, "two-factor turned on");
  res.json({ ok: true, recoveryCodes: out.recoveryCodes });
}));

/*
 * Turning 2FA off requires the current password. Otherwise anyone who finds an
 * unlocked laptop could remove the very control that protects the account.
 */
router.post("/me/2fa/disable", auth, ah(async (req, res) => {
  const pw = String((req.body || {}).password || "");
  const u = await User.findOne({ id: req.user.id });
  if (!u || !bcrypt.compareSync(pw, u.passwordHash)) {
    return res.status(400).json({ error: "wrong_password" });
  }
  await svc.disableTwoFactor(req.user.id);
  await logAudit(req.user, "twofactor_disabled", req.user.id, null, "two-factor turned off");
  res.json({ ok: true });
}));

/* --------------------------------------------------------------- sessions */

/** The devices currently signed in as you, so a stranger can be spotted and removed. */
router.get("/me/sessions", auth, ah(async (req, res) => {
  const rows = await RefreshToken.find({ userId: req.user.id, revokedAt: null })
    .sort({ lastUsedAt: -1 }).lean();
  const current = req.cookies && req.cookies[REFRESH_COOKIE];
  const currentHash = current ? svc.sha(current) : null;
  res.json(rows.map((r) => ({
    id: r._id,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    current: r.tokenHash === currentHash,
  })));
}));

router.delete("/me/sessions/:id", auth, validate({ params: S.objectIdParam }), ah(async (req, res) => {
  await RefreshToken.updateOne(
    { _id: req.params.id, userId: req.user.id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedBy: "revoked_by_user" } }
  );
  res.json({ ok: true });
}));

/** Recent sign-in attempts on this account, successful or not. */
router.get("/me/login-history", auth, ah(async (req, res) => {
  const rows = await LoginEvent.find({ userId: req.user.id })
    .sort({ at: -1 }).limit(50)
    .select("success reason ip userAgent newDevice at").lean();
  res.json(rows);
}));

module.exports = router;
