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

  /*
   * The spend side. These come off the same sheet row as the revenue, and the
   * numbers below are that sheet's first two rows — one that made money and one
   * that lost it — so the arithmetic can be checked against what it already says.
   */
  const spend = await admin.post("/api/payouts", {
    network: "AdCombo", vertical: "CPS", earnedMonth: "2026-05",
    overallRevenue: 280.21, amountExpected: 252.19, adCost: 89.34,
    externalId: "EST_APM|AdCombo|2026-05",
  });
  eq("reported revenue is kept beside the confirmed one", spend.data.overallRevenue, 280.21);
  eq("...and they are allowed to differ", spend.data.amountExpected, 252.19);
  eq("ad cost is stored", spend.data.adCost, 89.34);
  eq("profit is derived, not typed", spend.data.profit, 162.85);
  eq("the row it came from is remembered", spend.data.externalId, "EST_APM|AdCombo|2026-05");

  const loss = await admin.post("/api/payouts", {
    network: "AdCombo", vertical: "CPS", earnedMonth: "2026-05", amountExpected: 250.11, adCost: 325.91,
  });
  eq("a campaign that cost more than it made reports a loss", loss.data.profit, -75.8);

  const cheaper = await admin.put(`/api/payouts/${spend.data.id}`, { adCost: 52.19 });
  eq("editing the cost re-derives the profit", cheaper.data.profit, 200);
  eq("...without touching what was owed", cheaper.data.amountExpected, 252.19);

  const noCost = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-05", amountExpected: 100 });
  eq("cost is optional, and absent means zero", noCost.data.adCost, 0);
  eq("...so profit is the whole amount", noCost.data.profit, 100);

  for (const r of [spend, loss, noCost]) await admin.del(`/api/payouts/${r.data.id}?confirm=1`);

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

  /*
   * The same correction stated as the figure it should have been. This is what the
   * screen sends: asking for the difference is how someone fixing a typo ends up
   * recording a second payment on top of the first.
   */
  const typo = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-07", amountExpected: 7500 });
  await admin.post(`/api/payouts/${typo.data.id}/reconcile`, { amountReceived: 5444 });
  const typoTxns = await admin.get(`/api/payouts/${typo.data.id}/txns`);
  const fixed = await admin.post(`/api/payouts/${typo.data.id}/adjust`, {
    txnId: typoTxns.data[0].id, setReceived: 4000, setDeduction: 0, note: "typed the wrong figure",
  });
  eq("a corrected figure lands on the figure, not on top of it", fixed.data.payout.amountReceived, 4000);
  eq("the correction posted is the difference", fixed.data.txn.amountReceived, -1444);
  eq("and the original still says what it said", (await admin.get(`/api/payouts/${typo.data.id}/txns`)).data[0].amountReceived, 5444);
  /*
   * Correcting the same entry twice. The second correction is measured from what
   * the entry comes to now, not from the figure first typed into it — otherwise
   * 5,444 → 4,000 → 3,000 posts −1,444 and then −2,444 and lands on 1,556.
   */
  const again = await admin.post(`/api/payouts/${typo.data.id}/adjust`, {
    txnId: typoTxns.data[0].id, setReceived: 3000, note: "3,000 in the end",
  });
  eq("a second correction lands where it says, not where the first one left it", again.data.payout.amountReceived, 3000);
  eq("and it is measured from the corrected figure", again.data.txn.amountReceived, -1000);
  const zeroed = await admin.post(`/api/payouts/${typo.data.id}/adjust`, { txnId: typoTxns.data[0].id, setReceived: 0, note: "never arrived" });
  eq("correcting to zero is allowed, and is not 'no change'", zeroed.data.payout.amountReceived, 0);
  // put the dataset back: every count below this line is asserted against a fixed total
  await admin.del(`/api/payouts/${typo.data.id}?confirm=1`);

  /*
   * A wrong date is not a wrong amount. It decides which month the cash counts in —
   * every cash-basis figure in the app reads it — and no adjusting entry can move it,
   * because there is no arithmetic between two dates. So it moves the entry, and the
   * audit line is the record that it moved.
   */
  const misdated = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-06", amountExpected: 800 });
  await admin.post(`/api/payouts/${misdated.data.id}/reconcile`, { date: "2026-07-02", amountReceived: 800 });
  const mtx = (await admin.get(`/api/payouts/${misdated.data.id}/txns`)).data[0];
  eq("the cash lands in the month it was dated", (await admin.get("/api/payouts/reports/received/2026-07")).data.total.received >= 800, true);

  const moveOnly = await admin.post(`/api/payouts/${misdated.data.id}/adjust`, {
    txnId: mtx.id, setReceived: 800, setDate: "2026-06-28",
  });
  eq("a date correction says what it moved", [moveOnly.data.movedFrom, moveOnly.data.movedTo], ["2026-07-02", "2026-06-28"]);
  eq("...and posts no entry, because there is nothing to post", moveOnly.data.txn, null);
  eq("the ledger still has the one entry", (await admin.get(`/api/payouts/${misdated.data.id}/txns`)).data.length, 1);
  eq("...carrying the corrected date", (await admin.get(`/api/payouts/${misdated.data.id}/txns`)).data[0].date, "2026-06-28");
  eq("the cash moved months with it", (await admin.get("/api/payouts/reports/received/2026-06")).data.total.received, 800);
  eq("...and left the month it was in", (await admin.get("/api/payouts/reports/received/2026-07")).data.total.received, 0);

  /* Date and figures together: the entry moves, and the correction is dated to match. */
  const both = await admin.post(`/api/payouts/${misdated.data.id}/adjust`, {
    txnId: mtx.id, setReceived: 500, setDate: "2026-06-10",
  });
  eq("a combined correction moves and corrects", both.data.payout.amountReceived, 500);
  eq("...and the adjusting entry sits on the new date, not today", both.data.txn.date, "2026-06-10");

  const nothing = await admin.post(`/api/payouts/${misdated.data.id}/adjust`, { txnId: mtx.id, setReceived: 500, setDate: "2026-06-10" });
  eq("correcting nothing is refused rather than written as zeroes", nothing.status, 400);
  eq("...and says so", nothing.data.error, "nothing_to_correct");

  await admin.del(`/api/payouts/${misdated.data.id}?confirm=1`);

  console.log("\n=== payouts: write-off ===");
  const wo = await admin.post(`/api/payouts/${p3.data.id}/writeoff`, { reason: "network went dark" });
  eq("written off", wo.data.status, "written_off");
  eq("write-off drops out of pending", (await admin.get("/api/payouts")).data.totals.pending, money((await admin.get("/api/payouts")).data.items.filter((p) => p.status !== "written_off").reduce((a, p) => a + p.pending, 0)));
  const unwo = await admin.post(`/api/payouts/${p3.data.id}/unwriteoff`);
  ok("write-off reversed back to a live status", unwo.data.status !== "written_off", unwo.data.status);

  console.log("\n=== payouts: delete ===");
  const throwaway = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-07", amountExpected: 100 });
  eq("a clean payout can be deleted", (await admin.del(`/api/payouts/${throwaway.data.id}`)).status, 200);
  /*
   * p1 carried forward earlier, so it is the child that blocks it, not the ledger —
   * and the two are answered separately now, because only one of them can be talked
   * past. Deleting it would strand a payout sitting in a later month with its own
   * entries, so it is refused however plainly the caller asks.
   */
  const stranding = await admin.del(`/api/payouts/${p1.data.id}?confirm=1`);
  eq("a payout that carried forward is refused even when confirmed", stranding.status, 409);
  eq("and says which case it is", stranding.data.error, "has_children");

  /*
   * A ledger of its own is a different matter. Write-off used to be the only way
   * out of one, which is right for money that went bad and wrong for a row entered
   * by mistake — that one leaves a permanent record of a debt nobody was owed. So
   * it goes, once the caller says plainly that is what they meant.
   */
  const doomed = await admin.post("/api/payouts", { network: "AdCombo", vertical: "CPS", earnedMonth: "2026-07", amountExpected: 900 });
  await admin.post(`/api/payouts/${doomed.data.id}/reconcile`, { amountReceived: 300 });
  await admin.post(`/api/payouts/${doomed.data.id}/reconcile`, { amountReceived: 100 });
  const unqualified = await admin.del(`/api/payouts/${doomed.data.id}`);
  eq("a payout with a ledger is not deleted by an unqualified request", unqualified.status, 409);
  eq("and it says why, in the code the UI reads", unqualified.data.error, "has_history");
  eq("...with the count the dialog is written around", unqualified.data.txns, 2);
  const confirmed = await admin.del(`/api/payouts/${doomed.data.id}?confirm=1`);
  eq("a confirmed delete takes the ledger with it", confirmed.status, 200);
  eq("...and says how much went", confirmed.data.txnsDeleted, 2);
  eq("the payout is gone", (await admin.get(`/api/payouts/${doomed.data.id}`)).status, 404);
  eq("and so are its entries", (await admin.get(`/api/payouts/${doomed.data.id}/txns`)).status, 404);

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

  console.log("");
  console.log("=== the header filters actually filter ===");
  /*
   * These are what the header points at, and they used to reach nothing: the vertical
   * was read by no screen at all and the month by two of eight, so picking September
   * on the Payout page left August's rows on screen.
   */
  const sub1 = await admin.post("/api/subcategories", { name: "Facebook", vertical: "CPS" });
  ok("a sub-vertical exists to file under", sub1.status === 200);
  const tagged = await admin.post("/api/payouts", {
    network: "AdCombo", vertical: "CPS", subcategory: "Facebook", earnedMonth: "2026-07", amountExpected: 640,
  });
  eq("a payout can be filed under a sub-vertical", tagged.data.subcategory, "Facebook");
  const untagged = await admin.post("/api/payouts", {
    network: "AdCombo", vertical: "CPS", earnedMonth: "2026-07", amountExpected: 360,
  });
  eq("...and does not have to be", untagged.data.subcategory, "");

  const allCps = await admin.get("/api/payouts?vertical=CPS&month=2026-07");
  const justFb = await admin.get("/api/payouts?vertical=CPS&subcategory=Facebook&month=2026-07");
  ok("the list narrows to a sub-vertical", justFb.data.total < allCps.data.total && justFb.data.total > 0,
    `${justFb.data.total} of ${allCps.data.total}`);
  ok("...to exactly the ones filed under it", justFb.data.items.every((p) => p.subcategory === "Facebook"));
  eq("a payout with no sub-vertical is not counted under one", justFb.data.items.some((p) => p.id === untagged.data.id), false);

  /* The same narrowing has to reach the figures, not just the table. */
  const dashAll = await admin.get("/api/payouts/summary/2026-07");
  const dashFb = await admin.get("/api/payouts/summary/2026-07?vertical=CPS&subcategory=Facebook");
  ok("the dashboard narrows too", dashFb.data.outstanding.pending < dashAll.data.outstanding.pending,
    `${dashFb.data.outstanding.pending} vs ${dashAll.data.outstanding.pending}`);
  const repAll = await admin.get("/api/payouts/reports/earned/2026-07");
  const repFb = await admin.get("/api/payouts/reports/earned/2026-07?vertical=CPS&subcategory=Facebook");
  eq("and the earned-month report", repFb.data.total.expected, 640);
  ok("...which is less than the unfiltered month", repAll.data.total.expected > repFb.data.total.expected);
  const netAll = await admin.get("/api/payouts/reports/networks");
  const netOne = await admin.get("/api/payouts/reports/networks?vertical=CPS");
  ok("and network reliability", netOne.data.length <= netAll.data.length && netOne.data.length > 0);
  const calAll = await admin.get("/api/payouts/calendar?from=2026-07&months=6");
  const calOne = await admin.get("/api/payouts/calendar?from=2026-07&months=6&vertical=CPS");
  ok("and the calendar", JSON.stringify(calOne.data).length < JSON.stringify(calAll.data).length);

  /*
   * The vertical in the query is a view, never a permission. A fresh session here
   * on purpose: the password tests above revoked the manager one.
   */
  const cpsMgr = await admin.post("/api/users", {
    name: "Scoped Mgr", username: "scoped", password: "manager123", role: "manager", verticals: ["CPS"],
  });
  ok("a CPS-only manager exists", cpsMgr.status === 200);
  const cps = session();
  eq("...and can sign in", (await cps.post("/api/login", { username: "scoped", password: "manager123" })).status, 200);
  const spy = await cps.get("/api/payouts/summary/2026-07?vertical=Nutra");
  eq("a manager asking for a vertical they do not hold gets nothing", spy.data.outstanding.pending, 0);
  const spyList = await cps.get("/api/payouts?vertical=Nutra");
  eq("...and no rows either", spyList.data.total, 0);
  const own = await cps.get("/api/payouts?vertical=CPS");
  ok("but their own vertical still answers", own.data.total > 0, `${own.data.total} rows`);

  /* Cleanup: the counts further down are asserted against a fixed dataset. */
  await admin.del(`/api/payouts/${tagged.data.id}?confirm=1`);
  await admin.del(`/api/payouts/${untagged.data.id}?confirm=1`);

  console.log("");
  console.log("=== importing from a sheet ===");
  /*
   * A stand-in for Google, serving the shape of the sheet these figures really come
   * from: two headers misspelled the way the original spells them, money written
   * with currency symbols and thousands separators, months as May'26, and rows that
   * cannot become payouts at all.
   */
  const SHEET_CSV = [
    "Camapign Name,Campaign Name,Ad Cost (Expense),Overall Revenue,Actual Revenue,Profit,Network name,Vertical,Month,Received Amount,Bank Account,Payment Recived Date",
    "T_EST,Etsy Apm Am,$89.34,$280.21,$252.19,163,SheetNet,CPS,May'26,,,",
    "T_LMB,Lycamobile Uk,$16.71,$0.00,$0.00,-17,SheetNet,CPS,May'26,,,",
    'T_KMF,"Komfort, Pl Sr",$249.08,$479.87,$287.92,39,SheetNet,CPS,May\'26,0,N/A,N/A',
    'T_ESTY,Etsy Launchigo Ca,$529.29,"$3,027.03","$2,724.33",2195,SheetNet,CPS,May\'26,"$3,027.00",ClickSpace,15/06/2026',
    "T_BAD,Broken Month,$10.00,$50.00,$40.00,30,SheetNet,CPS,notamonth,,,",
  ].join("\n");

  const { createServer } = await import("node:http");
  const stub = createServer((rq, rs) => {
    if (rq.url.startsWith("/private")) {
      rs.writeHead(200, { "Content-Type": "text/html" });
      return rs.end("<!doctype html><html><head><title>Sign in</title></head><body>Sign in</body></html>");
    }
    rs.writeHead(200, { "Content-Type": "text/csv" });
    rs.end(SHEET_CSV);
  });
  await new Promise((r) => stub.listen(4411, "127.0.0.1", r));
  const SHEET = "http://127.0.0.1:4411/sheet.csv";

  const pv = await admin.post("/api/sheet/preview", { url: SHEET });
  eq("a sheet can be read", pv.status, 200);
  const mapped = Object.fromEntries(pv.data.mapped.map((m) => [m.field, m.header]));
  eq("a misspelled header still maps", mapped.receivedDate, "Payment Recived Date");
  eq("the code column is read as the id, not the campaign", mapped.externalId, "Camapign Name");
  eq("...leaving the name column as the campaign", mapped.campaign, "Campaign Name");
  eq("profit is not imported", pv.data.ignored, ["Profit"]);
  eq("rows that cannot be payouts are counted apart", pv.data.counts.skippedBad, 2);
  eq("...and the rest are ready", pv.data.counts.imported, 3);
  eq("a preview writes nothing", (await admin.get("/api/payouts?network=SheetNet")).data.total, 0);

  const imp = await admin.post("/api/sheet/import", { url: SHEET });
  eq("the import runs", imp.status, 200);
  eq("...bringing in what the preview promised", imp.data.counts.imported, 3);
  eq("...including the one already paid", imp.data.counts.reconciled, 1);

  const brought = (await admin.get("/api/payouts?network=SheetNet&limit=50")).data;
  eq("the payouts are here", brought.total, 3);
  const etsy = brought.items.find((p) => p.externalId === "T_EST");
  eq("money survives its currency symbol", etsy.amountExpected, 252.19);
  eq("...and the reported figure comes with it", etsy.overallRevenue, 280.21);
  eq("the cost comes too", etsy.adCost, 89.34);
  eq("profit is derived from them", etsy.profit, 162.85);
  eq("May'26 is read as a month", etsy.earnedMonth, "2026-05");
  const komfort = brought.items.find((p) => p.externalId === "T_KMF");
  eq("a comma inside a quoted cell does not shift the columns", komfort.campaign, "Komfort, Pl Sr");
  eq("...so its money is still its own", komfort.amountExpected, 287.92);
  const paid = brought.items.find((p) => p.externalId === "T_ESTY");
  eq("a thousands separator is not a decimal point", paid.amountExpected, 2724.33);
  eq("a row that says it was paid arrives paid", paid.amountReceived, 3027);
  eq("...and settled", paid.status, "received");

  const rerun = await admin.post("/api/sheet/import", { url: SHEET });
  eq("running it twice imports nothing twice", rerun.data.counts.imported, 0);
  eq("...it recognises what it brought before", rerun.data.counts.skippedExisting, 3);
  eq("and the payouts are still three", (await admin.get("/api/payouts?network=SheetNet")).data.total, 3);

  /* A sheet the server cannot open is not an empty sheet, and says so. */
  const shut = await admin.post("/api/sheet/preview", { url: "http://127.0.0.1:4411/private" });
  eq("a sheet needing a login is refused, not read as empty", shut.status, 400);
  eq("...with the reason the screen explains", shut.data.error, "sheet_not_public");

  eq("a manager cannot import", (await cps.post("/api/sheet/preview", { url: SHEET })).status, 403);
  eq("...nor read the settings", (await cps.get("/api/sheet")).status, 403);

  const state = await admin.get("/api/sheet");
  eq("the last run is remembered", state.data.lastResult, "ok");
  ok("...with who ran it", !!state.data.lastRunBy, state.data.lastRunBy);

  for (const p of brought.items) await admin.del(`/api/payouts/${p.id}?confirm=1`);
  await new Promise((r) => stub.close(r));

  console.log("");
  console.log("=== the log ===");
  const actv = await admin.get("/api/log/activity?limit=200");
  eq("an admin can read the activity log", actv.status, 200);
  ok("everything this run wrote is in it", actv.data.total > 20, `total ${actv.data.total}`);
  const anEntry = (actv.data.items || [])[0] || {};
  ok("an entry says who did it", typeof anEntry.actorName === "string" && anEntry.actorName.length > 0);
  ok("...and says what, in words", typeof anEntry.label === "string" && anEntry.label !== anEntry.action);
  ok("newest first", new Date(actv.data.items[0].ts) >= new Date(actv.data.items[1].ts));

  const created = await admin.get("/api/log/activity?action=payout_added");
  ok("filtering by action narrows it", created.data.total > 0 && created.data.total < actv.data.total);
  ok("...to only that action", created.data.items.every((r) => r.action === "payout_added"));
  eq("a future date range is empty, not everything", (await admin.get("/api/log/activity?from=2099-01-01")).data.total, 0);

  const signins = await admin.get("/api/log/signins?limit=200");
  eq("sign-ins are readable too", signins.status, 200);
  ok("including the ones that failed", signins.data.items.some((r) => !r.success));
  ok("...with a reason", signins.data.items.filter((r) => !r.success).every((r) => r.reason));

  const meta = await admin.get("/api/log/meta");
  ok("the filters are offered only actions that exist", meta.data.actions.length > 0
    && meta.data.actions.every((a) => a.value && a.label));

  /*
   * A manager is refused all three. Read-only or not, it is a record of everyone —
   * when each colleague last signed in, and from which address.
   */
  eq("a manager cannot read the activity log", (await priya4.get("/api/log/activity")).status, 403);
  eq("...nor the sign-ins", (await priya4.get("/api/log/signins")).status, 403);
  eq("...nor the filter lists", (await priya4.get("/api/log/meta")).status, 403);
  ok("but they can see their own sign-ins", Array.isArray((await priya4.get("/api/log/mine")).data));

  eq("signed out, the log is not readable at all", (await session().get("/api/log/activity")).status, 401);

  /* Query values go straight into a mongo filter, so nonsense is a 400, not a 500. */
  eq("a non-numeric actorId is a bad request", (await admin.get("/api/log/activity?actorId=abc")).status, 400);
  eq("...and so is an unparseable date", (await admin.get("/api/log/activity?from=notadate")).status, 400);

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
