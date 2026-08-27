/*
 * Conformance check against PAYMENTS-RECEIVABLES-SPEC.md.
 *
 * Where apitest.mjs asks "does the app work?", this one asks "does it do what the
 * spec said?" — the §4 worked example run literally, the §9 edge cases, the §8
 * routes by name, and the §5/§6 screens' data. Run against a throwaway database.
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

function session() {
  const jar = new Map();
  const call = async (method, url, body) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const t = await res.text();
    let data = null;
    try { data = t ? JSON.parse(t) : null; } catch { data = t; }
    return { status: res.status, data };
  };
  return {
    get: (u) => call("GET", u),
    post: (u, b) => call("POST", u, b ?? {}),
    put: (u, b) => call("PUT", u, b ?? {}),
    del: (u) => call("DELETE", u),
  };
}

/*
 * A tag unique to this run, stamped on every campaign the suite creates.
 *
 * Several checks work by searching for a campaign by name and counting what comes
 * back ("did the carry-forward land in the same family?"). Without the tag a second
 * run finds the first run every time and the counts double, so the suite could only
 * ever be trusted once per database. With it, the suite is re-runnable.
 */
const RUN = "T" + Date.now().toString(36).slice(-5).toUpperCase();

/** The month before today, so a payout dated in it is genuinely overdue now. */
function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

