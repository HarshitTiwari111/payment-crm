/*
 * Run the API against a throwaway MongoDB, with no install needed.
 *
 *   npm run dev:memory
 *
 * It starts a real mongod as a single-node REPLICA SET, which matters: multi-document
 * transactions only work on a replica set, so reconcile runs here exactly as it will
 * against Atlas. The first run downloads a mongod binary (~100 MB) and caches it.
 *
 * The data lives only as long as the process. For anything you want to keep, point
 * MONGODB_URI at a real server and use `npm run dev`.
 */
const path = require("path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

async function main() {
  console.log("  Starting a temporary MongoDB (first run downloads the binary)…");
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri("payment-crm");
  process.env.MONGODB_URI = uri;
  console.log(`  Temporary MongoDB ready → ${uri}`);
  console.log("  ⚠️  In-memory only: everything here disappears when you stop the server.\n");

  const shutdown = async () => {
    try { await replSet.stop(); } catch (e) { /* going down anyway */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  require(path.join(__dirname, "..", "src", "index.js"));
}

main().catch((e) => {
  console.error("  Could not start the temporary MongoDB:", e.message);
  console.error("  Install MongoDB locally or set MONGODB_URI to an Atlas cluster instead.");
  process.exit(1);
});
