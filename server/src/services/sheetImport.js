/*
 * Turning the rows a sheet gave us into payouts.
 *
 * The preview and the import run the same function; only `commit` differs. That is
 * deliberate — a preview that is computed differently from the thing it previews is
 * a preview of something else, and this one is what people will trust before
 * letting it write forty rows into their books.
 *
 * WHAT IT WILL NOT DO. It never edits a payout that already exists. A sheet row and
 * a payout drift apart the moment somebody reconciles here — that is the app being
 * used, not the sheet being wrong — and a sync that overwrites would quietly undo
 * their work on every run. So an already-imported row is reported and left alone.
 *
 * SCOPE. A manager imports the rows in their own verticals and no others. The rest
 * are listed as out of scope rather than dropped: a run that quietly brought in
 * half a sheet would look exactly like a run that brought in all of it, and the
 * missing half is only noticed weeks later when a total is wrong.
 */
const Payout = require("../models/Payout");
const sheet = require("./sheet");
const svc = require("./payouts");
const { verticalsInScope } = require("../utils/scope");
const { normVert } = require("../utils/helpers");
const { logAudit } = require("../utils/audit");

/**
 * @param url        the sheet
 * @param actor      who asked — recorded on every row and in the audit line
 * @param scopeUser  whose verticals bound the run; the actor unless an admin is
 *                   reading the app as someone else, in which case the lens
 *                   narrows this the same way it narrows every other write
 * @param commit     false to report what would happen and write nothing
 */
async function run(url, actor, { commit = false, scopeUser = null } = {}) {
  const { headers, columns, rows } = await sheet.read(url);
  // null for an admin: no restriction, and rows with no vertical are theirs to file
  const allowed = await verticalsInScope(scopeUser || actor);

  /*
   * Which of the sheet's columns were understood, and which were ignored. Shown
   * before anything is written, because a mis-read header is the failure that looks
   * like success: the import runs, the rows arrive, and one column of money is
   * silently zero.
   */
  const usedIdx = new Set(Object.values(columns));
  const mapped = Object.entries(columns).map(([field, i]) => ({ field, header: headers[i] }));
  const ignored = headers.filter((h, i) => h && !usedIdx.has(i));

  const seenIds = await Payout.find({ externalId: { $ne: "" } }).select("externalId").lean();
  const already = new Set(seenIds.map((p) => p.externalId));

  const results = [];
  const counts = { read: rows.length, imported: 0, reconciled: 0, skippedExisting: 0, skippedBad: 0, skippedScope: 0 };
  const outOfScope = new Set();

  for (const row of rows) {
    if (!row.ok) {
      counts.skippedBad++;
      results.push({ ...summary(row), outcome: "skipped", why: row.problems.join(", ") });
      continue;
    }
    if (already.has(row.externalId)) {
      counts.skippedExisting++;
      results.push({ ...summary(row), outcome: "already", why: "imported before" });
      continue;
    }

    /*
     * Outside this account's verticals — including a row with none at all, which
     * would import into a payout its own importer could not then see.
     */
    const vert = row.payout.vertical;
    if (allowed && !(vert && allowed.has(normVert(vert)))) {
      counts.skippedScope++;
      outOfScope.add(vert || "(no vertical)");
      results.push({ ...summary(row), outcome: "outofscope", why: vert ? `${vert} is not yours` : "no vertical" });
      continue;
    }

    counts.imported++;
    if (row.reconcile) counts.reconciled++;

    if (commit) {
      const created = await svc.createPayout(row.payout, actor);
      if (row.reconcile) {
        await svc.reconcile(created.id, {
          ...row.reconcile,
          note: `Imported from the sheet (${row.externalId})`,
        }, actor);
      }
      /*
       * Guard within the run as well as against the database: a sheet with the same
       * id on two rows would otherwise import both and create the duplicate this is
       * all here to prevent.
       */
      already.add(row.externalId);
    }
    results.push({ ...summary(row), outcome: "import", why: row.reconcile ? "with its payment" : "" });
  }

  if (commit) {
    await logAudit(actor, "payout_added", null, null,
      `sheet import · ${counts.imported} payout(s), ${counts.reconciled} already paid, `
      + `${counts.skippedExisting} seen before, ${counts.skippedBad} unusable`
      + (counts.skippedScope ? `, ${counts.skippedScope} outside this account's verticals` : ""));
  }

  return { headers, mapped, ignored, counts, results, outOfScope: [...outOfScope].sort() };
}

/** Just enough of a row to recognise it on screen. */
function summary(row) {
  return {
    rowNumber: row.rowNumber,
    externalId: row.externalId,
    campaign: row.payout.campaign,
    network: row.payout.network,
    vertical: row.payout.vertical,
    earnedMonth: row.payout.earnedMonth,
    amountExpected: row.payout.amountExpected,
    adCost: row.payout.adCost,
    received: row.reconcile ? row.reconcile.amountReceived : 0,
  };
}

module.exports = { run };
