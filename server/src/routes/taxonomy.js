/*
 * Verticals and sub-verticals.
 *
 * Vertical names are the join key for every receivables report, so a
 * case-insensitive duplicate is rejected outright — letting "igaming" exist beside
 * "iGaming" is how the numbers split in two and quietly stop adding up.
 */
const express = require("express");
const Vertical = require("../models/Vertical");
const Subcategory = require("../models/Subcategory");
const { auth, adminOnly, roles, ah } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const S = require("../validation/schemas");
const { logAudit } = require("../utils/audit");
const { escapeRegex } = require("../utils/helpers");

const router = express.Router();

/* --------------------------------------------------------------- verticals */

router.get("/verticals", auth, ah(async (req, res) => {
  const rows = await Vertical.find({ status: "approved" }).select("name").sort({ name: 1 }).lean();
  res.json(rows.map((r) => r.name));
}));

router.post("/verticals", auth, roles("admin", "manager"), validate({ body: S.verticalName }), ah(async (req, res) => {
  const name = String((req.body || {}).name || "").trim();
  if (!name) return res.status(400).json({ error: "empty" });
  const dupe = await Vertical.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, "i") }).lean();
  if (dupe) return res.status(409).json({ error: "exists" });
  try {
    await Vertical.create({ name, status: "approved", requestedBy: req.user.id, requestedByName: req.user.name });
  } catch (e) {
    return res.status(409).json({ error: "exists" });
  }
  await logAudit(req.user, "vertical_proposed", null, null, `${name} added`);
  res.json({ ok: true, status: "approved" });
}));

/** Removing a vertical drops its sub-verticals too. Payouts keep the name they were filed under. */
router.delete("/verticals/:name", auth, adminOnly, ah(async (req, res) => {
  const name = req.params.name;
  await Vertical.deleteOne({ name });
  await Subcategory.deleteMany({ vertical: name });
  await logAudit(req.user, "vertical_rejected", null, null, `${name} removed`);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------- sub-verticals */

router.get("/subcategories", auth, ah(async (req, res) => {
  const v = req.query.vertical;
  const rows = v
    ? await Subcategory.find({ vertical: v }).sort({ name: 1 }).lean()
    : await Subcategory.find({}).sort({ vertical: 1, name: 1 }).lean();
  res.json(rows);
}));

router.post("/subcategories", auth, roles("admin", "manager"), validate({ body: S.subcategory }), ah(async (req, res) => {
  const name = String((req.body || {}).name || "").trim();
  const vertical = String((req.body || {}).vertical || "").trim();
  if (!name) return res.status(400).json({ error: "empty" });
  try {
    const s = await Subcategory.create({ name, vertical, createdBy: req.user.id, createdByName: req.user.name });
    await logAudit(req.user, "subcategory_created", null, null, `${vertical} / ${name}`);
    res.json({ id: s.id });
  } catch (e) {
    res.status(409).json({ error: "exists" });
  }
}));

router.delete("/subcategories/:id", auth, roles("admin", "manager"), ah(async (req, res) => {
  await Subcategory.deleteOne({ id: Number(req.params.id) });
  res.json({ ok: true });
}));

module.exports = router;
