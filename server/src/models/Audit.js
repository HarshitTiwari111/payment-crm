const mongoose = require("mongoose");
const { nextId } = require("./Counter");

/* Append-only trail. Every write that matters lands here (and goes to Telegram). */
const auditSchema = new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  ts: { type: Date, default: Date.now, index: true },
  actorId: { type: Number, default: null },
  actorName: { type: String, default: "" },
  action: { type: String, default: "", index: true },
  targetUserId: { type: Number, default: null, index: true },
  month: { type: String, default: null },
  detail: { type: String, default: "" },
}, { timestamps: true });

auditSchema.pre("save", async function (next) {
  if (this.isNew && this.id == null) this.id = await nextId("audit");
  next();
});

module.exports = mongoose.model("Audit", auditSchema);
