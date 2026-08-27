const mongoose = require("mongoose");

/*
 * Every sign-in attempt, good or bad.
 *
 * Two jobs: it is the evidence trail when something looks wrong, and it is how the
 * app knows a device is new — if this user has never signed in from this device
 * before, that login is worth telling them about.
 */
const loginEventSchema = new mongoose.Schema({
  userId: { type: Number, default: null, index: true },
  username: { type: String, default: "" },
  success: { type: Boolean, default: false, index: true },
  reason: { type: String, default: "" },      // why it failed
  ip: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  deviceHash: { type: String, default: "", index: true },
  newDevice: { type: Boolean, default: false },
  at: { type: Date, default: Date.now },
}, { timestamps: true });

// keep a year of history, then let it go
loginEventSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model("LoginEvent", loginEventSchema);
