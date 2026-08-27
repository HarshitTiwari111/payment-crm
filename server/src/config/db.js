const mongoose = require("mongoose");
const { MONGODB_URI } = require("./env");

async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  const { host, port, name } = mongoose.connection;
  console.log(`  MongoDB connected → ${host}:${port}/${name}`);
  return mongoose.connection;
}

/*
 * Multi-document transactions need a replica set. A standalone `mongod` (the usual
 * local install) does not have one, so `session.withTransaction` throws there.
 * Reconciling a payout must still work on both, so we probe once and fall back to
 * running the same callback without a session. Atlas / any replica set gets real
 * atomicity; a standalone dev box gets the writes in order.
 */
let _txnSupport = null;
async function supportsTransactions() {
  if (_txnSupport !== null) return _txnSupport;
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    _txnSupport = !!(info.setName || info.msg === "isdbgrid");
  } catch (e) {
    _txnSupport = false;
  }
  if (!_txnSupport) {
    console.warn("  NOTE: MongoDB is standalone (no replica set) — multi-document transactions are disabled.");
    console.warn("        Reconcile still runs, just without atomic rollback. Use Atlas or a replica set in production.");
  }
  return _txnSupport;
}

/** Run `fn(session)` inside a transaction when the server supports one, else plainly. */
async function withTransaction(fn) {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally {
      session.endSession();
    }
  }
  return fn(null);
}

module.exports = { connectDB, withTransaction, supportsTransactions };
