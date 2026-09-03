/*
 * Importing payouts from a Google Sheet.
 *
 * Admin only. Not because reading a sheet is dangerous, but because a run writes
 * payouts across every vertical in it — a manager doing that would be creating
 * rows in verticals they are scoped out of, which is the one thing the scoping
 * exists to prevent. Narrowing the import to their own verticals was the other
 * option and it is worse: half a sheet imported, with no sign of the half that
 * was not.
 */
const express = require("express");
const SheetSource = require("../models/SheetSource");
const { auth, adminOnly, ah } = require("../middleware/auth");
const sheetImport = require("../services/sheetImport");
const sheet = require("../services/sheet");

const router = express.Router();

/** The single source document, created on first use. */
async function source() {
  let doc = await SheetSource.findOne({ key: "payouts" });
  if (!doc) doc = await SheetSource.create({ key: "payouts" });
  return doc;
}

const shape = (d) => ({
  url: d.url || "",
  lastRunAt: d.lastRunAt,
  lastRunBy: d.lastRunBy || "",
  lastResult: d.lastResult || "",
  lastError: d.lastError || "",
  lastCounts: d.lastCounts || {},
});

router.get("/sheet", auth, adminOnly, ah(async (req, res) => {
  res.json(shape(await source()));
}));

/** Remember the URL. Saving does not import — that is a separate, deliberate act. */
router.put("/sheet", auth, adminOnly, ah(async (req, res) => {
  const doc = await source();
  doc.url = String((req.body || {}).url || "").trim().slice(0, 1000);
  await doc.save();
  res.json(shape(doc));
}));

/*
 * What a run would do, without doing it.
 *
 * The URL may come in the body so it can be tried before it is saved — pasting a
 * link and being told what is in it is how you find out you copied the wrong tab.
 */
router.post("/sheet/preview", auth, adminOnly, ah(async (req, res) => {
  const url = String((req.body || {}).url || "").trim() || (await source()).url;
  const out = await sheetImport.run(url, req.user, { commit: false });
  res.json({ ...out, csvUrl: sheet.toCsvUrl(url) });
}));

router.post("/sheet/import", auth, adminOnly, ah(async (req, res) => {
  const doc = await source();
  const url = String((req.body || {}).url || "").trim() || doc.url;

  let out;
  try {
    out = await sheetImport.run(url, req.user, { commit: true });
  } catch (e) {
    /*
     * A failed run is recorded too. "Last synced 3 days ago" is only useful if a
     * run that could not read the sheet says so — otherwise the line stays at the
     * last time it worked and reads as healthy.
     */
    doc.lastRunAt = new Date();
    doc.lastRunBy = req.user.name;
    doc.lastResult = "failed";
    doc.lastError = e.detail || e.code || e.message;
    await doc.save();
    throw e;
  }

  doc.url = url;
  doc.lastRunAt = new Date();
  doc.lastRunBy = req.user.name;
  doc.lastResult = "ok";
  doc.lastError = "";
  doc.lastCounts = out.counts;
  await doc.save();

  res.json({ ...out, source: shape(doc) });
}));

module.exports = router;
