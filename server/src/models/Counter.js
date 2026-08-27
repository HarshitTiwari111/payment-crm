const mongoose = require("mongoose");

/*
 * Auto-increment numeric ids.
 *
 * Why not plain ObjectIds? Every collection here refers to people and rows by a
 * small integer (an audit line's target, a payout's parent, a carry-forward's
 * origin), and those ids show up in the UI — "carried from #2" is readable in a way
 * a 24-character hex string is not. Mongo still keeps its own _id underneath; `id`
 * is just the stable business key.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },   // collection name
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

/** Next id for a collection. Atomic — safe under concurrent inserts. */
async function nextId(name, session = null) {
  const q = Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (session) q.session(session);
  const doc = await q;
  return doc.seq;
}

/** After importing rows with explicit ids, push the counter past the highest one. */
async function bumpTo(name, value) {
  if (!value) return;
  await Counter.findByIdAndUpdate(
    name,
    { $max: { seq: Number(value) } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = { Counter, nextId, bumpTo };
