/*
 * Sessions, two-factor, and the checks around signing in.
 *
 * TOKEN MODEL. Two cookies, both httpOnly:
 *
 *   token   short-lived access token (15 min). Every request carries it; nothing
 *           looks it up in the database, so normal traffic stays cheap.
 *   rtoken  long-lived refresh token (30 days). Only /api/refresh accepts it, it
 *           is stored hashed, and every use ROTATES it.
 *
 * Why bother, when one long-lived cookie is simpler? Because a stolen long-lived
 * token is valid until it expires and nothing can be done about it. Here the thing
 * that gets replayed most (the access token) dies in minutes, and the thing that
 * lasts is single-use: if a stolen refresh token is presented after the real
 * browser has already rotated it, the reuse is detectable — and every session for
 * that user is revoked immediately.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generateSecret, generateURI, verify: verifyTotp } = require("otplib");
const qrcode = require("qrcode");

const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const LoginEvent = require("../models/LoginEvent");
const { notifyTelegram } = require("../utils/audit");
const {
  JWT_SECRET, REFRESH_SECRET, ACCESS_TTL, REFRESH_TTL_DAYS, PROD,
  ACCESS_COOKIE, REFRESH_COOKIE, MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES, TOTP_ISSUER,
} = require("../config/env");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/* ------------------------------------------------------------ request info */

/** The client's real address, honouring a proxy header only when one is trusted. */
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd && req.app.get("trust proxy")) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "";
}

/**
 * A stable-enough handle for "this browser on this machine".
 *
 * Deliberately the user agent and not the IP: phones and offices change address
 * constantly, and alerting on every new IP would be noise nobody reads. A new
 * browser or a new machine is the thing actually worth a message.
 */
function deviceHash(req) {
  return sha(String(req.headers["user-agent"] || "unknown")).slice(0, 32);
}

function requestInfo(req) {
  return {
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    deviceHash: deviceHash(req),
  };
}

/* ----------------------------------------------------------------- cookies */

const cookieBase = {
  httpOnly: true,
  sameSite: "lax",     // the client is same-site; lax still blocks cross-site POSTs
  secure: PROD,
  path: "/",
};

function setAccessCookie(res, token) {
  res.cookie(ACCESS_COOKIE, token, { ...cookieBase, maxAge: 20 * 60 * 1000 });
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieBase,
    // only sent to the refresh endpoint, so it is not exposed on every request
    path: "/api/refresh",
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/refresh" });
}

/* ------------------------------------------------------------------ tokens */

/*
 * `iatMs` is carried alongside the standard `iat` on purpose.
 *
 * A JWT's own issued-at only has SECOND resolution, and the revocation cutoff is a
 * real timestamp — so a token minted in the same second as a revocation is
 * ambiguous. Two things happen in exactly that window and they need opposite
 * answers: changing your own password must keep the browser you did it in signed
 * in, while detecting a stolen token must kill everything issued before that
 * moment. Millisecond precision on both sides makes the comparison exact and
 * removes the need to guess.
 */
