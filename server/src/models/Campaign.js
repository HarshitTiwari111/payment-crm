const mongoose = require("mongoose");

/*
 * A campaign name, registered so the Payments filters can offer a real dropdown
 * instead of hoping everyone spells it the same way.
 *
 * The CRM has no campaign-level revenue data — a month row only stores a person's
 * daily spend and revenue totals — so a campaign here is a label for grouping
 * payouts, not a source of money figures. Payouts still store the campaign as a
 * plain string, and the route registers unseen names automatically, so nothing
 * breaks if someone types a new one.
 */
const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    vertical: { type: String, default: "", index: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Number, default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

campaignSchema.index({ name: 1, vertical: 1 }, { unique: true });

module.exports = mongoose.model("Campaign", campaignSchema);
