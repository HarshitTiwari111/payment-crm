# Payment CRM

Receivables tracking for an affiliate operation: what each network owes, what
actually arrived, what was cut in validation, what slipped to a later month.

Trimmed from [task-crm](https://github.com/HarshitTiwari111/task-crm) — the goal and
performance side of that build is gone. What is left is the Payments module, split
into its own screens, plus the two lists it is filed against.

## Roles

Two, and only two.

| | admin | manager |
|---|---|---|
| Verticals visible | all | only those on their account |
| Payouts, calendar, reports, networks | yes | yes, inside their verticals |
| Delete a network / a vertical | yes | no |
| Confirm a payment arrived | yes | no — they can see the answer, not give it |
| Users screen | yes | not shown, and blocked server-side |
| Log | yes | not shown, and blocked server-side — their own sign-ins, yes |
| Import from a sheet | yes, all of it | yes, the rows in their own verticals — the rest are listed, not dropped |

A manager's verticals *are* their permissions, which is why only an admin edits
accounts — granting yourself a vertical would leave the scoping decorative. Every
rule above is re-checked on the server; the sidebar only decides what is drawn.

### View team

The navbar's first dropdown lets an admin read the five money screens through one
manager's eyes — pick a name and the dashboard, payouts, calendar, reports and
networks narrow to exactly that person's verticals, with a *viewing as* badge on the
page title. Users and Vertical are company-wide lists and stay as they are.

It rides on every request as an `X-View-As` header. The server ignores it for anyone
who is not an admin, so a manager cannot widen their own view with it, and it never
changes who is recorded as the actor in the audit trail. The lens applies to writes
too: while viewing as Priya, a new payout can only be filed in Priya's verticals.

## Screens

1. **Dashboard** — this month's position: outstanding, expected, received, cut, overdue.
2. **Payout** — every payout, with filters, reconcile, adjust, write off, confirm.
3. **Calendar** — what is due, month by month.
4. **Report** — by earned month, by received month, network reliability, collection trend.
5. **Network** — the partners who pay, and their default net terms.
6. **Users** — accounts and their verticals (admin only).
7. **Vertical** — verticals and sub-verticals.
8. **Log** — who signed in, and who changed what (admin only).

## Running it

Two processes. The API is on `:4000`, the client on `:5173` and proxies `/api` to it.

```bash
npm install --prefix server && npm install --prefix client
```

Then, in one terminal — this starts a throwaway MongoDB, so nothing to install:

```bash
npm --prefix server run dev:memory
```

The data disappears when you stop it. To keep it, run a real MongoDB, point
`MONGODB_URI` at it (see `server/.env.example`) and use `npm --prefix server run dev`.

In a second terminal:

```bash
npm --prefix client run dev
```

Open http://localhost:5173. The first boot seeds one admin — username `admin`,
password `changeme123`. Change it from the avatar menu before anything else.

## Tests

```bash
npm --prefix server test
```

277 checks driven over real HTTP with real cookies — sessions and refresh, the role
gates, vertical scoping, the payout ledger (partial payment, cut, carry-forward,
adjustment, write-off), every report, the View team lens and the attempts to abuse
it, and the log — including a manager being refused it.

```bash
npm --prefix server run test:spec
```

93 more, against `PAYMENTS-RECEIVABLES-SPEC.md` specifically: the §4 worked example
run literally, every §9 edge case, and the §8 routes by name. See
[SPEC-COVERAGE.md](SPEC-COVERAGE.md) for what the spec asked for and what this build
does about each line of it.

Both suites **write**, so run them against `dev:memory`, never against real data.
`test:spec` stamps every row it creates with a per-run tag and can be run over and
over on the same database; `test` counts totals and needs a freshly seeded one, so
restart the server before it.

> Stop `dev:memory` with Ctrl-C, not by killing the process. It cleans its temporary
> database directory on a graceful exit; force-kill it enough times and the leftovers
> will quietly fill your disk (they live in `%TEMP%\mongo-mem-*`).

## Production

`npm --prefix client run build` writes `client/dist`, which the API serves itself —
so a deploy is the one Node process.

`client/dist` is a build artefact and is not in git. That is worth saying plainly,
because `git pull` on a server updates the API and leaves the screens exactly as
they were: the symptom is a deploy where a fix that is plainly in the code has no
effect in the browser, and where two servers on the same commit disagree about what
the app looks like. **Every deploy is pull, then build, then restart:**

```bash
git pull && npm ci --prefix server && npm ci --prefix client && npm --prefix client run build
```

then restart the API process. A host that runs its own build command on each deploy
(Render and the like) does this already; a VPS you pull to by hand does not.

Three things must be set in the environment, and the server refuses to start without
them rather than falling back to something weaker:

| | |
|---|---|
| `JWT_SECRET`, `REFRESH_SECRET` | generate each with `openssl rand -hex 48` |
| `ADMIN_PASS` | only checked when there is no admin yet — the dev default is printed above, so seeding the first one with it would publish the password |
| `NODE_ENV=production` | without it the app still runs, but sends no CSP and no HSTS. It says so at boot when the secrets are set and this is not |

`CLIENT_ORIGIN` is only needed if the client is served from somewhere other than this
process — it is the list (comma-separated) of origins allowed to call the API with
credentials. Unset means none, which is right for the single-process deploy above.

## Importing from a sheet

Payout → **From sheet**. Paste the link to a Google Sheet, read it, see what it
would do, then import. Nothing is written until the second click, and the preview
is the same read the import performs — reported instead of applied.

Both roles, because keeping the sheet is the job of whoever keeps it. The scoping
is in what a run brings in rather than in who may open it: a manager imports the
rows in their own verticals, and the rest are counted and named vertical by
vertical on the screen. Half a sheet imported would otherwise look exactly like
all of it, and the missing half is noticed weeks later when a total is wrong.

The server has no Google account of its own. It opens the link the way a stranger
would, so the sheet has to be readable by anyone holding it: **Share → Anyone with
the link → Viewer**, or **File → Share → Publish to web**. A sheet that still wants
a login is named as that rather than read as an empty one.

Headers are matched loosely — case, spaces and punctuation ignored, several names
per field — because a working sheet spells things the way it always has, typos
included. What it looks for:

| Sheet column | Becomes | Needed |
|---|---|---|
| Network name | the network | yes |
| Month (`May'26`, `2026-05`, `May 2026`, `05/2026`) | earned month | yes |
| Actual Revenue | what is owed | yes, and above zero |
| an id column, else a spare campaign column, else campaign + network + month | how a re-run recognises the row | — |
| Campaign Name | the campaign | no |
| Vertical, Sub-vertical | where it is filed | no — pick one in **File rows under** instead, which fills any row the sheet leaves blank |
| Ad Cost, Overall Revenue | the spend side | no |
| Received Amount, Payment Received Date | a reconciliation, posted with the payout | no |
| Bank Account | how it is paid | no |

Most of these sheets have no vertical column, because one sheet is kept per
vertical and nobody writes the same word on every row. **File rows under** is that
answer, given once: it fills in any row whose own vertical is blank, and it offers
only the verticals the person importing actually holds — it is a view of their
scope, never a way around it. A sheet that does name a vertical per row keeps its
own.

Profit is never imported. It is revenue less cost, worked out on read, so a column
of it in the sheet is left alone rather than stored a second time.

Rows that cannot become a payout — no network, an unreadable month, zero revenue —
are counted and listed rather than guessed at, and a row imported before is left
exactly as it is. Once a payment has been reconciled here the sheet and this app
have diverged on purpose; an import that wrote over that would undo the work on
every run.

## Layout

```
server/src
  routes/      auth · users · taxonomy · payouts · log · sheet
  services/    auth (sessions, 2FA) · payouts (ledger) · receivables (reporting)
  models/      User · Payout · PayoutTxn · Network · Campaign · Vertical · …
  middleware/  auth (who) · security (headers, limits) · validate (zod)
client/src
  pages/payments/   the five receivables screens
  pages/            Users · Verticals · Log
  components/       Layout, Login, and the shared pieces
  context/          session + the Vertical / Month selectors
```
