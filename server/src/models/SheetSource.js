const mongoose = require("mongoose");

/*
 * Where payouts are imported from, and how the last run went.
 *
 * One document, not a collection: there is one sheet the payouts come from, and a
 * list would invite two of them quietly importing the same rows twice. `key` is
 * what makes it a singleton — it is unique, and everything here reads and writes
 * the same value for it.
 *
 * The last run is stored beside the URL rather than only logged, because the
 * question people ask is "is this still working?", and that is answered by a line
 * on the screen, not by going to look in the log.
 */
const sheetSourceSchema = new mongoose.Schema({
  key: { type: String, default: "payouts", unique: true, index: true },
  url: { type: String, default: "" },

  lastRunAt: { type: Date, default: null },
  lastRunBy: { type: String, default: "" },
  // "ok" or "failed" — a run that could not read the sheet is not a run with 0 rows
  lastResult: { type: String, default: "" },
  lastError: { type: String, default: "" },
  lastCounts: {
    read: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    reconciled: { type: Number, default: 0 },
    skippedExisting: { type: Number, default: 0 },
    skippedBad: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model("SheetSource", sheetSourceSchema);