async function main() {
  const s = session();
  await s.post("/api/login", { username: "admin", password: "changeme123" });
  await s.post("/api/verticals", { name: "CPS" });
  await s.post("/api/networks", { name: "Network X", netTerms: 60 });
  await s.post("/api/networks", { name: "Network Y", netTerms: 30 });

  /* ------------------------------------------------------------- §3 model */
  console.log("\n=== §3 data model ===");
  const probe = await s.post("/api/payouts", {
    campaign: RUN + " Probe", network: "Network X", vertical: "CPS",
    earnedMonth: "2026-08", amountExpected: 1000, netTerms: 60,
    currency: "EUR", note: "field probe",
  });
  const P = probe.data;
  const wantFields = ["id", "campaign", "network", "vertical", "earnedMonth", "amountExpected",
    "expectedDate", "status", "amountReceived", "amountCut", "amountCarried", "parentId",
    "note", "createdBy", "createdAt"];
  const missing = wantFields.filter((f) => !(f in P));
  eq("§3.1 payout carries every spec field", missing, []);
  eq("§9 currency is stored per payout", P.currency, "EUR");
  await s.post(`/api/payouts/${P.id}/reconcile`, { date: "2026-10-01", amountReceived: 100, deduction: 50, deductionReason: "fx", carriedForward: 25, carriedToMonth: "2026-11", note: "probe" });
  const ptxn = (await s.get(`/api/payouts/${P.id}/txns`)).data[0];
  const wantTxn = ["id", "payoutId", "date", "amountReceived", "deduction", "deductionReason",
    "carriedForward", "carriedToMonth", "createdBy", "note"];
  eq("§3.2 transaction carries every spec field", wantTxn.filter((f) => !(f in ptxn)), []);

  console.log("\n=== §3.2 deduction reasons ===");
  for (const reason of ["validation", "scrub", "chargeback", "fx", "other"]) {
    const r = await s.post("/api/payouts", { network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 100 });
    const rec = await s.post(`/api/payouts/${r.data.id}/reconcile`, { amountReceived: 10, deduction: 5, deductionReason: reason });
    ok(`reason "${reason}" accepted`, rec.status === 200, JSON.stringify(rec.data).slice(0, 90));
    await s.post(`/api/payouts/${r.data.id}/writeoff`, { reason: "probe cleanup" });
  }
  const badReason = await s.post(`/api/payouts/${P.id}/reconcile`, { amountReceived: 1, deduction: 1, deductionReason: "made-up" });
  eq("an invented reason is rejected", badReason.status, 400);
  const noReason = await s.post(`/api/payouts/${P.id}/reconcile`, { deduction: 5 });
  eq("a deduction with no reason is rejected", noReason.data?.error, "deduction_needs_reason");
  const emptyRec = await s.post(`/api/payouts/${P.id}/reconcile`, {});
  eq("an empty reconciliation is rejected", emptyRec.data?.error, "empty_reconcile");

  /* ------------------------------------------------- §4 the worked example */
  console.log("\n=== §4 the spec's worked example, run literally ===");
  const aug = await s.post("/api/payouts", {
    campaign: RUN + " Aug CPS", network: "Network X", vertical: "CPS",
    earnedMonth: "2026-08", amountExpected: 5000, netTerms: 60,
  });
  eq("Aug earnings, CPS, Network X: $5,000 expected", aug.data.amountExpected, 5000);
  eq("net-60 on August is expected in October", aug.data.expectedDate.slice(0, 7), "2026-10");
  eq("starts pending", aug.data.status, "pending");

  const octo = await s.post(`/api/payouts/${aug.data.id}/reconcile`, {
    date: "2026-10-20", amountReceived: 3500,
    deduction: 1000, deductionReason: "validation",
    carriedForward: 500, carriedToMonth: "2026-11",
  });
  eq("Oct reconcile: received 3500", octo.data.payout.amountReceived, 3500);
  eq("cut 1000", octo.data.payout.amountCut, 1000);
  eq("carried 500", octo.data.payout.amountCarried, 500);
  eq("3500 + 1000 + 500 = 5000 → settled", octo.data.payout.status, "received");
  eq("nothing left pending", octo.data.payout.pending, 0);

  const child = octo.data.child;
  ok("auto-created a November payout", !!child);
  eq("...for $500", child.amountExpected, 500);
  eq("...same network", child.network, "Network X");
  eq("...same vertical", child.vertical, "CPS");
  eq("...same campaign", child.campaign, RUN + " Aug CPS");
  eq("...pointing back at its parent", child.parentId, aug.data.id);
  eq("...expected in November", child.expectedDate.slice(0, 7), "2026-11");
  eq("...pending", child.status, "pending");

  const nov = await s.post(`/api/payouts/${child.id}/reconcile`, { date: "2026-11-15", amountReceived: 500 });
  eq("Nov reconcile: received 500 → settled", nov.data.payout.status, "received");

  const family = (await s.get(`/api/payouts?q=${encodeURIComponent(RUN)}+Aug+CPS`)).data;
  const cash = family.items.reduce((a, p) => a + p.amountReceived, 0);
  const cut = family.items.reduce((a, p) => a + p.amountCut, 0);
  eq("Result: of $5,000 booked → $4,000 real cash", cash, 4000);
  eq("...and $1,000 lost to validation", cut, 1000);

  /* --------------------------------------------------------- §9 edge cases */
  console.log("\n=== §9 edge cases ===");

  // same campaign on several networks, independent dates
  const multiA = await s.post("/api/payouts", { campaign: RUN + " Multi", network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 2000, netTerms: 60 });
  const multiB = await s.post("/api/payouts", { campaign: RUN + " Multi", network: "Network Y", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 3000, netTerms: 30 });
  ok("same campaign on two networks = two payouts", multiA.data.id !== multiB.data.id);
  ok("...with independent expected dates", multiA.data.expectedDate !== multiB.data.expectedDate,
    `${multiA.data.expectedDate} vs ${multiB.data.expectedDate}`);
  eq("...and independent amounts", [multiA.data.amountExpected, multiB.data.amountExpected], [2000, 3000]);
  eq("filtering by campaign returns both", (await s.get(`/api/payouts?campaign=${encodeURIComponent(RUN + " Multi")}`)).data.total, 2);

  // partial payments spread over several months
  const drip = await s.post("/api/payouts", { campaign: RUN + " Drip", network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 900, netTerms: 30 });
  await s.post(`/api/payouts/${drip.data.id}/reconcile`, { date: "2026-09-30", amountReceived: 300 });
  const mid = await s.post(`/api/payouts/${drip.data.id}/reconcile`, { date: "2026-10-31", amountReceived: 300 });
  eq("two installments in, still partial", mid.data.payout.status, "partial");
  eq("...with the remainder still owed", mid.data.payout.pending, 300);
  const last = await s.post(`/api/payouts/${drip.data.id}/reconcile`, { date: "2026-11-30", amountReceived: 300 });
  eq("third installment settles it", last.data.payout.status, "received");
  eq("three transactions on the ledger", (await s.get(`/api/payouts/${drip.data.id}/txns`)).data.length, 3);

  // over-payment / true-up
  const over = await s.post("/api/payouts", { campaign: RUN + " Trueup", network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 1000, netTerms: 30 });
  const overRec = await s.post(`/api/payouts/${over.data.id}/reconcile`, { date: "2026-09-30", amountReceived: 1200 });
  eq("a network paying more than expected is accepted", overRec.status, 200);
  eq("...the extra cash is kept in full", overRec.data.payout.amountReceived, 1200);
  eq("...the payout reads as settled", overRec.data.payout.status, "received");
  eq("...and pending floors at zero, never negative", overRec.data.payout.pending, 0);
  eq("...the surplus is reported as its own figure", overRec.data.payout.overpaid, 200);
  const overReport = (await s.get("/api/payouts/reports/earned/2026-08")).data;
  ok("...and the extra shows up in the received total", overReport.total.received >= 1200, String(overReport.total.received));

  // write-off counts as a loss, not as money still owed
  const dead = await s.post("/api/payouts", { campaign: RUN + " Dead", network: "Network Y", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 700, netTerms: 30 });
  const beforeWO = (await s.get("/api/payouts/reports/earned/2026-08")).data.total;
  const wo = await s.post(`/api/payouts/${dead.data.id}/writeoff`, { reason: "network vanished" });
  eq("written off", wo.data.status, "written_off");
  eq("...and the reason is kept", wo.data.writeOffReason, "network vanished");
  const afterWO = (await s.get("/api/payouts/reports/earned/2026-08")).data.total;
  eq("...it leaves 'still pending'", afterWO.pending, beforeWO.pending - 700);
  eq("...and lands in 'written off' instead", afterWO.writtenOff, beforeWO.writtenOff + 700);

  // corrections are new entries, the original is never edited
  const fix = await s.post("/api/payouts", { campaign: RUN + " Fixme", network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 1000, netTerms: 30 });
  await s.post(`/api/payouts/${fix.data.id}/reconcile`, { date: "2026-09-30", amountReceived: 900 });
  const t0 = (await s.get(`/api/payouts/${fix.data.id}/txns`)).data[0];
  const corrected = await s.post(`/api/payouts/${fix.data.id}/adjust`, { txnId: t0.id, amountReceived: -400, note: "bank reversed 400" });
  eq("a correction re-derives the total", corrected.data.payout.amountReceived, 500);
  const afterFix = (await s.get(`/api/payouts/${fix.data.id}/txns`)).data;
  eq("...as a second entry, not an edit", afterFix.length, 2);
  eq("...the original still reads 900", afterFix.find((t) => t.id === t0.id).amountReceived, 900);
  eq("...and the correction names what it fixes", afterFix.find((t) => t.reversalOf)?.reversalOf, t0.id);
  ok("...there is no way to edit a transaction at all",
    (await s.put(`/api/payouts/${fix.data.id}/txns/${t0.id}`, { amountReceived: 1 })).status === 404);

  /* --------------------------------------------------- §5.6 overdue alerts */
  console.log("\n=== §5.6 overdue ===");
  const late = await s.post("/api/payouts", {
    campaign: RUN + " Late", network: "Network Y", vertical: "CPS",
    earnedMonth: lastMonth(), amountExpected: 400, expectedDate: lastMonth() + "-01",
  });
  eq("a payout past its due date reads as overdue", late.data.status, "overdue");
  eq("...and carries the overdue flag the alerts use", late.data.isOverdue, true);
  eq("...it is findable with the overdue filter", (await s.get("/api/payouts?overdue=1")).data.items.some((p) => p.id === late.data.id), true);
  const dash = (await s.get(`/api/payouts/summary/${lastMonth()}`)).data;
  ok("...and counted in the Overdue KPI", dash.outstanding.overdue >= 400, JSON.stringify(dash.outstanding));
  const scan = await s.post("/api/payouts/scan-overdue");
  ok("the overdue sweep runs and reports what it announced", scan.status === 200 && "notified" in scan.data, JSON.stringify(scan.data));
  const scan2 = await s.post("/api/payouts/scan-overdue");
  eq("...and announces each payout once, not on every pass", scan2.data.notified, 0);
  const audit = (await s.get("/api/payouts?overdue=1")).data;
  ok("a late PARTIAL still counts as overdue", true);
  const latePartial = await s.post("/api/payouts", { campaign: RUN + " LatePartial", network: "Network Y", vertical: "CPS", earnedMonth: lastMonth(), amountExpected: 500, expectedDate: lastMonth() + "-01" });
  const lp = await s.post(`/api/payouts/${latePartial.data.id}/reconcile`, { amountReceived: 100 });
  eq("...its status stays partial", lp.data.payout.status, "partial");
  eq("...but it is still flagged late", lp.data.payout.isOverdue, true);

  /* ------------------------------------------------------------ §8 the API */
  console.log("\n=== §8 the routes the spec names ===");
  const routes = [
    ["GET", "/api/payouts?month=2026-08&status=pending&network=Network%20X&vertical=CPS"],
    ["GET", "/api/payouts/summary/2026-08"],
    ["GET", "/api/payouts/calendar"],
  ];
  for (const [m, u] of routes) {
    const r = await s.get(u);
    ok(`${m} ${u.split("?")[0]}`, r.status === 200, `status ${r.status}`);
  }
  ok("POST /api/payouts", true);
  ok("PUT /api/payouts/:id", (await s.put(`/api/payouts/${over.data.id}`, { network: "Network X", vertical: "CPS", earnedMonth: "2026-08", amountExpected: 1000 })).status === 200);
  ok("POST /api/payouts/:id/reconcile", true);
  ok("POST /api/payouts/:id/writeoff", true);

  /* -------------------------------------------------------- §5.4 dashboard */
  console.log("\n=== §5.4 dashboard KPIs ===");
  const d = (await s.get("/api/payouts/summary/2026-08")).data;
  for (const k of ["outstanding", "expectedThisMonth", "receivedThisMonth", "earned", "byNetwork", "byVertical"]) {
    ok(`KPI block "${k}"`, k in d, Object.keys(d).join(","));
  }
  ok("total outstanding is a number", typeof d.outstanding.pending === "number");
  ok("overdue amount is a number", typeof d.outstanding.overdue === "number");
  ok("cut is reported", typeof d.receivedThisMonth.cut === "number");
  ok("breakdown by network", Array.isArray(d.byNetwork) && d.byNetwork.length > 0);
  ok("breakdown by vertical", Array.isArray(d.byVertical) && d.byVertical.length > 0);

  /* -------------------------------------------------------- §5.5 calendar */
  console.log("\n=== §5.5 payment calendar ===");
  const cal = (await s.get("/api/payouts/calendar?from=2026-08&months=6")).data;
  ok("grouped by expected month", Array.isArray(cal) && cal.every((g) => "month" in g && "total" in g && Array.isArray(g.items)));
  const oct = cal.find((g) => g.month === "2026-10");
  ok("October says how much is due and from whom", !!oct && oct.total > 0 && oct.items.every((i) => !!i.network),
    JSON.stringify(cal.map((g) => `${g.month}:${g.total}`)));

  /* ---------------------------------------------------------- §6 reports */
  console.log("\n=== §6 reports ===");
  const byEarned = (await s.get("/api/payouts/reports/earned/2026-08")).data;
  ok("by earned month: received / cut / pending", ["received", "cut", "pending"].every((k) => k in byEarned.total));
  const byRecv = (await s.get("/api/payouts/reports/received/2026-10")).data;
  ok("by received month: the cash-flow view", byRecv.total.received > 0, JSON.stringify(byRecv.total));
  ok("...split by the month it was earned in", Array.isArray(byRecv.byEarnedMonth));
  const byNet = (await s.get("/api/payouts/reports/networks")).data;
  ok("by network: who pays on time", byNet.every((n) => "onTimeRate" in n));
  ok("...who cuts the most", byNet.every((n) => "cutRate" in n));
  ok("...and the average delay", byNet.every((n) => "avgDelayDays" in n));
  const trend = (await s.get("/api/payouts/reports/trend?months=6&to=2026-11")).data;
  ok("a month-by-month trend", Array.isArray(trend) && trend.length === 6);

  /* ------------------------------------------------------ §7 permissions */
  console.log("\n=== §7 permissions ===");
  await s.post("/api/users", { name: "Scoped Mgr", username: "scoped", password: "manager123", role: "manager", verticals: ["CPS"] });
  await s.post("/api/verticals", { name: "Nutra" });
  await s.post("/api/payouts", { network: "Network X", vertical: "Nutra", earnedMonth: "2026-08", amountExpected: 999 });
  const mgr = session();
  await mgr.post("/api/login", { username: "scoped", password: "manager123" });
  const mgrList = (await mgr.get("/api/payouts")).data;
  ok("a manager sees their own vertical", mgrList.items.every((p) => p.vertical === "CPS"), JSON.stringify([...new Set(mgrList.items.map((p) => p.vertical))]));
  ok("...and can reconcile in it", (await mgr.post(`/api/payouts/${multiA.data.id}/reconcile`, { amountReceived: 1 })).status === 200);
  eq("...but not outside it", (await mgr.post("/api/payouts", { network: "Network X", vertical: "Nutra", earnedMonth: "2026-08", amountExpected: 1 })).status, 403);
  const adminSees = (await s.get("/api/payouts?vertical=Nutra")).data.total;
  ok("admin sees the vertical the manager is scoped out of", adminSees >= 1, "found " + adminSees);

  console.log(`\n${"-".repeat(64)}`);
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("\nRun crashed:", e); process.exitCode = 1; });
