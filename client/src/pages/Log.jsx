/*
 * The log. Admin only — the sidebar hides it, and every route behind it re-checks.
 *
 * Two views over two collections, not one merged feed. A change has an actor, a
 * target and a detail; a sign-in has an address, a browser and a verdict, and half
 * of them belong to nobody at all because the username was wrong. Interleaving them
 * would need a table whose columns mean different things on different rows, which
 * is exactly the sort of table people stop trusting.
 *
 * Nothing here writes. It is a record, and a record you can edit is not one.
 */
import React, { useEffect, useState } from "react";
import { api, qs } from "../api/client";
import { Empty, Loading, Seg, Field } from "../components/ui";
import Pager from "../components/Pager";

const VIEWS = [
  { value: "activity", label: "Activity" },
  { value: "signins", label: "Sign-ins" },
];

const EMPTY = { items: [], total: 0, page: 1, pages: 1 };

/* A log is read by when things happened, so every row leads with the clock. */
function when(d) {
  if (!d) return { day: "—", time: "" };
  const x = new Date(d);
  if (isNaN(x)) return { day: "—", time: "" };
  return {
    day: x.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    time: x.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function Stamp({ at }) {
  const t = when(at);
  return (
    <>
      <div style={{ fontWeight: 600 }}>{t.day}</div>
      <div className="muted" style={{ fontSize: 11.5 }}>{t.time}</div>
    </>
  );
}

/*
 * The user agent, shortened to the part anyone actually reads. The full string is
 * kept on the title attribute — it is evidence, so it should be recoverable, just
 * not at the cost of a column three times the width of every other one.
 */
function browserOf(ua) {
  if (!ua) return "—";
  const s = String(ua);
  const name =
    /Edg\//.test(s) ? "Edge"
      : /OPR\//.test(s) ? "Opera"
        : /Firefox\//.test(s) ? "Firefox"
          : /Chrome\//.test(s) ? "Chrome"
            : /Safari\//.test(s) ? "Safari"
              : /curl\//i.test(s) ? "curl"
                : "Other";
  const os =
    /Windows/.test(s) ? "Windows"
      : /Android/.test(s) ? "Android"
        : /iPhone|iPad/.test(s) ? "iOS"
          : /Mac OS X/.test(s) ? "macOS"
            : /Linux/.test(s) ? "Linux"
              : "";
  return os ? `${name} · ${os}` : name;
}

/*
 * Failures say why in a machine word; this is the sentence for it.
 *
 * 2fa_required is stored as a failure and is not one — the password was right and
 * the app asked for the second factor, which is the system working. It is drawn in
 * amber rather than red so a page of them does not read as an attack.
 */
const FAIL_REASONS = {
  bad_password: "Wrong password",
  no_such_user: "No such account",
  locked: "Account locked",
  bad_totp: "Wrong two-factor code",
  "2fa_required": "Two-factor code asked for",
};

const SOFT_FAIL = new Set(["2fa_required"]);

export default function Log() {
  const [view, setView] = useState("activity");
  const [meta, setMeta] = useState({ actions: [], actors: [] });
  const [filters, setFilters] = useState({ q: "", action: "", actorId: "", result: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  /*
   * Rows are held together with the view they were fetched for. Switching tabs
   * re-renders before the new request lands, and the two payloads share no columns —
   * so for one frame the sign-ins table would try to draw activity rows. Holding
   * both means a mismatch simply reads as still loading.
   */
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/api/log/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const common = { q: filters.q, from: filters.from, to: filters.to, page, limit };
    const url = view === "activity"
      ? `/api/log/activity${qs({ ...common, action: filters.action, actorId: filters.actorId })}`
      : `/api/log/signins${qs({ ...common, result: filters.result })}`;
    api.get(url)
      .then((r) => { if (alive) setData({ view, res: r }); })
      .catch(() => { if (alive) setData({ view, res: EMPTY }); });
    return () => { alive = false; };
  }, [view, filters, page, limit]);

  const res = data && data.view === view ? data.res : null;

  const setF = (k, v) => { setPage(1); setFilters({ ...filters, [k]: v }); };
  const clear = () => { setPage(1); setFilters({ q: "", action: "", actorId: "", result: "", from: "", to: "" }); };
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Seg options={VIEWS} value={view} onChange={(v) => { setView(v); setPage(1); }} />
      </div>

      <div className="card filterbar">
        <div className="fgrid">
          <Field label="Search">
            <input
              value={filters.q}
              placeholder={view === "activity" ? "person, detail…" : "username, address…"}
              onChange={(e) => setF("q", e.target.value)}
            />
          </Field>

          {view === "activity" ? (
            <>
              <Field label="Action">
                <select value={filters.action} onChange={(e) => setF("action", e.target.value)}>
                  <option value="">All actions</option>
                  {meta.actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </Field>
              <Field label="Done by">
                <select value={filters.actorId} onChange={(e) => setF("actorId", e.target.value)}>
                  <option value="">Anyone</option>
                  {meta.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Result">
              <select value={filters.result} onChange={(e) => setF("result", e.target.value)}>
                <option value="">All attempts</option>
                <option value="ok">Successful</option>
                <option value="fail">Failed</option>
              </select>
            </Field>
          )}

          <Field label="From">
            <input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} />
          </Field>
        </div>

        {anyFilter && (
          <div className="foot">
            <div className="chiprow">
              <button className="btn sm ghost" onClick={clear}>Clear filters</button>
            </div>
          </div>
        )}
      </div>

      {!res ? <Loading />
        : !res.items.length ? (
          <Empty title={anyFilter ? "Nothing matches these filters." : "Nothing recorded yet."}>
            {anyFilter
              ? "Widen the dates, or clear the filters."
              : "Every change and every sign-in lands here from now on."}
          </Empty>
        ) : (
          <>
            {view === "activity" ? <Activity rows={res.items} /> : <Signins rows={res.items} />}
            <Pager
              page={res.page}
              pages={res.pages}
              total={res.total}
              limit={limit}
              noun={view === "activity" ? "entry" : "sign-in"}
              plural={view === "activity" ? "entries" : "sign-ins"}
              onPage={setPage}
              onLimit={(n) => { setLimit(n); setPage(1); }}
            />
          </>
        )}
    </>
  );
}

function Activity({ rows }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>When</th>
            <th style={{ width: 150 }}>Who</th>
            <th style={{ width: 190 }}>What</th>
            <th>Detail</th>
            <th style={{ width: 110 }}>Month</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Stamp at={r.ts} /></td>
              <td><b>{r.actorName}</b></td>
              <td>{r.label}</td>
              <td>
                {r.detail || <span className="muted">—</span>}
                {/* who it was done TO, when that is someone other than the actor */}
                {r.targetName && r.targetName !== r.actorName && (
                  <div className="muted" style={{ fontSize: 11.5 }}>for {r.targetName}</div>
                )}
              </td>
              <td>{r.month || <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Signins({ rows }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>When</th>
            <th style={{ width: 150 }}>Username</th>
            <th style={{ width: 150 }}>Result</th>
            <th style={{ width: 150 }}>Address</th>
            <th>Browser</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Stamp at={r.at} /></td>
              <td><b>{r.username || <span className="muted">—</span>}</b></td>
              <td>
                {r.success
                  ? <span className="pill g">Signed in</span>
                  : (
                    <span className={"pill " + (SOFT_FAIL.has(r.reason) ? "a" : "r")}>
                      {FAIL_REASONS[r.reason] || "Failed"}
                    </span>
                  )}
                {/* the one line in this table worth reading twice */}
                {r.success && r.newDevice && (
                  <div className="muted" style={{ fontSize: 11.5 }}>new device</div>
                )}
              </td>
              <td>{r.ip || <span className="muted">—</span>}</td>
              <td title={r.userAgent}>{browserOf(r.userAgent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
