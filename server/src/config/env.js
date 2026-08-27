/*
 * Central config. Everything the app reads from the environment lives here,
 * so no other file touches process.env directly.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const PROD = process.env.NODE_ENV === "production";

/*
 * Secrets.
 *
 * In production these MUST come from the environment — a secret generated on disk
 * would differ per instance behind a load balancer and every other request would
 * fail to verify. In development one is generated once and cached so restarting
 * the server does not sign everyone out.
 */
function resolveSecret(envValue, filename, label) {
  if (envValue) return envValue;
  if (PROD) {
    console.error(`\n  FATAL: ${label} must be set in the environment in production.\n`);
    process.exit(1);
  }
  const f = path.join(__dirname, "..", "..", filename);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  const s = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  PORT: num(process.env.PORT, 4000),
  HOST: process.env.HOST || (PROD ? "0.0.0.0" : "127.0.0.1"),
  PROD,
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/payment-crm",

  /* ---- auth ---- */
  JWT_SECRET: resolveSecret(process.env.JWT_SECRET, ".jwtsecret", "JWT_SECRET"),
  // separate secret so a leaked access token can never be replayed as a refresh token
  REFRESH_SECRET: resolveSecret(process.env.REFRESH_SECRET, ".refreshsecret", "REFRESH_SECRET"),
  ACCESS_TTL: process.env.ACCESS_TTL || "15m",
  REFRESH_TTL_DAYS: num(process.env.REFRESH_TTL_DAYS, 30),
  ACCESS_COOKIE: "token",
  REFRESH_COOKIE: "rtoken",

  /* ---- brute-force protection ---- */
  MAX_LOGIN_ATTEMPTS: num(process.env.MAX_LOGIN_ATTEMPTS, 8),
  LOCKOUT_MINUTES: num(process.env.LOCKOUT_MINUTES, 15),

  /* ---- rate limits (requests per window) ---- */
  RATE_WINDOW_MINUTES: num(process.env.RATE_WINDOW_MINUTES, 15),
  RATE_MAX_GENERAL: num(process.env.RATE_MAX_GENERAL, 1000),
  RATE_MAX_AUTH: num(process.env.RATE_MAX_AUTH, 20),
  RATE_MAX_WRITE: num(process.env.RATE_MAX_WRITE, 300),
  TRUST_PROXY: process.env.TRUST_PROXY || (PROD ? "1" : ""),

  /* ---- 2FA ---- */
  TOTP_ISSUER: process.env.TOTP_ISSUER || "Payment CRM",
  REQUIRE_2FA_FOR_ADMIN: process.env.REQUIRE_2FA_FOR_ADMIN === "true",

  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  ADMIN_USER: process.env.ADMIN_USER || "admin",
  ADMIN_PASS: process.env.ADMIN_PASS || "changeme123",
  ADMIN_PASS_FROM_ENV: !!process.env.ADMIN_PASS,
  TG_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TG_CHAT: process.env.TELEGRAM_CHAT_ID || "",
  BUDGET_CAP_PERCENT: num(process.env.BUDGET_CAP_PERCENT, 100),
  OVERDUE_SCAN_MINUTES: num(process.env.OVERDUE_SCAN_MINUTES, 360),

  // kept for the old import path; access tokens use ACCESS_COOKIE
  COOKIE_NAME: "token",
};