function signAccess(user) {
  return jwt.sign(
    { id: user.id, role: user.role, typ: "access", iatMs: Date.now() },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

/** Issue a refresh token, store only its hash, and hand back the raw value once. */
async function issueRefresh(user, info) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const signed = jwt.sign({ id: user.id, jti: sha(raw).slice(0, 24), typ: "refresh" }, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  const token = `${raw}.${signed}`;
  await RefreshToken.create({
    tokenHash: sha(token),
    userId: user.id,
    deviceHash: info.deviceHash,
    userAgent: info.userAgent,
    ip: info.ip,
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

/** Kill every session for a user — used on password change and "sign out everywhere". */
async function revokeAllSessions(userId, reason = "") {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedBy: reason || "revoked" } }
  );
  await User.updateOne({ id: userId }, { $set: { tokensValidFrom: new Date() } });
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Rotation with reuse detection: the presented token is revoked and replaced. If a
 * token that was ALREADY revoked shows up, two copies exist — the real browser's
 * and someone else's — so everything is torn down rather than guessing which is
 * which.
 */
async function rotateRefresh(rawToken, info) {
  if (!rawToken) return { error: "no_token" };

  const parts = String(rawToken).split(".");
  const signed = parts.slice(1).join(".");
  try {
    jwt.verify(signed, REFRESH_SECRET);
  } catch (e) {
    return { error: "bad_token" };
  }

  const hash = sha(rawToken);
  const row = await RefreshToken.findOne({ tokenHash: hash });
  if (!row) return { error: "unknown_token" };

  if (row.revokedAt) {
    await revokeAllSessions(row.userId, "reuse_detected");
    const u = await User.findOne({ id: row.userId }).select("name username").lean();
    notifyTelegram(
      `🚨 Refresh token reuse detected\n👤 ${u ? u.name : "user " + row.userId}\n` +
      `🌐 ${info.ip}\n📋 Every session for this account was signed out as a precaution.`
    );
    return { error: "reuse_detected" };
  }
  if (row.expiresAt < new Date()) return { error: "expired" };

  const user = await User.findOne({ id: row.userId });
  if (!user || !user.active) return { error: "inactive" };
  if (user.tokensValidFrom && row.createdAt < user.tokensValidFrom) return { error: "revoked" };

  const next = await issueRefresh(user, info);
  row.revokedAt = new Date();
  row.replacedBy = sha(next).slice(0, 16);
  row.lastUsedAt = new Date();
  await row.save();

  return { user, access: signAccess(user), refresh: next };
}

/* -------------------------------------------------------------- lockout */

function lockRemainingMs(user) {
  if (!user.lockedUntil) return 0;
  return Math.max(0, new Date(user.lockedUntil).getTime() - Date.now());
}

/**
 * Count a bad password and lock the account once there have been too many.
 *
 * This sits alongside the IP rate limit and covers the other direction: the limiter
 * stops one address trying many passwords, this stops many addresses trying one
 * account. The lock is short and self-clearing, so a real person who mistyped is
 * back in minutes without an admin.
 */
async function noteFailedLogin(user) {
  const failed = (user.failedLogins || 0) + 1;
  const patch = { failedLogins: failed };
  if (failed >= MAX_LOGIN_ATTEMPTS) {
    patch.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    patch.failedLogins = 0;
    notifyTelegram(
      `🔒 Account temporarily locked\n👤 ${user.name}\n` +
      `📋 ${MAX_LOGIN_ATTEMPTS} failed sign-in attempts. Locked for ${LOCKOUT_MINUTES} minutes.`
    );
  }
  await User.updateOne({ id: user.id }, { $set: patch });
  return patch.lockedUntil ? LOCKOUT_MINUTES : 0;
}

async function clearFailedLogins(userId) {
  await User.updateOne({ id: userId }, { $set: { failedLogins: 0, lockedUntil: null } });
}

/* --------------------------------------------------------- login history */

/** Record the attempt, and tell the person when it came from somewhere new. */
async function recordLogin(user, info, { success, reason = "" }) {
  let newDevice = false;

  if (success && user) {
    const known = await User.findOne({ id: user.id }).select("+knownDevices").lean();
    newDevice = !(known?.knownDevices || []).includes(info.deviceHash);
    await User.updateOne({ id: user.id }, {
      $set: { lastLoginAt: new Date(), lastLoginIp: info.ip },
      ...(newDevice ? { $addToSet: { knownDevices: info.deviceHash } } : {}),
    });
  }

  await LoginEvent.create({
    userId: user ? user.id : null,
    username: user ? user.username : "",
    success, reason,
    ip: info.ip, userAgent: info.userAgent, deviceHash: info.deviceHash,
    newDevice,
  });

  if (success && newDevice) {
    notifyTelegram(
      `🔐 Sign-in from a new device\n👤 ${user.name}\n🌐 ${info.ip || "unknown IP"}\n` +
      `💻 ${info.userAgent.slice(0, 120) || "unknown browser"}\n` +
      "📋 If this was not them, change the password and sign out all sessions."
    );
  }
  return newDevice;
}

/* ------------------------------------------------------------------- 2FA */

/*
 * One 30-second step of drift either way is tolerated — phone clocks are rarely
 * exact, and a person who starts typing a code a second before it rolls over should
 * not be told they got it wrong.
 *
 * The option is `epochTolerance`, in SECONDS. otplib v13 has no `window` option at
 * all — passing one is silently ignored, which left this at zero tolerance and
 * rejected any code entered across a step boundary.
 */
const TOTP_TOLERANCE_SECONDS = 30;

/** Does this code match the secret right now? */
async function checkTotp(secret, token) {
  if (!secret || !token) return false;
  try {
    // people paste codes with spaces in ("123 456"); strip whitespace, nothing else
    const clean = String(token).replace(/\s+/g, "");
    const r = await verifyTotp({ secret, token: clean, epochTolerance: TOTP_TOLERANCE_SECONDS });
    return !!(r && r.valid);
  } catch (e) {
    return false;
  }
}

/** Start setup: a secret is held as pending until a valid code proves it works. */
async function beginTwoFactor(user) {
  const secret = generateSecret();
  await User.updateOne({ id: user.id }, { $set: { twoFactorPending: secret } });
  const uri = generateURI({ secret, label: user.username, issuer: TOTP_ISSUER });
  const qr = await qrcode.toDataURL(uri, { margin: 1, width: 220 });
  return { secret, uri, qr };
}

/** Finish setup. Returns one-time recovery codes, shown once and never again. */
async function confirmTwoFactor(user, code) {
  const row = await User.findOne({ id: user.id }).select("+twoFactorPending").lean();
  const pending = row?.twoFactorPending;
  if (!pending) return { error: "not_started" };
  if (!(await checkTotp(pending, code))) return { error: "bad_code" };

  const plain = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
  const hashed = plain.map((c) => bcrypt.hashSync(c, 10));

  await User.updateOne({ id: user.id }, {
    $set: {
      twoFactorSecret: pending,
      twoFactorEnabled: true,
      twoFactorPending: "",
      recoveryCodes: hashed,
    },
  });
  return { recoveryCodes: plain };
}

async function disableTwoFactor(userId) {
  await User.updateOne({ id: userId }, {
    $set: { twoFactorEnabled: false, twoFactorSecret: "", twoFactorPending: "", recoveryCodes: [] },
  });
}

/** Accept either a live TOTP code or one unused recovery code (which is then burned). */
async function verifySecondFactor(userId, code) {
  const row = await User.findOne({ id: userId }).select("+twoFactorSecret +recoveryCodes").lean();
  if (!row) return false;
  const entered = String(code || "").trim();
  if (!entered) return false;

  if (row.twoFactorSecret && (await checkTotp(row.twoFactorSecret, entered))) return true;

  const codes = row.recoveryCodes || [];
  const idx = codes.findIndex((h) => bcrypt.compareSync(entered.toUpperCase(), h));
  if (idx >= 0) {
    const left = codes.filter((_, i) => i !== idx);
    await User.updateOne({ id: userId }, { $set: { recoveryCodes: left } });
    notifyTelegram(`🔑 A recovery code was used to sign in\n👤 user ${userId}\n📋 ${left.length} code(s) left.`);
    return true;
  }
  return false;
}

module.exports = {
  sha, clientIp, deviceHash, requestInfo,
  setAccessCookie, setRefreshCookie, clearAuthCookies,
  signAccess, issueRefresh, rotateRefresh, revokeAllSessions,
  lockRemainingMs, noteFailedLogin, clearFailedLogins, recordLogin,
  beginTwoFactor, confirmTwoFactor, disableTwoFactor, verifySecondFactor, checkTotp,
};
