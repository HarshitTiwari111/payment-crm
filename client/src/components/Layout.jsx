/*
 * The shell: sidebar, top bar, and whichever page is active.
 *
 * The two top-bar selectors (Vertical / Month) are shared state, so every page
 * below reacts to them rather than keeping its own copy. Account controls live in
 * the avatar menu on the right.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { TAB_LABELS, buildTabs, USES_VERTICAL, USES_MONTH, MONTH_OPTIONAL } from "../tabs";
import { TabIcon, IconMenu } from "../icons";
import PasswordModal from "./PasswordModal";
import Confirm from "./Confirm";
import UserMenu from "./UserMenu";
import SecurityModal from "./SecurityModal";
import { curMonthStr } from "../api/format";

const COLLAPSE_KEY = "payment-crm-sidebar";

export default function Layout({ tab, setTab, children }) {
  const app = useApp();
  const {
    me, month, setMonth, verticalFilter, subcatFilter, pickVertical,
    subsOf, pickableVerts, selectable, viewUser, setViewUser,
  } = app;

  const [showPwd, setShowPwd] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);

  /*
   * Latched rather than read straight from the flag: enrolling clears it, and if the
   * modal were tied to the flag it would vanish the instant 2FA turned on — taking
   * the one and only showing of the recovery codes with it. It opens when the server
   * says enrolment is due and closes when the person closes it.
   */
  const [enrol2fa, setEnrol2fa] = useState(false);
  const mustEnrol = !!(me && me.mustEnrollTwoFactor);
  useEffect(() => { if (mustEnrol) setEnrol2fa(true); }, [mustEnrol]);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch (e) { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [collapsed]);

  const ids = useMemo(() => buildTabs(me), [me]);

  if (!me) return null;

  /*
   * The Vertical dropdown, drawn from whoever is being viewed rather than from the
   * whole company: the server answers with nothing outside that person's verticals,
   * so offering the rest would just be a list of dead ends. A single vertical gets
   * no "All" row — there is nothing to widen to.
   */
  /*
   * A screen that reports one month cannot sit under an empty picker: it falls back
   * to this month to have something to draw, and an empty box above this month's
   * figures says the wrong thing about them. So the picker is filled back in, once,
   * on arriving at such a screen. Payout keeps its emptiness — every month is a real
   * answer there, which is why it is the only screen offering All.
   */
  useEffect(() => {
    if (!month && USES_MONTH.has(tab) && !MONTH_OPTIONAL.has(tab)) setMonth(curMonthStr());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, month]);

  const scope = pickableVerts();
  const vertOptions = [];
  if (scope.length >= 2) vertOptions.push({ value: "", label: "All verticals" });
  scope.forEach((v) => {
    vertOptions.push({ value: v, label: v });
    subsOf(v).forEach((s) => vertOptions.push({ value: `${v}::${s.name}`, label: `  ↳ ${s.name}` }));
  });
  const vertValue = subcatFilter ? `${verticalFilter}::${subcatFilter}` : verticalFilter;

  // The View picker is an admin's, and only worth drawing once there is a manager to pick.
  const showViewSel = me.role === "admin" && selectable.length > 1;

  return (
    <div id="app">
      <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
        {/* name on the left, collapse control on the right — nothing between them,
            so the name has the whole rail and never truncates */}
        <div className="brand">
          <span className="brandname">Payment CRM</span>
          <button
            className="burger"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconMenu size={19} />
          </button>
        </div>

        <nav className="tabs">
          {ids.map((id) => {
            const label = TAB_LABELS[id];
            return (
              <button
                key={id}
                type="button"
                className={"tab" + (tab === id ? " active" : "")}
                onClick={() => setTab(id)}
                title={collapsed ? label : undefined}
              >
                <span className="ic"><TabIcon id={id} /></span>
                <span className="tablabel">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className={"main" + (collapsed ? " wide" : "")}>
        <div className="topbar">
          {showViewSel && (
            <div>
              <label>View team</label>
              <select value={viewUser ?? ""} onChange={(e) => setViewUser(e.target.value)}>
                {selectable.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* drawn only where the screen below actually reads it — see tabs.js */}
          {USES_VERTICAL.has(tab) && (
            <div>
              <label>Vertical</label>
              <select value={vertValue} onChange={(e) => pickVertical(e.target.value)}>
                {vertOptions.map((o) => (
                  <option key={o.value || "__all"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {USES_MONTH.has(tab) && (
            <div>
              <label>Month</label>
              <div className="monthpick">
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                {/*
                  Where every month at once is a real answer, there has to be a way
                  back to it — a month input cannot be emptied reliably across
                  browsers, and the Payout screen is the whole ledger.
                */}
                {MONTH_OPTIONAL.has(tab) && (
                  <button
                    type="button"
                    className={"btn sm " + (month ? "ghost" : "primary")}
                    onClick={() => setMonth("")}
                    title="Show every month"
                  >
                    All
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="spacer" />
          <UserMenu
            onPassword={() => setShowPwd(true)}
            onSecurity={() => setShowSecurity(true)}
            onLogout={() => setConfirmLogout(true)}
          />
        </div>

        <main>{children}</main>
      </div>

      {showPwd && <PasswordModal onClose={() => setShowPwd(false)} />}
      {enrol2fa
        ? <SecurityModal required={mustEnrol} onClose={() => setEnrol2fa(false)} />
        : showSecurity && <SecurityModal onClose={() => setShowSecurity(false)} />}
      {confirmLogout && (
        <Confirm
          title="Log out?"
          message="Are you sure you want to log out?"
          confirmLabel="Log out"
          cancelLabel="Cancel"
          onConfirm={app.logout}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
