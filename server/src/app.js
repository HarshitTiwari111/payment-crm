const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { CLIENT_ORIGIN, PROD, TRUST_PROXY } = require("./config/env");
const {
  securityHeaders, forceHttps, sanitizeRequest,
  generalLimiter, authLimiter, writeLimiter,
} = require("./middleware/security");

const app = express();

/*
 * Behind a proxy (Nginx, Cloudflare, a platform load balancer) the client's real
 * address is in X-Forwarded-For. Telling Express to trust it is what makes rate
 * limiting and the login log record the actual caller rather than the proxy — and
 * it is deliberately opt-in, because trusting that header when there is NO proxy
 * lets anyone spoof their IP and slip past the limiter.
 */
if (TRUST_PROXY) app.set("trust proxy", TRUST_PROXY === "true" ? true : Number(TRUST_PROXY) || TRUST_PROXY);

app.disable("x-powered-by");
app.use(forceHttps);
app.use(securityHeaders());

app.use(cors({
  origin: PROD ? true : [CLIENT_ORIGIN, "http://127.0.0.1:5173", "http://localhost:5173"],
  credentials: true,
}));

// a body cap so a single request cannot be used to exhaust memory
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(sanitizeRequest);
app.use(generalLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---- routes ---- */
const api = express.Router();

// the tightest limit goes on the routes worth guessing at
api.use("/login", authLimiter);
api.use("/refresh", authLimiter);
api.use("/me/2fa", authLimiter);
api.use(writeLimiter);

api.use(require("./routes/auth"));
api.use(require("./routes/users").router);
api.use(require("./routes/taxonomy"));
api.use(require("./routes/payouts"));
app.use("/api", api);

app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

/* ---- built client (production) ---- */
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      // hashed assets never change; index.html must not be cached or a deploy is invisible
      if (/\.(js|css|woff2?|png|jpg|svg)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  app.get("*", (req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

/* ---- errors ---- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.status === 403) return res.status(403).json({ error: err.code || "forbidden" });
  if (err && err.status === 400) return res.status(400).json({ error: err.code || "bad_request" });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });

  // log the detail, return none — a stack trace in a response is a map of the app
  console.error("Unhandled:", err && err.stack ? err.stack : err);
  res.status(500).json({ error: "server" });
});

module.exports = app;
