const mongoose = require("mongoose");
const { nextId } = require("./Counter");

/* A sub-vertical inside a vertical (e.g. Nutra / Facebook). */
const subSchema = new mongoose.Schema({
  id: { type: Number, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  vertical: { type: String, default: "", index: true },
  createdBy: { type: Number, default: null },
  createdByName: { type: String, default: "" },
}, { timestamps: true });

subSchema.index({ name: 1, vertical: 1 }, { unique: true });

subSchema.pre("save", async function (next) {
  if (this.isNew && this.id == null) this.id = await nextId("subcategories");
  next();
});

module.exports = mongoose.model("Subcategory", subSchema);
