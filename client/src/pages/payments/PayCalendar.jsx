/*
 * Payment calendar (spec §5.5) — "in October, how much is due, and from whom".
 *
 * Anything already past its date is pinned to the top as its own overdue group
 * rather than sitting quietly in a month that has gone by.
 *
 * The period picker is deliberately forward-looking: a receivables calendar is
 * about money still to come. "Overdue only" covers looking backwards, and the
 * month field jumps to any specific month you want to start from.
 */
import React, { useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Loading, Empty } from "../../components/ui";
import { IconWarn } from "../../icons";
import { money, monthLabel, dateLabel, curMonthStr, addMonths } from "../../api/format";
import { StatusPill } from "./shared";

const PRESETS = [
  { key: "1", label: "This month", months: 1 },
  { key: "3", label: "Next 3 months", months: 3 },
  { key: "6", label: "Next 6 months", months: 6 },
  { key: "12", label: "Next 12 months", months: 12 },
];

export default function PayCalendar() {
  const { reloadKey } = useApp();
  const [groups, setGroups] = useState(null);
  const [preset, setPreset] = useState("6");
  const [from, setFrom] = useState(curMonthStr());
  const [overdueOnly, setOverdueOnly] = useState(false);

  const months = Number(preset) || 6;

  useEffect(() => {
    let alive = true;
    setGroups(null);
    api.get(`/api/payouts/calendar${qs({ from, months })}`)
      .then((r) => { if (alive) setGroups(Array.isArray(r) ? r : []); })
      .catch(() => { if (alive) setGroups([]); });
    return () => { alive = false; };
  }, [from, months, reloadKey]);

  const shown = useMemo(() => {
    if (!groups) return null;
    return overdueOnly ? groups.filter((g) => g.month === "overdue") : groups;
  }, [groups, overdueOnly]);

  const overdueTotal = (groups || []).find((g) => g.month === "overdue")?.total || 0;
  const upcomingTotal = (groups || [])
    .filter((g) => g.month !== "overdue")
    .reduce((a, g) => a + g.total, 0);

  const to = addMonths(from, months - 1);

  return (
    <>
      <div className="card filterbar">
        <div className="flex-between">
          <div>
            <div style={{ fontWeight: 650 }}>What is expected to arrive</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              Grouped by the month it is due · {monthLabel(from)}
              {months > 1 ? ` – ${monthLabel(to)}` : ""}
            </div>
          </div>
          <div className="chiprow">
            {overdueTotal > 0 && <span className="pill r">Overdue {money(overdueTotal)}</span>}
            <span className="pill b">Upcoming {money(upcomingTotal)}</span>
          </div>
        </div>

        <div className="foot">
          <div className="chiprow">
            <div className="seg">
              {PRESETS.map((p) => (
                <button key={p.key} className={preset === p.key ? "on" : ""} onClick={() => setPreset(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <button className="btn sm" onClick={() => setFrom(addMonths(from, -1))} title="Shift the window one month earlier">←</button>
            <input
              type="month"
              value={from}
              onChange={(e) => setFrom(e.target.value || curMonthStr())}
              style={{ width: 165 }}
              title="Start the calendar from this month"
            />
            <button className="btn sm" onClick={() => setFrom(addMonths(from, 1))} title="Shift the window one month later">→</button>
            {from !== curMonthStr() && (
              <button className="btn sm ghost" onClick={() => setFrom(curMonthStr())}>Back to this month</button>
            )}
          </div>
          <label className="checkline">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>
      </div>

      {shown === null ? <Loading /> : !shown.length ? (
        <Empty title={overdueOnly ? "Nothing is overdue" : "Nothing is scheduled to arrive in this window."}>
          {overdueOnly ? "Every payout is either settled or still within its terms." : "Try a longer period, or a different starting month."}
        </Empty>
      ) : shown.map((g) => {
        const overdue = g.month === "overdue";
        return (
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }} key={g.month}>
            <div
              className="flex-between"
              style={{
                padding: "11px 16px",
                background: overdue ? "var(--pill-r-bg)" : "var(--panel2)",
                color: overdue ? "var(--pill-r-fg)" : undefined,
              }}
            >
              <b style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {overdue && <IconWarn size={15} />}
                {overdue ? "Overdue — should already have arrived" : monthLabel(g.month)}
              </b>
              <span className={overdue ? "" : "muted"}>
                {g.items.length} payment(s) · <b>{money(g.total)}</b>
              </span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Due</th><th>Network</th><th>Campaign</th><th>Vertical</th>
                    <th>Earned</th><th>Amount due</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((p) => (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: "nowrap", color: p.isOverdue ? "var(--red)" : undefined }}>
                        {dateLabel(p.expectedDate)}
                      </td>
                      <td><b>{p.network}</b></td>
                      <td className="muted">{p.campaign || "—"}</td>
                      <td>{p.vertical ? <span className="pill n">{p.vertical}</span> : "—"}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{monthLabel(p.earnedMonth)}</td>
                      <td style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(p.pending, p.currency)}</td>
                      <td>
                        <span className="statuscell"><StatusPill status={p.status} isOverdue={p.isOverdue} /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
