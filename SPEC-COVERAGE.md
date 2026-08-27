# Spec coverage

Section-by-section against `PAYMENTS-RECEIVABLES-SPEC.md`. Verified by
`npm --prefix server run test:spec` (93 checks) and `npm --prefix server test` (144).

## Built

| § | Requirement | Where |
|---|---|---|
| 3.1 | `payouts` — every field in the table, plus netTerms, currency, payMethod/payAccount, writeOffReason | `server/src/models/Payout.js` |
| 3.1 | One payout row per (campaign × network), independent dates and amounts | verified in `spectest.mjs` §9 |
| 3.2 | `payout_txns` — every field, all five deduction reasons, invented reasons rejected | `server/src/models/PayoutTxn.js` |
| 4 | Create → pending, expected date = earned month + net terms | `services/payouts.js` `expectedDateFrom` |
| 4 | Reconcile: received / cut+reason / carry+month, totals updated | `services/payouts.js` `reconcile` |
| 4.2 | Carry-forward auto-creates the child payout, `parent_id` set, inside a transaction | same, via `withTransaction` |
| 4.3 | Status order: received → partial → overdue → pending; write-off sticks | `computeStatus` |
| 4 | **The spec's worked example runs exactly as written** — $5,000 → 3500+1000+500, $500 child, settled in Nov, $4,000 cash / $1,000 lost | `spectest.mjs` |
| 5.1 | Payments table, filters (status/network/vertical/earned month/expected month + search), all columns, Reconcile / Edit / Write-off | `pages/payments/PayoutsList.jsx` |
| 5.2 | Add payout — campaign, network, vertical, earned month, amount, net terms **or** explicit date | `PayoutModal.jsx` |
| 5.3 | Reconcile dialog with received / deduction+reason / carry+month / note | `ReconcileModal.jsx` |
| 5.4 | KPIs: total outstanding, expected this month, received, cut, overdue + by network / by vertical | `PayDashboard.jsx`, `services/receivables.js` |
| 5.5 | Payment calendar grouped by expected month, "how much, from whom" | `PayCalendar.jsx` |
| 5.6 | Overdue: status, `isOverdue` flag, filter, KPI, boot+timer sweep, Telegram via `logAudit`, announced once per payout | `services/payouts.js` `scanOverdue` |
| 6 | By earned month · by received month · by network reliability (on-time %, cut rate, avg delay) | `PayReports.jsx` |
| 7 | Manager = own verticals, admin = all, re-checked server-side on every route | `utils/scope.js`, `routes/payouts.js` |
| 8 | Every named route, plus `/txns`, `/adjust`, `/unwriteoff`, `/outstanding`, `/scan-overdue` | `routes/payouts.js` |
| 9 | Same campaign × many networks · partial payments across months · **over-payment** · write-off as a loss · immutable txns with adjusting entries · currency per payout | see `spectest.mjs` §9 |
| 10 | Audit + Telegram hook reused; new sidebar entry for admin + manager | `utils/audit.js`, `tabs.js` |

## Not built — and why

These three all depend on the **booked** side of the CRM (revenue − ad spend per
month), which is the half you asked to leave out. This build has no `Month` model and
no spend data, so there is nothing to compute them from — they are not skipped work,
they have no input.

| § | Requirement | Status |
|---|---|---|
| 5.2 | "Optionally bulk-create from a closed month's booked revenue" | **cut** — read booked revenue out of the CRM's month rows |
| 5.7 | "Booked vs Realized in Company View" | **cut** — Company View is one of the pages you removed, and booked profit needs ad spend |
| 6 | "Realized vs booked trend" | **replaced** — the Report tab's fourth view is a **Collection trend** instead: expected vs received vs cut vs still-owed, month by month, built from payouts alone |

Everywhere else the spec says "realized profit" (received − ad spend), this build can
only show **realized cash** (received). Add the spend side back and the profit figures
follow without changing the receivables model.

Two smaller notes:

- **Telegram** fires through the existing `logAudit` hook, but only actually sends
  when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `server/.env`. Unset, it
  silently no-ops — by design, so a dead bot token can never fail a request. The
  parent repo's `/api/test-telegram` button was dropped in the trim; say the word and
  it comes back.
- **§9 FX** — `currency` is stored per payout and `fx` is a valid deduction reason, but
  there is no per-transaction FX rate field. The spec marks that optional / phase 2.
