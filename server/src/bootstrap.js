/*
 * One-time setup that runs on every boot: seed the first admin, make sure the
 * default verticals exist, and keep the id counters ahead of any imported data.
 * Everything here is idempotent — restarting must never change existing data.
 */
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Vertical = require("./models/Vertical");
const Subcategory = require("./models/Subcategory");
const { bumpTo } = require("./models/Counter");
const { ADMIN_USER, ADMIN_PASS, ADMIN_PASS_FROM_ENV, PROD } = require("./config/env");

const DEFAULT_VERTICALS = ["Nutra", "iGaming", "CPS", "Pay Per Call", "MetAds"];

async function seedAdmin() {
  const count = await User.countDocuments({ role: "admin" });
  if (count > 0) return;

  /*
   * Refuse to mint the first admin in production with the built-in password. It is
   * printed in the README, so an install that never set ADMIN_PASS would come up
   * with credentials anyone could read — reachable from the internet, unlike the
   * dev default it was borrowed from.
   *
   * Only the seeding path is guarded, not startup: once an admin exists this
   * function returns above and the variable is never consulted, so an already-live
   * deployment cannot be knocked over by a restart.
   */
  if (PROD && !ADMIN_PASS_FROM_ENV) {
    console.error("");
    console.error("  FATAL: no admin exists and ADMIN_PASS is not set.");
    console.error("  Refusing to create the first admin with the documented default password.");
    console.error("  Set ADMIN_PASS in the environment and start again.");
    console.error("");
    process.exit(1);
  }

  await User.create({
    username: ADMIN_USER.toLowerCase(),
    passwordHash: bcrypt.hashSync(ADMIN_PASS, 12),
    name: "Administrator",
    role: "admin",
  });
  console.log(`\n  Seeded admin -> username: "${ADMIN_USER}"  password: "${ADMIN_PASS}"`);
  if (!ADMIN_PASS_FROM_ENV) console.log("  IMPORTANT: change this password after first login.\n");
}

async function seedVerticals() {
  // adopt any vertical already present on an account
  const used = await User.distinct("vertical", { vertical: { $nin: ["", null] } });
  const multi = await User.distinct("verticals");
  const all = [...new Set([...DEFAULT_VERTICALS, ...used, ...multi.flat()])].filter(Boolean);
  for (const name of all) {
    await Vertical.updateOne(
      { name },
      { $setOnInsert: { name, status: "approved" } },
      { upsert: true }
    );
  }
}

/*
 * Merge verticals that differ only by case.
 *
 * The create route rejects case-duplicates, but data imported from elsewhere can
 * still carry them in — and "igaming" sitting beside "iGaming" splits every
 * receivables total in two. The repair runs here so it is fixed before anyone reads
 * a report off it.
 */
async function mergeCaseDuplicateVerticals() {
  try {
    const rows = await Vertical.find({}).select("name").lean();
    const groups = {};
    rows.forEach((r) => {
      const l = (r.name || "").toLowerCase().trim();
      (groups[l] = groups[l] || []).push(r.name);
    });
    for (const names of Object.values(groups)) {
      if (names.length < 2) continue;
      const canonical = names.find((n) => DEFAULT_VERTICALS.includes(n)) || names.slice().sort()[0];
      for (const dup of names) {
        if (dup === canonical) continue;
        await User.updateMany({ vertical: dup }, { $set: { vertical: canonical } });
        const withDup = await User.find({ verticals: dup }).select("id verticals").lean();
        for (const u of withDup) {
          const next = [...new Set((u.verticals || []).map((v) => (v === dup ? canonical : v)))];
          await User.updateOne({ id: u.id }, { $set: { verticals: next } });
        }
        await Subcategory.updateMany({ vertical: dup }, { $set: { vertical: canonical } });
        await Vertical.deleteOne({ name: dup });
      }
    }
  } catch (e) {
    console.error("vertical merge skipped:", e.message);
  }
}

/** Keep every auto-increment counter above the highest id already stored. */
async function syncCounters() {
  const pairs = [
    ["users", require("./models/User")],
    ["audit", require("./models/Audit")],
    ["subcategories", require("./models/Subcategory")],
    ["payouts", require("./models/Payout")],
    ["payout_txns", require("./models/PayoutTxn")],
  ];
  for (const [name, Model] of pairs) {
    const top = await Model.findOne({}).sort({ id: -1 }).select("id").lean();
    if (top && top.id) await bumpTo(name, top.id);
  }
}

async function bootstrap() {
  await syncCounters();
  await seedAdmin();
  await seedVerticals();
  await mergeCaseDuplicateVerticals();
}

module.exports = { bootstrap, DEFAULT_VERTICALS };
