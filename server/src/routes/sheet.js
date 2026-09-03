/*
 * Importing payouts from a Google Sheet.
 *
 * Both roles, because this is the work the people who keep the sheet actually do.
 *
 * The scoping is not in who may open the screen, it is in what a run brings in: a
 * manager imports the rows in their own verticals and the rest are listed as out of
 * scope, named vertical by vertical. That was the objection to letting them do it at
 * all — half a sheet imported looks the same as all of it — and the answer is to say
 * which half, not to hand the job to someone who does not do it.
 */
const express = require("express");
const SheetSource = require("../models/SheetSource");
const { auth, roles, ah } = require("../middleware/auth");
const sheetImport = require("../services/sheetImport");
const sheet = require("../services/sheet");

const router = express.Router();

/* Both roles; a run is then narrowed to what the caller may file against. */
const canImport = roles("admin", "manager");

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

router.get("/sheet", auth, canImport, ah(async (req, res) => {
  res.json(shape(await source()));
}));

/** Remember the URL. Saving does not import — that is a separate, deliberate act. */
router.put("/sheet", auth, canImport, ah(async (req, res) => {
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
router.post("/sheet/preview", auth, canImport, ah(async (req, res) => {
  const url = String((req.body || {}).url || "").trim() || (await source()).url;
  const vertical = String((req.body || {}).vertical || "").trim();
  const out = await sheetImport.run(url, req.user, { commit: false, scopeUser: req.scopeUser, vertical });
  res.json({ ...out, csvUrl: sheet.toCsvUrl(url) });
}));

router.post("/sheet/import", auth, canImport, ah(async (req, res) => {
  const doc = await source();
  const url = String((req.body || {}).url || "").trim() || doc.url;

  let out;
  try {
    const vertical = String((req.body || {}).vertical || "").trim();
    out = await sheetImport.run(url, req.user, { commit: true, scopeUser: req.scopeUser, vertical });
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
