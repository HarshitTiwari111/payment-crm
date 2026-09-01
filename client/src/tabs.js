/*
 * The sidebar.
 *
 * The five receivables tabs, plus the two lists the rest of the app is filed
 * against — the people who use it and the verticals the money is booked under —
 * plus the log, which is the record of both.
 *
 * This list decides what is DRAWN, never what is allowed — every route behind it is
 * checked again on the server. Hiding a tab is a convenience, not a control.
 *
 * Icons live in icons.jsx and are looked up by the same id.
 */
export const TAB_LABELS = {
  dashboard: "Dashboard",
  payouts: "Payout",
  calendar: "Calendar",
  reports: "Report",
  networks: "Network",
  users: "Users",
  verticals: "Vertical",
  log: "Log",
};

/** Sub-titles for the page header, so each screen says what it is for. */
export const TAB_SUB = {
  dashboard: "This month's position: what is owed, what arrived, what is late.",
  payouts: "Every payout on record — filter, reconcile, write off.",
  calendar: "What is due, month by month, so nothing is chased late.",
  reports: "Where the money went: by earned month, by cash month, by network.",
  networks: "The partners who owe us, and their default payment terms.",
  users: "Who can sign in, and which verticals they answer for.",
  verticals: "The verticals every payout is filed under.",
  log: "Who signed in, and who changed what.",
};

/*
 * Which header controls each screen actually obeys.
 *
 * The two selectors used to be drawn on every screen and read by almost none of
 * them: Vertical was wired to nothing at all, and Month only reached the Dashboard
 * and the Report. Picking September on the Payout page changed nothing, which reads
 * as broken data rather than as a control that does not apply — so a screen that
 * ignores one no longer draws it.
 *
 * Month is the earned month wherever it is drawn, including on Payout, where it
 * replaces the filter that used to sit in the bar below.
 */
export const USES_VERTICAL = new Set(["dashboard", "payouts", "calendar", "reports"]);
export const USES_MONTH = new Set(["dashboard", "payouts", "reports"]);

/*
 * Where an empty month is a real answer, so the header offers a way back to it.
 *
 * Payout is the whole ledger and has to be able to show every month at once. The
 * Dashboard and the Report cannot: each renders one month's figures, so clearing
 * the picker there would leave them with nothing to draw, and they fall back to the
 * current month rather than break.
 */
export const MONTH_OPTIONAL = new Set(["payouts"]);

/**
 * Which tabs a role sees.
 *
 * Accounts are an admin matter — a manager who could edit accounts could grant
 * themselves the verticals they are scoped out of, which would make the scoping
 * decorative. Everything else is shared; what differs for a manager is the data
 * behind it, which the server narrows to their own verticals.
 */
export function buildTabs(me) {
  if (!me) return [];
  // Vertical before Users: an account is created against verticals, so the list it
  // is filed under comes first.
  const ids = ["dashboard", "payouts", "calendar", "reports", "networks", "verticals"];
  if (me.role === "admin") ids.push("users", "log");
  return ids;
}
