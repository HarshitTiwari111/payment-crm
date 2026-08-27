/*
 * End-to-end API check for Payment CRM.
 *
 * Drives the real server over HTTP with real cookies, so it exercises the same path
 * the browser does: sessions, role gates, vertical scoping, the payout ledger and
 * every report. Run against a throwaway database — it writes.
 */
const BASE = process.env.API || "http://127.0.0.1:4000";

let pass = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** A browser-ish session: one cookie jar, optional "view as" header. */
function session() {
  const jar = new Map();
  let viewAs = null;
  const call = async (method, url, body, extra = {}) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (viewAs) headers["X-View-As"] = String(viewAs);
    Object.assign(headers, extra.headers || {});
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const res = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (v === "" || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  return {
    get: (u, e) => call("GET", u, undefined, e),
    post: (u, b, e) => call("POST", u, b ?? {}, e),
    put: (u, b) => call("PUT", u, b ?? {}),
    del: (u) => call("DELETE", u, undefined),
    viewAs: (id) => { viewAs = id; },
    jar,
  };
}

const money = (n) => Math.round(n * 100) / 100;

async function main() {
  console.log("\n=== health ===");
  const anon = session();
  const health = await anon.get("/api/health");
  ok("health responds", health.status === 200 && health.data.ok === true);

  console.log("\n=== auth ===");
  eq("unauthenticated /api/me is 401", (await anon.get("/api/me")).status, 401);
  eq("wrong password rejected", (await anon.post("/api/login", { username: "admin", password: "nope1234" })).status, 401);
  eq("short password rejected by validation", (await anon.post("/api/login", { username: "", password: "" })).status, 400);

  const admin = session();
  const login = await admin.post("/api/login", { username: "admin", password: "changeme123" });
  ok("admin can sign in", login.status === 200 && login.data.role === "admin");
  eq("session cookies issued", [admin.jar.has("token"), admin.jar.has("rtoken")], [true, true]);
  eq("/api/me returns the admin", (await admin.get("/api/me")).data.username, "admin");
  eq("refresh rotates the session", (await admin.post("/api/refresh")).status, 200);
  eq("/api/me still works after refresh", (await admin.get("/api/me")).status, 200);

  console.log("\n=== verticals & sub-verticals ===");
  const verts = await admin.get("/api/verticals");
  ok("seeded verticals present", verts.data.includes("Nutra") && verts.data.includes("CPS"), JSON.stringify(verts.data));
  eq("new vertical accepted", (await admin.post("/api/verticals", { name: "Sweepstakes" })).status, 200);
  eq("exact duplicate rejected", (await admin.post("/api/verticals", { name: "Sweepstakes" })).status, 409);
  eq("case duplicate rejected", (await admin.post("/api/verticals", { name: "sweepstakes" })).status, 409);
  eq("empty vertical name rejected", (await admin.post("/api/verticals", { name: "" })).status, 400);
  const sub = await admin.post("/api/subcategories", { name: "Facebook", vertical: "Nutra" });
  ok("sub-vertical created", sub.status === 200 && typeof sub.data.id === "number");
  ok("sub-vertical listed", (await admin.get("/api/subcategories")).data.some((s) => s.name === "Facebook"));
  eq("sub-vertical removed", (await admin.del(`/api/subcategories/${sub.data.id}`)).status, 200);
  eq("vertical removed", (await admin.del("/api/verticals/Sweepstakes")).status, 200);
  ok("removed vertical is gone", !(await admin.get("/api/verticals")).data.includes("Sweepstakes"));

  console.log("\n=== accounts ===");
  const weak = await admin.post("/api/users", { name: "Weak", username: "weak", password: "abc", role: "manager", verticals: ["CPS"] });
  eq("weak password rejected", weak.status, 400);
  const priya = await admin.post("/api/users", { name: "Priya Sharma", username: "priya", password: "manager123", role: "manager", verticals: ["Pay Per Call"] });
  const raj = await admin.post("/api/users", { name: "Raj Verma", username: "raj", password: "manager123", role: "manager", verticals: ["CPS", "Nutra"] });
  ok("manager Priya created", priya.status === 200 && priya.data.id > 1);
  ok("manager Raj created", raj.status === 200);
  eq("duplicate username rejected", (await admin.post("/api/users", { name: "Dup", username: "priya", password: "manager123", role: "manager", verticals: ["CPS"] })).status, 409);
  const users = await admin.get("/api/users");
  eq("three accounts listed", users.data.length, 3);
  ok("admin row shows no verticals", users.data.find((u) => u.username === "admin").verticals.length === 0);
  eq("Raj holds two verticals", users.data.find((u) => u.username === "raj").verticals, ["CPS", "Nutra"]);
  eq("admin cannot edit their own account", (await admin.put(`/api/users/1`, { name: "Renamed" })).status, 403);
  eq("last admin cannot be demoted", (await admin.put(`/api/users/1`, { name: "Administrator", role: "manager" })).status, 403);
  eq("rename a manager", (await admin.put(`/api/users/${raj.data.id}`, { name: "Raj Verma", role: "manager", verticals: ["CPS", "Nutra"] })).status, 200);

  console.log("\n=== networks & campaigns ===");
  const net = await admin.post("/api/networks", { name: "AdCombo", netTerms: 30, defaultCurrency: "USD" });
  ok("network created", net.status === 200);
  eq("duplicate network rejected", (await admin.post("/api/networks", { name: "adcombo" })).status, 409);
  await admin.post("/api/networks", { name: "MaxBounty", netTerms: 45 });
  eq("two networks listed", (await admin.get("/api/networks")).data.length, 2);
  eq("network net terms updated", (await admin.put(`/api/networks/${net.data._id}`, { name: "AdCombo", netTerms: 15 })).status, 200);
  eq("net terms are back to 30", (await admin.put(`/api/networks/${net.data._id}`, { name: "AdCombo", netTerms: 30 })).status, 200);
  ok("campaign registered", (await admin.post("/api/campaigns", { name: "Nutra-Aug-FB", vertical: "Nutra" })).status === 200);

  console.log("\n=== payouts: create & validate ===");
  eq("payout with no amount rejected", (await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 0 })).status, 400);
  eq("payout with a bad month rejected", (await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-13", amountExpected: 100 })).status, 400);
  eq("payout with no network rejected", (await admin.post("/api/payouts", { network: "", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 100 })).status, 400);

  const p1 = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 12500, netTerms: 30, campaign: "CPS-Aug" });
  const p2 = await admin.post("/api/payouts", { network: "AdCombo", vertical: "Pay Per Call", earnedMonth: "2026-08", amountExpected: 4200, netTerms: 15 });
  const p3 = await admin.post("/api/payouts", { network: "MaxBounty", vertical: "Nutra", earnedMonth: "2026-08", amountExpected: 8000, netTerms: 45 });
  ok("three payouts created", [p1, p2, p3].every((r) => r.status === 200));
  eq("net-30 on August lands 30 Sept", p1.data.expectedDate, "2026-09-30");
  eq("net-15 on August lands 15 Sept", p2.data.expectedDate, "2026-09-15");
  eq("net-45 on August lands 15 Oct", p3.data.expectedDate, "2026-10-15");
  eq("a fresh payout is pending", p1.data.status, "pending");
  eq("pending equals the full amount", p1.data.pending, 12500);

  console.log("\n=== payouts: list, filter, page ===");
  const all = await admin.get("/api/payouts");
  eq("all three listed", all.data.total, 3);
  eq("totals add up", all.data.totals.expected, 24700);
  eq("filter by vertical", (await admin.get("/api/payouts?vertical=CPS")).data.total, 1);
  eq("vertical filter is case-insensitive", (await admin.get("/api/payouts?vertical=cps")).data.total, 1);
  eq("filter by network", (await admin.get("/api/payouts?network=MaxBounty")).data.total, 1);
  eq("filter by earned month", (await admin.get("/api/payouts?month=2026-08")).data.total, 3);
  eq("filter by a month with nothing in it", (await admin.get("/api/payouts?month=2026-01")).data.total, 0);
  eq("filter by status", (await admin.get("/api/payouts?status=pending")).data.total, 3);
  eq("free-text search hits the campaign", (await admin.get("/api/payouts?q=CPS-Aug")).data.total, 1);
  eq("overdue filter finds nothing yet", (await admin.get("/api/payouts?overdue=1")).data.total, 0);
  const paged = await admin.get("/api/payouts?limit=2&page=1");
  eq("page one holds two rows", [paged.data.items.length, paged.data.pages], [2, 2]);
  eq("page two holds the third", (await admin.get("/api/payouts?limit=2&page=2")).data.items.length, 1);

  console.log("\n=== payouts: edit ===");
  const edited = await admin.put(`/api/payouts/${p1.data.id}`, { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 13000, netTerms: 30, campaign: "CPS-Aug" });
  eq("amount edited", edited.data.amountExpected, 13000);
  eq("still pending after the edit", edited.data.status, "pending");
  const reverted = await admin.put(`/api/payouts/${p1.data.id}`, { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 12500, netTerms: 30, campaign: "CPS-Aug" });
  eq("amount restored", reverted.data.amountExpected, 12500);

  console.log("\n=== payouts: the ledger ===");
  const partial = await admin.post(`/api/payouts/${p1.data.id}/reconcile`, { date: "2026-09-28", amountReceived: 5000 });
  eq("partial payment recorded", partial.status, 200);
  eq("status becomes partial", partial.data.payout.status, "partial");
  eq("received tracked", partial.data.payout.amountReceived, 5000);
  eq("pending is the remainder", partial.data.payout.pending, 7500);

  const settle = await admin.post(`/api/payouts/${p1.data.id}/reconcile`, {
    date: "2026-10-05", amountReceived: 5000, deduction: 500, deductionReason: "validation",
    carriedForward: 2000, carriedToMonth: "2026-10",
  });
  eq("settlement recorded", settle.status, 200);
  eq("received is the running total", settle.data.payout.amountReceived, 10000);
  eq("cut is recorded", settle.data.payout.amountCut, 500);
  eq("carry is recorded", settle.data.payout.amountCarried, 2000);
  eq("nothing left pending", settle.data.payout.pending, 0);
  eq("status is received", settle.data.payout.status, "received");
  ok("a carry-forward child was created", !!settle.data.child, JSON.stringify(settle.data.child));
  eq("the child owes the carried amount", settle.data.child?.amountExpected, 2000);
  eq("the child points back at its parent", settle.data.child?.parentId, p1.data.id);
  // Still August money — the carry only moves WHEN it is expected, not when it was earned.
  eq("the child keeps the earned month", settle.data.child?.earnedMonth, "2026-08");
  eq("the child is due in the carry month", settle.data.child?.expectedDate?.slice(0, 7), "2026-10");

  const txns = await admin.get(`/api/payouts/${p1.data.id}/txns`);
  eq("two transactions on the ledger", txns.data.length, 2);

  // An adjustment is a DELTA posted as its own row, never an edit of the original.
  const adj = await admin.post(`/api/payouts/${p1.data.id}/adjust`, { txnId: txns.data[0].id, amountReceived: -1000, note: "bank returned 1000" });
  eq("adjustment accepted", adj.status, 200);
  eq("received re-derived from the ledger", adj.data.payout.amountReceived, 9000);
  eq("status falls back to partial", adj.data.payout.status, "partial");
  eq("pending reopens", adj.data.payout.pending, 1000);
  const afterAdj = await admin.get(`/api/payouts/${p1.data.id}/txns`);
  eq("the adjustment is a third row, not an edit", afterAdj.data.length, 3);
  eq("and it points at the entry it corrects", afterAdj.data.find((t) => t.reversalOf)?.reversalOf, txns.data[0].id);
  eq("the original entry is untouched", afterAdj.data.find((t) => t.id === txns.data[0].id).amountReceived, 5000);
  const undo = await admin.post(`/api/payouts/${p1.data.id}/adjust`, { txnId: txns.data[0].id, amountReceived: 1000, note: "re-cleared" });
  eq("a second adjustment nets back out", undo.data.payout.amountReceived, 10000);
  eq("and the payout settles again", undo.data.payout.status, "received");

  console.log("\n=== payouts: write-off ===");
  const wo = await admin.post(`/api/payouts/${p3.data.id}/writeoff`, { reason: "network went dark" });
  eq("written off", wo.data.status, "written_off");
  eq("write-off drops out of pending", (await admin.get("/api/payouts")).data.totals.pending, money((await admin.get("/api/payouts")).data.items.filter((p) => p.status !== "written_off").reduce((a, p) => a + p.pending, 0)));
  const unwo = await admin.post(`/api/payouts/${p3.data.id}/unwriteoff`);
  ok("write-off reversed back to a live status", unwo.data.status !== "written_off", unwo.data.status);

  console.log("\n=== payouts: delete ===");
  const throwaway = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-07", amountExpected: 100 });
  eq("a clean payout can be deleted", (await admin.del(`/api/payouts/${throwaway.data.id}`)).status, 200);
  const withHistory = await admin.del(`/api/payouts/${p1.data.id}`);
  eq("a payout with a ledger cannot be deleted", withHistory.status, 409);
  eq("and it says why, in the code the UI reads", withHistory.data.error, "has_history");

  console.log("\n=== dashboard, calendar, reports ===");
  const dash = await admin.get("/api/payouts/summary/2026-08");
  ok("dashboard returns its cards", dash.status === 200 && dash.data.outstanding && dash.data.earned);
  const cal = await admin.get("/api/payouts/calendar?from=2026-08&months=6");
  ok("calendar groups by month", Array.isArray(cal.data) && cal.data.length > 0);
  ok("calendar months are inside the window", cal.data.every((g) => g.month === "overdue" || (g.month >= "2026-08" && g.month <= "2027-01")), JSON.stringify(cal.data.map((g) => g.month)));
  const earned = await admin.get("/api/payouts/reports/earned/2026-08");
  // four, not three: the carry-forward child is August money too
  eq("earned report counts August, carry included", earned.data.total.count, 4);
  ok("earned report splits by network", earned.data.byNetwork.length === 2, JSON.stringify(earned.data.byNetwork.map((n) => n.network)));
  const recv = await admin.get("/api/payouts/reports/received/2026-10");
  ok("received report reads the cash month", recv.data.total.received > 0, JSON.stringify(recv.data.total));
  const rel = await admin.get("/api/payouts/reports/networks");
  ok("network reliability lists both networks", rel.data.length === 2, JSON.stringify(rel.data.map((n) => n.network)));
  ok("every reliability row is named", rel.data.every((n) => !!n.network));
  const trend = await admin.get("/api/payouts/reports/trend?months=6&to=2026-08");
  eq("trend returns six months", trend.data.length, 6);
  eq("trend ends on the asked month", trend.data[5].month, "2026-08");
  ok("trend carries the receivables shape", "expected" in trend.data[0] && "collected" in trend.data[0], JSON.stringify(trend.data[0]));

  console.log("\n=== manager scope ===");
  const mgr = session();
  const mlogin = await mgr.post("/api/login", { username: "priya", password: "manager123" });
  eq("manager can sign in", mlogin.status, 200);
  eq("manager sees only their vertical's payouts", (await mgr.get("/api/payouts")).data.total, 1);
  eq("and only that money", (await mgr.get("/api/payouts")).data.totals.expected, 4200);
  eq("manager dashboard is scoped", (await mgr.get("/api/payouts/summary/2026-08")).data.outstanding.expected, 4200);
  eq("manager reports are scoped", (await mgr.get("/api/payouts/reports/earned/2026-08")).data.total.count, 1);
  eq("manager cannot create an account", (await mgr.post("/api/users", { name: "X", username: "x9", password: "manager123", role: "admin" })).status, 403);
  eq("manager cannot delete an account", (await mgr.del("/api/users/3")).status, 403);
  eq("manager cannot delete a vertical", (await mgr.del("/api/verticals/MetAds")).status, 403);
  eq("manager cannot delete a network", (await mgr.del(`/api/networks/${net.data._id}`)).status, 403);
  ok("manager can add a vertical", (await mgr.post("/api/verticals", { name: "Crypto" })).status === 200);
  eq("manager cannot file a payout outside their verticals", (await mgr.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 500 })).status, 403);
  const mine = await mgr.post("/api/payouts", { network: "AdCombo", vertical: "Pay Per Call", earnedMonth: "2026-09", amountExpected: 500 });
  eq("manager can file inside their own", mine.status, 200);
  eq("manager cannot open another vertical's payout", (await mgr.get(`/api/payouts/${p1.data.id}`)).status, 403);
  eq("manager cannot reconcile another vertical's payout", (await mgr.post(`/api/payouts/${p1.data.id}/reconcile`, { amountReceived: 1 })).status, 403);
  await mgr.del(`/api/payouts/${mine.data.id}`);

  console.log("\n=== view team ===");
  admin.viewAs(priya.data.id);
  eq("admin viewing Priya sees her one payout", (await admin.get("/api/payouts")).data.total, 1);
  eq("and her total", (await admin.get("/api/payouts")).data.totals.expected, 4200);
  eq("her dashboard too", (await admin.get("/api/payouts/summary/2026-08")).data.outstanding.expected, 4200);
  eq("admin viewing Priya cannot file outside her verticals", (await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 1 })).status, 403);
  admin.viewAs(raj.data.id);
  eq("admin viewing Raj sees his two verticals", (await admin.get("/api/payouts")).data.total, 3);
  admin.viewAs(1);
  eq("pointing the lens at yourself changes nothing", (await admin.get("/api/payouts")).data.total, 4);
  admin.viewAs(null);
  eq("lens off, the admin sees everything", (await admin.get("/api/payouts")).data.total, 4);

  console.log("\n=== the lens cannot be abused ===");
  mgr.viewAs(raj.data.id);
  eq("a manager cannot look through another manager", (await mgr.get("/api/payouts")).data.total, 1);
  mgr.viewAs(1);
  eq("a manager cannot look through the admin", (await mgr.get("/api/payouts")).data.total, 1);
  mgr.viewAs(null);
  admin.viewAs(99999);
  eq("an unknown id falls back to the caller", (await admin.get("/api/payouts")).data.total, 4);
  admin.viewAs(null);

  console.log("\n=== deactivate & restore ===");
  eq("manager deactivated", (await admin.del(`/api/users/${priya.data.id}`)).status, 200);
  const priya2 = session();
  eq("a deactivated account cannot sign in", (await priya2.post("/api/login", { username: "priya", password: "manager123" })).status, 401);
  eq("their live session is revoked", (await mgr.get("/api/payouts")).status, 401);
  eq("account restored", (await admin.post(`/api/users/${priya.data.id}/reactivate`)).status, 200);
  const priya3 = session();
  eq("and can sign in again", (await priya3.post("/api/login", { username: "priya", password: "manager123" })).status, 200);
  eq("with their data intact", (await priya3.get("/api/payouts")).data.total, 1);
  eq("admin cannot be deactivated", (await admin.del("/api/users/1")).status, 403);

  console.log("\n=== password & sessions ===");
  eq("admin resets a manager password", (await admin.post(`/api/users/${priya.data.id}/password`, { password: "newpass123" })).status, 200);
  eq("the reset kills the old session", (await priya3.get("/api/me")).status, 401);
  const priya4 = session();
  eq("old password no longer works", (await priya4.post("/api/login", { username: "priya", password: "manager123" })).status, 401);
  eq("new password works", (await priya4.post("/api/login", { username: "priya", password: "newpass123" })).status, 200);
  /*
   * 400, deliberately, not 401: the client treats every 401 as a dead session and
   * drops to the login screen, so mistyping your old password would sign you out.
   */
  const badCurrent = await priya4.post("/api/me/password", { current: "wrong", next: "another123" });
  eq("mistyping the current password is a field error, not a dead session", badCurrent.status, 400);
  eq("and the code the modal reads", badCurrent.data.error, "wrong_current");
  eq("changing your own password works", (await priya4.post("/api/me/password", { current: "newpass123", next: "another123" })).status, 200);
  ok("sessions are listed", Array.isArray((await admin.get("/api/me/sessions")).data));
  ok("login history is recorded", (await admin.get("/api/me/login-history")).data.length > 0);

  console.log("\n=== logout ===");
  eq("logout succeeds", (await priya4.post("/api/logout")).status, 200);
  eq("and the session is dead", (await priya4.get("/api/me")).status, 401);

  console.log("\n=== unknown routes ===");
  eq("an unknown API path is a 404", (await admin.get("/api/nope")).status, 404);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("\nTest run crashed:", e); process.exitCode = 1; });
