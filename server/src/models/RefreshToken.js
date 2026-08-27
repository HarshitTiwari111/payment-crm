const mongoose = require("mongoose");

/*
 * Refresh tokens, one document per active session.
 *
 * The raw token is never stored — only a SHA-256 of it — so a dump of this
 * collection cannot be replayed as a login. Each refresh ROTATES: the old row is
 * revoked and a new one issued. If a revoked token is ever presented again it
 * means a copy was stolen, and every session for that user is killed on the spot.
 */
const refreshSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: Number, required: true, index: true },

  // what asked for it, so a person can recognise their own sessions
  deviceHash: { type: String, default: "", index: true },
  userAgent: { type: String, default: "" },
  ip: { type: String, default: "" },

  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: String, default: null },
  lastUsedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// expired rows clean themselves up
refreshSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshSchema);
