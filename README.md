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
| Users screen | yes | not shown, and blocked server-side |

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
2. **Payout** — every payout, with filters, reconcile, adjust, write off.
3. **Calendar** — what is due, month by month.
4. **Report** — by earned month, by received month, network reliability, collection trend.
5. **Network** — the partners who pay, and their default net terms.
6. **Users** — accounts and their verticals (admin only).
7. **Vertical** — verticals and sub-verticals.

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

144 checks driven over real HTTP with real cookies — sessions and refresh, the role
gates, vertical scoping, the payout ledger (partial payment, cut, carry-forward,
adjustment, write-off), every report, the View team lens and the attempts to abuse
it.

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

## Layout

```
server/src
  routes/      auth · users · taxonomy · payouts
  services/    auth (sessions, 2FA) · payouts (ledger) · receivables (reporting)
  models/      User · Payout · PayoutTxn · Network · Campaign · Vertical · …
  middleware/  auth (who) · security (headers, limits) · validate (zod)
client/src
  pages/payments/   the five receivables screens
  pages/            Users · Verticals
  components/       Layout, Login, and the shared pieces
  context/          session + the Vertical / Month selectors
```
