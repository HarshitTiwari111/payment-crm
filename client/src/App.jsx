import React, { useEffect, useState } from "react";
import { useApp } from "./context/AppContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import { TAB_LABELS, TAB_SUB, buildTabs } from "./tabs";
import { TabIcon, IconAdd } from "./icons";
import { usePageActions } from "./components/PageAction";

import PayDashboard from "./pages/payments/PayDashboard";
import PayoutsList from "./pages/payments/PayoutsList";
import PayCalendar from "./pages/payments/PayCalendar";
import PayReports from "./pages/payments/PayReports";
import Networks from "./pages/payments/Networks";
import Users from "./pages/Users";
import Verticals from "./pages/Verticals";
import Log from "./pages/Log";

const PAGES = {
  dashboard: PayDashboard,
  payouts: PayoutsList,
  calendar: PayCalendar,
  reports: PayReports,
  networks: Networks,
  users: Users,
  verticals: Verticals,
  log: Log,
};

/** The title block every screen opens with, drawn from the same list as the sidebar. */
function PageHead({ tab, scoped }) {
  const { scopeUser, viewingOther } = useApp();
  const actions = usePageActions();
  return (
    <div className="pagehead">
      <div>
        <div className="ttl">
          <span className="hic"><TabIcon id={tab} size={21} /></span>
          {TAB_LABELS[tab]}
          {/*
            Said out loud, because every figure below is that one person's rather
            than the company's, and a top-bar dropdown is easy to forget you changed.
            Only on the screens the lens applies to: Users and Vertical are the whole
            company either way, and a badge there would just be a lie.
          */}
          {scoped && viewingOther && (
            <span className="pill a" style={{ marginLeft: 10 }}>viewing as {scopeUser.name}</span>
          )}
        </div>
        <div className="sub">{TAB_SUB[tab]}</div>
      </div>

      {/* whatever the page below registered */}
      {actions && actions.length > 0 && (
        <div className="headactions">
          {actions.map((a) => (
            <button key={a.label} className={"btn " + (a.variant || "primary")} onClick={a.onClick}>
              <IconAdd size={15} style={{ verticalAlign: -3, marginRight: 7 }} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { me, booting } = useApp();
  const [tab, setTab] = useState(null);

  /*
   * Land on Dashboard, and step back to it if the current tab is not one this role
   * has — a manager who was looking at Users when their role changed would
   * otherwise be left on a page the server will only answer with a 403.
   */
  useEffect(() => {
    if (!me) return;
    const allowed = buildTabs(me);
    if (!tab || !allowed.includes(tab)) setTab("dashboard");
  }, [me, tab]);

  if (booting) {
    return <div style={{ padding: 40 }}><Loading what="Starting…" /></div>;
  }
  if (!me) return <Login />;
  if (!tab) return null;

  const Page = PAGES[tab] || PayDashboard;

  /*
   * The five receivables screens. They are the ones the "View team" lens narrows,
   * and the ones whose tables read left-aligned, numbers included — read row by row
   * ("what does Network X owe, and when") rather than scanned down a column, so a
   * left edge is easier to follow across ten columns. The digits stay tabular, so
   * they still line up. Users, Vertical and Log are ordinary company-wide lists:
   * default alignment, and no lens — narrowing an audit trail to one person's
   * verticals would leave a record that still looks complete.
   */
  const scoped = !["users", "verticals", "log"].includes(tab);

  return (
    <Layout tab={tab} setTab={setTab}>
      <PageHead tab={tab} scoped={scoped} />
      <div className={scoped ? "payments-scope" : undefined}>
        <Page setTab={setTab} />
      </div>
    </Layout>
  );
}
