const mongoose = require("mongoose");
const { nextId } = require("./Counter");

/*
 * One reconciliation entry against a payout — a payout can be settled in
 * installments, so a payout has many of these.
 *
 * These rows are IMMUTABLE by design: a correction is a new adjusting
 * transaction, never an edit of an old one, so the trail always shows what was
 * believed at the time. `reversalOf` links an adjustment back to the entry it
 * corrects. The routes enforce this — there is no update handler for a txn.
 *
 *   amountReceived  cash that arrived in this installment
 *   deduction       permanently lost in this installment (+ a reason)
 *   carriedForward  amount slipping to carriedToMonth (spawns a child payout)
 */
const txnSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true },
    payoutId: { type: Number, required: true, index: true },

    date: { type: String, default: "", index: true },   // YYYY-MM-DD, when the cash arrived
    amountReceived: { type: Number, default: 0 },
    deduction: { type: Number, default: 0 },
    deductionReason: {
      type: String,
      enum: ["", "validation", "scrub", "chargeback", "fx", "other"],
      default: "",
    },
    carriedForward: { type: Number, default: 0 },
    carriedToMonth: { type: String, default: "" },      // YYYY-MM

    // the child payout this txn's carry-forward created, if any
    spawnedPayoutId: { type: Number, default: null },
    // set on an adjusting entry that corrects an earlier txn
    reversalOf: { type: Number, default: null },

    note: { type: String, default: "" },
    createdBy: { type: Number, default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

txnSchema.pre("save", async function (next) {
  if (this.isNew && this.id == null) this.id = await nextId("payout_txns");
  next();
});

module.exports = mongoose.model("PayoutTxn", txnSchema);
