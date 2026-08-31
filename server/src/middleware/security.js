/*
 * Transport and request-level hardening.
 *
 * Each piece here blocks a specific class of attack, and they are applied before
 * any route so nothing can be reached without passing through them:
 *
 *   helmet          security headers, incl. a CSP and HSTS in production
 *   https redirect  no plaintext session cookie ever crosses the wire in production
 *   mongo-sanitize  strips $ and . from user input, so {"$ne": null} cannot be
 *                   smuggled into a query and turn a login check into "any user"
 *   rate limits     bounded requests per IP, tightest on the login route
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const jwt = require("jsonwebtoken");
const {
  PROD, RATE_WINDOW_MINUTES, RATE_MAX_GENERAL, RATE_MAX_AUTH, RATE_MAX_WRITE, ACCESS_COOKIE,
  JWT_SECRET, CLIENT_DIST,
} = require("../config/env");

/* ------------------------------------------------------------------ headers */

/*
 * The built index.html carries one inline script: it reads the saved theme and sets
 * it before the first paint, which is the entire reason it is inline rather than in
 * the bundle. `script-src 'self'` blocks inline scripts, so production served the
 * page, refused to run that script, and every dark-mode load flashed white and left
 * a CSP error in the console.
 *
 * Hashing whatever is actually on disk keeps the policy strict without pinning a
 * constant that goes stale the next time that block is edited. No dist — a dev run,
 * or an API-only deploy — simply yields no hashes.
 */
function inlineScriptHashes() {
  try {
    const html = fs.readFileSync(path.join(CLIENT_DIST, "index.html"), "utf8");
    const CLOSE = "</script>";
    const hashes = [];
    let at = 0;
    for (;;) {
      const open = html.indexOf("<script", at);
      if (open === -1) break;
      const tagEnd = html.indexOf(">", open);
      const close = html.indexOf(CLOSE, tagEnd);
      if (tagEnd === -1 || close === -1) break;
      // a script with a src is fetched, not inline, and 'self' already covers it
      if (!html.slice(open, tagEnd).includes(" src=")) {
        const body = html.slice(tagEnd + 1, close);
        const sum = crypto.createHash("sha256").update(body, "utf8").digest("base64");
        hashes.push("'sha256-" + sum + "'");
      }
      at = close + CLOSE.length;
    }
    return hashes;
  } catch (e) {
    return [];
  }
}

function securityHeaders() {
  return helmet({
    /*
     * The built client is JS and CSS from this origin, plus the one inline script
     * in index.html, which is admitted by its hash rather than by opening
     * script-src.
     *
     * Styles are split. React writes 125-odd inline style ATTRIBUTES, which only
     * style-src-attr has to allow; nothing in the build emits a <style> ELEMENT, so
     * style-src itself stays closed. Allowing both under one style-src, as this did,
     * permitted a whole class of injected markup that the app never needed.
     */
    contentSecurityPolicy: PROD ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...inlineScriptHashes()],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],          // no framing → no clickjacking
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    } : false,                                // CSP off in dev: Vite injects inline scripts
    hsts: PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,          // would block the QR code data: image
    referrerPolicy: { policy: "same-origin" },
  });
}

/** In production, anything arriving over plain HTTP is bounced to HTTPS. */
function forceHttps(req, res, next) {
  if (!PROD) return next();
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (proto === "https") return next();
  if (req.method === "GET" || req.method === "HEAD") {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  return res.status(403).json({ error: "https_required" });
}

/* --------------------------------------------------------------- sanitizing */

/*
 * express-mongo-sanitize's own middleware reassigns req.query, which Express 5+
 * makes read-only. Walking the objects in place works on every version and does
 * exactly the same job.
 */
function sanitizeRequest(req, res, next) {
  ["body", "params", "query"].forEach((k) => {
    if (req[k] && typeof req[k] === "object") mongoSanitize.sanitize(req[k], { replaceWith: "_" });
  });
  next();
}

/* ------------------------------------------------------------- rate limits */

const windowMs = RATE_WINDOW_MINUTES * 60 * 1000;

/*
 * Count per SIGNED-IN USER where there is one, and only fall back to the address
 * otherwise.
 *
 * Keying purely on IP looks safe and quietly punishes normal work: a whole office
 * behind one NAT shares a single budget, so ten people entering their daily numbers
 * lock each other out while a single attacker on a home line gets the same
 * allowance to themselves.
 *
 * The signature is VERIFIED here, not merely decoded. Decoding was enough to read
 * the id and looked harmless — but the id IS the bucket, so anyone could mint an
 * unsigned token, change the number on every request and draw a fresh allowance
 * each time. That did not key the limiter, it switched it off. A forged, tampered
 * or expired token now falls through to the address, exactly like no token at all.
 */
function userOrIpKey(req) {
  const raw = req.cookies && req.cookies[ACCESS_COOKIE];
  if (raw) {
    try {
      const claims = jwt.verify(raw, JWT_SECRET);
      if (claims && claims.id) return `u:${claims.id}`;
    } catch (e) {
      /* not a token this server issued — fall through to the address */
    }
  }
  return ipKeyGenerator(req.ip);
}

const base = {
  windowMs,
  standardHeaders: true,
  legacyHeaders: false,
  // behind a proxy the real client is in X-Forwarded-For; app.js sets trust proxy
  message: { error: "rate_limited" },
};

/** Everything, as a backstop against scraping and runaway clients. */
const generalLimiter = rateLimit({ ...base, max: RATE_MAX_GENERAL, keyGenerator: userOrIpKey });

/**
 * Login and token refresh. Deliberately tight: this is the only surface where
 * guessing has any value, and a real person signs in a handful of times a day.
 * Successful logins are not counted, so being locked out for working normally
 * cannot happen.
 */
const authLimiter = rateLimit({
  ...base,
  max: RATE_MAX_AUTH,
  skipSuccessfulRequests: true,
  message: { error: "rate_limited", detail: "Too many attempts. Wait a few minutes and try again." },
});

/** Writes — slows down anyone hammering the API with mutations. */
const writeLimiter = rateLimit({
  ...base,
  max: RATE_MAX_WRITE,
  keyGenerator: userOrIpKey,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
});

module.exports = {
  securityHeaders, forceHttps, sanitizeRequest,
  generalLimiter, authLimiter, writeLimiter,
};
