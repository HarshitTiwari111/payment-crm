const app = require("./app");
const { connectDB } = require("./config/db");
const { bootstrap } = require("./bootstrap");
const { PORT, HOST, MONGODB_URI, OVERDUE_SCAN_MINUTES } = require("./config/env");
const { scanOverdue } = require("./services/payouts");
const { diagnoseConnection } = require("./config/diagnose");

async function start() {
  await connectDB();
  await bootstrap();

  /*
   * Overdue sweep. The SQLite build had no scheduler at all — Telegram
   * only ever fired on a user action — so this is new: a payout that quietly passes
   * its due date now gets noticed without anyone opening the app.
   *
   * It runs once at boot (catching anything that lapsed while the server was down)
   * and then on a timer. Each payout is announced once, not on every pass.
   */
  if (OVERDUE_SCAN_MINUTES > 0) {
    const run = () => scanOverdue()
      .then((r) => { if (r.notified) console.log(`  overdue scan: ${r.notified} newly overdue payout(s)`); })
      .catch((e) => console.error("overdue scan failed:", e.message));
    run();
    const t = setInterval(run, OVERDUE_SCAN_MINUTES * 60 * 1000);
    t.unref();
  }

  app.listen(PORT, HOST, () => {
    console.log(`  Payment CRM API running on http://${HOST}:${PORT}`);
  });
}

start().catch((e) => {
  console.error("\n  Failed to start:", e.message);
  const hint = diagnoseConnection(e.message, MONGODB_URI);
  if (hint) console.error(hint + "\n");
  process.exit(1);
});
