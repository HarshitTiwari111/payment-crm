const mongoose = require("mongoose");
const { nextId } = require("./Counter");

/*
 * Two roles, and only two: admin and manager.
 *
 *  - admin   : the whole company. Sees every vertical, manages accounts.
 *  - manager : runs their own verticals. Sees and settles the money owed in those
 *              verticals, and nothing outside them.
 *
 * There is no member/leader tier here, so there is no reporting line to store —
 * a manager's scope is decided entirely by the verticals on their account.
 */
const userSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "manager"], default: "manager", index: true },
    active: { type: Boolean, default: true, index: true },

    vertical: { type: String, default: "" },
    verticals: { type: [String], default: [] },

    /* ---- security ---- */

    // TOTP. The confirmed secret only lands in twoFactorSecret once the person has
    // proved they can generate a code from it, so a half-finished setup can never
    // lock them out of their own account.
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, default: "", select: false },
    twoFactorPending: { type: String, default: "", select: false },
    // single-use codes for when the phone is lost; stored hashed
    recoveryCodes: { type: [String], default: [], select: false },

    // brute-force protection
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    // any token issued before this instant is refused — changing a password or
    // signing out everywhere sets it, which invalidates stolen tokens immediately
    tokensValidFrom: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },

    // device fingerprints this person has signed in from before
    knownDevices: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: "" },
  },
  { timestamps: true }
);

userSchema.pre("save", async function assignId(next) {
  if (this.isNew && (this.id === undefined || this.id === null)) {
    this.id = await nextId("users");
  }
  next();
});

/** Shape sent to the client — never includes the password hash. */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    username: this.username,
    name: this.name,
    role: this.role,
    active: this.active,
    vertical: this.vertical || "",
    verticals: this.verticals || [],
    twoFactorEnabled: !!this.twoFactorEnabled,
    lastLoginAt: this.lastLoginAt || null,
  };
};

module.exports = mongoose.model("User", userSchema);
