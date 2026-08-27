const mongoose = require("mongoose");

/* Name is the key, exactly as in SQLite. Case-insensitive duplicates are rejected
   at the route so "igaming" can never split data away from "iGaming". */
const verticalSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ["approved", "pending"], default: "approved", index: true },
  requestedBy: { type: Number, default: null },
  requestedByName: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("Vertical", verticalSchema);
