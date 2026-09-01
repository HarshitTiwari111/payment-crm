/*
 * Receivables KPIs (spec §5.4).
 *
 * Two different clocks are running here, and mixing them up is the usual way these
 * numbers stop making sense:
 *   "this month" for expected/received means the CALENDAR month — cash flow.
 *   "earned this month" means the month the work was done — that is what gets
 *   compared against the month's ad spend.
 */
import React, { useEffect, useState } from "react";
import { api, qs } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Loading, Simple, Kpi, Empty } from "../../components/ui";
import { BarChart, ds } from "../../components/Chart";
import { money, pct, monthLabel, curMonthStr } from "../../api/format";

export default function PayDashboard() {
  const { month: picked, verticalFilter, subcatFilter, reloadKey } = useApp();
  // Payout lets the month be cleared to mean every month; one month's figures cannot
  const month = picked || curMonthStr();
  const [d, setD] = useState(null);

  useEffect(() => {
    let alive = true;
    setD(null);
    api.get(`/api/payouts/summary/${month}${qs({ vertical: verticalFilter, subcategory: subcatFilter })}`)
      .then((r) => { if (alive) setD(r); })
      .catch(() => { if (alive) setD(null); });
    return () => { alive = false; };
  }, [month, verticalFilter, subcatFilter, reloadKey]);

  if (!d) return <Loading />;

  const out = d.outstanding || {};
  const exp = d.expectedThisMonth || {};
  const recv = d.receivedThisMonth || {};
  const earned = d.earned || {};

  const nothing = !out.count && !exp.count && !recv.count && !earned.count;
  if (nothing) {
    return (
      <Empty title="No payouts recorded yet.">
        <p>Add a payout on the <b>Payout</b> tab to start tracking what the networks owe you.</p>
      </Empty>
    );
  }

  const collection = earned.expected ? (earned.received / earned.expected) * 100 : NaN;
  const byNet = (d.byNetwork || []).slice(0, 8);
  const byVert = (d.byVertical || []).slice(0, 8);

  return (
    <>
      <div className="grid cards">
        <Simple
          k="Total outstanding" v={money(out.pending)}
          sub={`${out.count || 0} payout(s) still owed, all months`}
        />
        <Simple
          k={`Expected in ${monthLabel(month)}`} v={money(exp.pending)}
          sub={`${exp.count || 0} payment(s) due this month`}
        />
        <Simple
          k={`Received in ${monthLabel(month)}`} v={money(recv.received)}
          sub="cash that actually landed this month"
        />
        <Simple
          k="Cut this month" v={recv.cut ? "−" + money(recv.cut) : "—"}
          sub="validation / scrub — a permanent loss"
        />
        <Simple
          k="Overdue" v={money(out.overdue)}
          sub={out.overdue ? "past the expected date" : "nothing overdue"}
        />
        <Kpi
          k={`Collected on ${monthLabel(month)}`}
          v={money(earned.received)}
          sub={earned.expected
            ? `of ${money(earned.expected)} owed${earned.pending ? ` · ${money(earned.pending)} still to come` : ""}`
            : "nothing booked for this month"}
          achieved={collection}
        />
      </div>

      <div className="hint" style={{ marginTop: 14 }}>
Every card but the last follows the <b>calendar</b> month — money due or arriving in {monthLabel(month)},
        whatever it was earned for. The last one follows the <b>earned</b> month: of what {monthLabel(month)} earned,
        how much has come back so far. A recent month will always look under-collected, because the money simply has
        not arrived yet.
      </div>

      {byNet.length > 0 && (
        <>
          <h2 className="sec">Outstanding by network</h2>
          <BarChart
            labels={byNet.map((n) => n.network)}
            datasets={[
              ds("Expected", byNet.map((n) => n.expected), "#4f8cff", true),
              ds("Received", byNet.map((n) => n.received), "#2ecc71", true),
              ds("Still owed", byNet.map((n) => n.pending), "#f5a623", true),
            ]}
            height={260}
          />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Network</th><th className="right">Payouts</th><th className="right">Expected</th>
                  <th className="right">Received</th><th className="right">Cut</th>
                  <th className="right">Still owed</th><th className="right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {(d.byNetwork || []).map((n) => (
                  <tr key={n.network}>
                    <td><b>{n.network}</b></td>
                    <td className="num">{n.count}</td>
                    <td className="num">{money(n.expected)}</td>
                    <td className="num" style={{ color: "var(--green)" }}>{money(n.received)}</td>
                    <td className="num" style={{ color: n.cut ? "var(--red)" : "var(--muted)" }}>{n.cut ? "−" + money(n.cut) : "—"}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(n.pending)}</td>
                    <td className="num" style={{ color: n.overdue ? "var(--red)" : "var(--muted)" }}>{n.overdue ? money(n.overdue) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {byVert.length > 0 && (
        <>
          <h2 className="sec">Outstanding by vertical</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Vertical</th><th className="right">Expected</th><th className="right">Received</th>
                  <th className="right">Cut</th><th className="right">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {(d.byVertical || []).map((v) => (
                  <tr key={v.vertical}>
                    <td><span className="pill n">{v.vertical}</span></td>
                    <td className="num">{money(v.expected)}</td>
                    <td className="num" style={{ color: "var(--green)" }}>{money(v.received)}</td>
                    <td className="num" style={{ color: v.cut ? "var(--red)" : "var(--muted)" }}>{v.cut ? "−" + money(v.cut) : "—"}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(v.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
