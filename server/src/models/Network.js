const mongoose = require("mongoose");

/*
 * The network / advertiser that owes money.
 *
 * Deliberately a real collection rather than free text on the payout. The SQLite
 * build learned this the hard way with verticals: people typed "igaming" and
 * "iGaming" and the data split in two, which needed a one-off merge migration to
 * repair. Networks would go the same way, so the name is unique here and the route
 * rejects case-insensitive duplicates.
 *
 * netTerms is the payment delay in days (net-30 / net-45 / net-60). A payout's
 * expectedDate is derived from it unless one is given explicitly.
 */
const networkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    netTerms: { type: Number, default: 30 },
    defaultCurrency: { type: String, default: "USD", uppercase: true, trim: true },
    contact: { type: String, default: "" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["approved", "pending"], default: "approved", index: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Number, default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Network", networkSchema);
