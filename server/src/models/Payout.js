const mongoose = require("mongoose");
const { nextId } = require("./Counter");

/*
 * One expected receivable: what a network owes for a campaign + vertical in an
 * earning month.
 *
 * The same campaign running on three networks is three payouts, each with its own
 * amount and expected date — that is the whole point of the model.
 *
 * The three running totals are never written by hand; recalcPayout() in
 * services/payouts.js rebuilds them from the payout's transactions, so they can
 * always be re-derived if anything ever looks wrong.
 *
 *   amountExpected = what the network owes (revenue owed, not profit)
 *   amountReceived = cash that actually arrived
 *   amountCut      = permanently lost to validation / scrub / chargebacks
 *   amountCarried  = slipped to a later month (becomes a child payout)
 *
 * A payout is settled when received + cut + carried >= expected.
 */
const payoutSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true },

    campaign: { type: String, default: "", index: true },
    network: { type: String, required: true, index: true },
    vertical: { type: String, default: "", index: true },

    earnedMonth: { type: String, required: true, index: true },   // YYYY-MM
    amountExpected: { type: Number, default: 0 },
    expectedDate: { type: String, default: "", index: true },     // YYYY-MM-DD
    netTerms: { type: Number, default: null },                    // days, snapshot of the network's terms
    currency: { type: String, default: "USD", uppercase: true },

    status: {
      type: String,
      enum: ["pending", "partial", "received", "overdue", "written_off"],
      default: "pending",
      index: true,
    },

    amountReceived: { type: Number, default: 0 },
    amountCut: { type: Number, default: 0 },
    amountCarried: { type: Number, default: 0 },

    // set when this payout was auto-created by a carry-forward; points at the origin
    parentId: { type: Number, default: null, index: true },

    /*
     * How this one is going to be paid, and the account it lands in.
     *
     * One method, not three flags: a payout arrives one way. Keeping it as a single
     * field means the two can never disagree — there is no state where a row claims
     * both bank and crypto, because there is nowhere to write it.
     *
     * `payAccount` holds whichever identifier the method calls for (bank name,
     * PayPal id, wallet id). It is a label to pay against, not a credential.
     */
    payMethod: { type: String, enum: ["", "bank", "paypal", "crypto"], default: "" },
    payAccount: { type: String, default: "" },

    writeOffReason: { type: String, default: "" },
    overdueNotifiedAt: { type: Date, default: null },   // so the Telegram alert fires once, not every scan

    note: { type: String, default: "" },
    createdBy: { type: Number, default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

payoutSchema.index({ earnedMonth: 1, network: 1, vertical: 1 });
payoutSchema.index({ status: 1, expectedDate: 1 });

payoutSchema.pre("save", async function (next) {
  if (this.isNew && this.id == null) this.id = await nextId("payouts");
  next();
});

/** Still owed: expected minus everything accounted for. Never negative. */
payoutSchema.virtual("amountPending").get(function () {
  const settled = (this.amountReceived || 0) + (this.amountCut || 0) + (this.amountCarried || 0);
  return Math.round(Math.max(0, (this.amountExpected || 0) - settled) * 100) / 100;
});

payoutSchema.set("toJSON", { virtuals: true });
payoutSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Payout", payoutSchema);
