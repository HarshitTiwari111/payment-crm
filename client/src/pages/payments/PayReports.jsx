/*
 * The four receivables reports.
 *
 * "By earned month" and "by received month" look similar and are not: the first
 * asks what August's earnings have turned into, the second asks what landed in the
 * bank during October, whatever month it came from.
 */
import React, { useEffect, useState } from "react";
import { api, qs } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Loading, Empty, Simple, Seg } from "../../components/ui";
import { BarChart, LineChart, ds } from "../../components/Chart";
import { money, pct, monthLabel, monthShort } from "../../api/format";

const VIEWS = [
  { value: "earned", label: "By earned month" },
  { value: "received", label: "By received month" },
  { value: "networks", label: "Network reliability" },
  { value: "trend", label: "Collection trend" },
];

export default function PayReports() {
  const { month, reloadKey } = useApp();
  const [view, setView] = useState("earned");
  /*
   * The view is stored WITH the rows it belongs to. Picking a new report re-renders
   * before its effect has had a chance to clear the old rows, and the four payloads
   * have nothing in common — so for one frame the reliability table was drawing the
   * trend's months. Holding both together means a mismatch simply reads as loading.
   */
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const url = {
      earned: `/api/payouts/reports/earned/${month}`,
      received: `/api/payouts/reports/received/${month}`,
      networks: "/api/payouts/reports/networks",
      trend: `/api/payouts/reports/trend${qs({ months: 6, to: month })}`,
    }[view];
    api.get(url)
      .then((r) => { if (alive) setData({ view, rows: r }); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [view, month, reloadKey]);

  const rows = data && data.view === view ? data.rows : null;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Seg options={VIEWS} value={view} onChange={setView} />
      </div>
      {!rows ? <Loading /> : (
        view === "earned" ? <Earned d={rows} month={month} />
          : view === "received" ? <Received d={rows} month={month} />
            : view === "networks" ? <Networks d={rows} />
              : <Trend d={rows} />
      )}
    </>
  );
}

function Earned({ d, month }) {
  const t = d.total || {};
  if (!t.count) return <Empty title={`Nothing was booked as owed for ${monthLabel(month)}.`} />;
  const collected = t.expected ? (t.received / t.expected) * 100 : NaN;

  return (
    <>
      <div className="hint">
        Of everything earned in <b>{monthLabel(month)}</b>, this is where the money stands today — regardless of
        which month it eventually arrived in.
      </div>
      <div className="grid cards">
        <Simple k="Expected" v={money(t.expected)} sub={`${t.count} payout(s)`} />
        <Simple k="Received" v={money(t.received)} sub={isNaN(collected) ? "" : `${pct(collected)} collected`} />
        <Simple k="Cut" v={t.cut ? "−" + money(t.cut) : "—"} sub="validation / scrub" />
        <Simple k="Carried out" v={money(t.carried)} sub="moved to later months" />
        <Simple k="Still pending" v={money(t.pending)} sub="not yet accounted for" />
        <Simple k="Written off" v={t.writtenOff ? money(t.writtenOff) : "—"} sub="unrecoverable" />
      </div>

      <h2 className="sec">By network</h2>
      <Table rows={d.byNetwork} keyField="network" />
      <h2 className="sec">By vertical</h2>
      <Table rows={d.byVertical} keyField="vertical" />
    </>
  );
}

function Received({ d, month }) {
  const t = d.total || {};
  if (!t.count) return <Empty title={`No cash was recorded as arriving in ${monthLabel(month)}.`} />;

  return (
    <>
      <div className="hint">
        Cash flow: what actually landed during <b>{monthLabel(month)}</b>. This total mixes several earning months —
        net-60 money from two months ago shows up here alongside anything recent.
      </div>
      <div className="grid cards">
        <Simple k="Received" v={money(t.received)} sub={`${t.count} reconciliation(s)`} />
        <Simple k="Cut" v={t.cut ? "−" + money(t.cut) : "—"} sub="lost in this month's settlements" />
        <Simple k="Carried forward" v={money(t.carried)} sub="pushed to later months" />
      </div>

      {d.byEarnedMonth?.length > 0 && (
        <>
          <h2 className="sec">Which months this cash was earned in</h2>
          <BarChart
            labels={d.byEarnedMonth.map((x) => monthShort(x.earnedMonth))}
            datasets={[ds("Received", d.byEarnedMonth.map((x) => x.received), "#2ecc71", true)]}
            height={240}
          />
        </>
      )}

      <h2 className="sec">By network</h2>
      <Table rows={d.byNetwork} keyField="network" />
    </>
  );
}

function Table({ rows, keyField }) {
  if (!rows || !rows.length) return <div className="muted">Nothing to show.</div>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{keyField === "network" ? "Network" : "Vertical"}</th>
            <th className="right">Expected</th><th className="right">Received</th>
            <th className="right">Cut</th><th className="right">Carried</th><th className="right">Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyField]}>
              <td><b>{r[keyField]}</b></td>
              <td className="num">{money(r.expected)}</td>
              <td className="num" style={{ color: "var(--green)" }}>{money(r.received)}</td>
              <td className="num" style={{ color: r.cut ? "var(--red)" : "var(--muted)" }}>{r.cut ? "−" + money(r.cut) : "—"}</td>
              <td className="num">{r.carried ? money(r.carried) : <span className="muted">—</span>}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.pending)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Who pays on time, who cuts the most, and how late they usually are. */
function Networks({ d }) {
  if (!d || !d.length) return <Empty title="No network history yet." />;
  return (
    <>
      <div className="hint">
        Built from every payout and reconciliation on record. <b>Delay</b> is measured from the date a payment was
        expected to the date the cash actually arrived, so a negative number means they paid early.
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Network</th><th className="right">Payouts</th><th className="right">Settled</th>
              <th className="right">Expected</th><th className="right">Received</th>
              <th className="right">Collected</th><th className="right">Cut rate</th>
              <th className="right">Avg delay</th><th className="right">On time</th>
            </tr>
          </thead>
          <tbody>
            {d.map((n) => (
              <tr key={n.network}>
                <td><b>{n.network}</b></td>
                <td className="num">{n.payouts}</td>
                <td className="num">{n.settled}</td>
                <td className="num">{money(n.expected)}</td>
                <td className="num" style={{ color: "var(--green)" }}>{money(n.received)}</td>
                <td className="num">
                  <span className={"pill " + (n.collectionRate >= 90 ? "g" : n.collectionRate >= 70 ? "a" : "r")}>
                    {pct(n.collectionRate)}
                  </span>
                </td>
                <td className="num">
                  <span className={"pill " + (n.cutRate <= 5 ? "g" : n.cutRate <= 15 ? "a" : "r")}>{pct(n.cutRate)}</span>
                </td>
                <td className="num">
                  {n.avgDelayDays == null ? <span className="muted">—</span> : (
                    <span style={{ color: n.avgDelayDays > 7 ? "var(--red)" : n.avgDelayDays > 0 ? "var(--amber)" : "var(--green)" }}>
                      {n.avgDelayDays > 0 ? `+${n.avgDelayDays}d` : `${n.avgDelayDays}d`}
                    </span>
                  )}
                </td>
                <td className="num">{n.onTimeRate == null ? <span className="muted">—</span> : pct(n.onTimeRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** How each of the last few earned months has filled in. */
function Trend({ d }) {
  if (!d || !d.length) return <Empty title="Not enough history yet." />;
  return (
    <>
      <div className="hint">
        What each month was owed, against what has actually come back for it. The recent months always trail —
        that money is still in transit under its net terms, not lost.
      </div>
      <LineChart
        labels={d.map((x) => monthShort(x.month))}
        datasets={[
          ds("Expected", d.map((x) => x.expected), "#4f8cff"),
          ds("Received", d.map((x) => x.received), "#2ecc71"),
        ]}
        height={280}
      />
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Month</th><th className="right">Expected</th><th className="right">Received</th>
              <th className="right">Cut</th><th className="right">Carried</th>
              <th className="right">Still owed</th><th className="right">Collected</th>
            </tr>
          </thead>
          <tbody>
            {d.map((x) => (
              <tr key={x.month}>
                <td><b>{monthLabel(x.month)}</b></td>
                <td className="num">{x.expected ? money(x.expected) : <span className="muted">—</span>}</td>
                <td className="num" style={{ color: x.received ? "var(--green)" : undefined }}>
                  {x.received ? money(x.received) : <span className="muted">—</span>}
                </td>
                <td className="num" style={{ color: x.cut ? "var(--red)" : "var(--muted)" }}>{x.cut ? "−" + money(x.cut) : "—"}</td>
                <td className="num">{x.carried ? money(x.carried) : <span className="muted">—</span>}</td>
                <td className="num" style={{ fontWeight: 700 }}>{x.receivable ? money(x.receivable) : <span className="muted">—</span>}</td>
                <td className="num">
                  {x.collected == null
                    ? <span className="muted">—</span>
                    : <span className={"pill " + (x.collected >= 90 ? "g" : x.collected >= 70 ? "a" : "r")}>{pct(x.collected)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
