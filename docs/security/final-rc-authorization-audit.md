# Final RC — Authorization, Privacy, and Data-Isolation Audit

Scope: the merged Final RC on `integration/odesseus-final-rc`. This records what
was checked, how, and what changed. It is an audit record, not a design
document — nothing here describes a rebuild.

## Method

Three independent passes, because each catches what the others cannot:

1. **The database, as the real roles.** Actors were created and every
   boundary was *attempted* under `set_config('role', ...)` and a JWT `sub`,
   against the real schema. Reading policies proves intent; attempting the
   operation proves the boundary. `supabase/tests/final-rc-authorization-audit.test.sql`
   is this pass, 75 assertions.
2. **The HTTP layer, as an unauthenticated visitor.** Every API route on disk
   was probed with no cookie and no session, and every deliberately-public or
   machine-to-machine route was probed for whether it reaches its own guard.
   This is the only pass that sees the proxy.
3. **The payloads.** For every accessor, what the service needs versus what the
   response shipped, and whether anything actually consumes the difference.

Two of the three defects found are invisible to unit tests. A route can be
fully implemented, fully mocked, and entirely unreachable; a grant can be
missing and every mocked test still pass. Both were found by probing, not by
reading.

---

## Findings

### 1. Cron routes and the Stripe webhook were unreachable — FIXED

`src/lib/supabase/proxy.ts`

The proxy redirects any unmatched unauthenticated request to `/login`. Both
families are machine-to-machine and have no session by design, so the redirect
was the only answer they could ever receive:

- `/api/cron/*` — all six are scheduled in `vercel.json`. Blocked meant no job
  discovery, no job-feed refresh, no retry-queue processing, no notification
  emails, no interview reminders.
- `/api/webhooks/stripe` — where Stripe posts. Blocked meant no wallet top-ups,
  no subscription sync, no credit grants.

This is the most consequential finding in the audit, and it is invisible from
the code: every route is correct, guarded, and tested, and simply never runs.
Nothing fails loudly — a job that never happens looks exactly like a job with
nothing to do.

**The fix** is a separate `machineApiPrefixPaths` list, exempt from the *session*
check only. It is deliberately not merged into `publicPrefixPaths`, because the
two mean different things: a public entry is "a signed-out browser may fetch
this and be served", and a machine entry is "authenticated by a shared secret,
not by a session". The security boundary is unchanged — it moves from
"unreachable" to "reachable, and refusing every caller that cannot prove the
secret":

- every cron route requires `authorization: Bearer $CRON_SECRET` **and returns
  401 when `CRON_SECRET` is unset**, so a missing secret denies everyone rather
  than admitting everyone;
- the webhook requires a `stripe-signature` verified through
  `webhooks.constructEvent` and rejects a missing or invalid signature before
  touching the database.

Verified at runtime: without a secret every cron route now answers 401 (not
`/login`); with the correct secret `expire-featured-listings` returns
`{"ok":true,"expired":0}`; with a wrong secret, 401. The prefixes are tight —
`/api/cron` and `/api/webhooks` bare still redirect, `/api/webhooks/admin/reset`
is a 404, and path traversal does not escape.

### 2. Employer applicant payloads shipped a full resume to any org member — FIXED

`GET /api/employer/orgs/[orgId]/candidates` and `.../[applicationId]`

Both spread the service accessor's row into the response. That row includes
`resumeSnapshot` — the candidate's entire submitted resume, employment history
and contact details — and `verificationEvidence`, the scorer's evidence bundle.
Neither field is read by any consumer, and the routes are reachable by any org
member including the read-only `viewer` role.

A spread is not a projection. If the service later grows a column, the response
grows with it silently, so both routes now name their fields. The detail route
keeps `jobSnapshot`, which its surface renders. Neither returns a user id, so
there is no id space to pivot on.

### 3. The notification feed shipped internal dispatch columns, and read a column that does not exist — FIXED

`src/lib/notifications/records.ts`, `src/lib/employers/notifications-adapter.ts`

`listNotifications` used `select("*")`, returning to both notification
endpoints: `dedupe_key` (the idempotency token the recorder dedupes on — a
client holding it can tell "shown" from "suppressed"), `email_delivery_status`
(the outbound queue's state), plus `recipient_user_id`, `organization_id` and
other columns no surface reads. The projection is now explicit.

The adapter declared a local type with `body?: string` and read
`detail: row.body`. **No such column exists** — the table stores the text in
`message` — so every employer notification rendered an empty body. A
`select("*")` hid it, because an unknown key reads as "absent" rather than as a
mistake. The local type and the `as unknown as` cast are gone; the adapter now
consumes the real `NotificationFeedRow`, so a projection that stops returning a
field it needs fails to compile here instead of silently rendering nothing.

---

## What was checked and found sound

### Public visitor

Every API route on disk refuses an unauthenticated call: 79 probed, all `307 →
/login` or `401`. `anon` holds `SELECT` on five reference tables and executes
**zero** public functions, so Guest Live is entirely server-mediated rather than
reachable through a broad anon grant.

`/api/countries` and `/api/pricing` are documented as public and are blocked by
the proxy. Nothing calls them over HTTP — the country picker receives its data
as a server-side prop — so they were left alone rather than widened for no
benefit. Worth deciding deliberately: either wire them up and allow them, or
delete the routes.

### Candidate

Sees only their own rows: exactly one profile, one wallet, one interview set,
and zero rows belonging to another candidate. Cannot read any employer surface —
organizations, rosters, jobs, Fit Scores, subscriptions, featured listings,
seats, or Guest Live records.

### Employer

Sees only their own organization. A recruiter in org A reads org A's full roster
and **zero** rows of org B — verified with an admin of A who has no membership
in B at all, so the result is not an artifact of the fixture.

Cannot read any candidate-private surface: wallets, interviews, Live sessions,
Live transcripts, post-interview analysis, notifications, follow-up drafts, the
Resume Hub, Live memberships, the raw `applications` table, or a candidate's
profile row. An employer actor sees only their own profile — every authenticated
user has a candidate profile row, which is expected and not a leak.

### Employer role permissions

Roles are `owner | admin | recruiter | viewer` (text + CHECK; no enum). The
contract, as verified:

| Capability | Admitted |
|---|---|
| read org, jobs, team, candidates, pipeline, analytics, billing, notifications | any member |
| read Fit Score, pipeline transition | owner, admin, recruiter |
| update organization | owner only |
| create/edit/publish/close job | owner, admin |
| invite member, remove member, change notification prefs, plan change, seat purchase, featured purchase | owner, admin |

**No employer role has mutation access by default**, and the guarantee is
stronger than the route checks: `authenticated` holds `SELECT` only on
`employer_organizations`, `employer_members`, `employer_jobs`,
`employer_pipeline_stages` and `employer_fit_scores`. A route that forgot a role
check still cannot be exploited through PostgREST, because the grant is not
there. Two suite sections assert this, because a future `GRANT` would undo it
silently.

No route omits a membership check; all 30 handlers resolve a session and then
authorize.

### Applicant identity

The reader returns exactly `(application_id, candidate_name, candidate_email)`
— asserted structurally, because a reader that also returned a user id would
still pass every "cross-org is denied" test. `anon` cannot execute it, and no
role can `SELECT` from `auth.users`.

Verified end to end: an org A owner, recruiter and viewer each see the
applicant's real name and email for org A's job; omitting the job filter still
returns only org A's applicants; the same owner reading org B's job returns
nothing; a recruiter naming org B is refused; a candidate calling it is
refused; an unrelated employer is refused.

Only `profiles.full_name` is read. `headline`, `location`, `skills`,
`certifications`, `candidate_facts` and social links are not selected, and a
name is never derived from an email local-part.

### Guest Live

No login, no signup, no guest user record, no wallet, no billing. The token is
the whole credential; the owner id never appears in a URL. Invalid, malformed
and random tokens all produce **one** message — verified across eight probes, so
the page is not an oracle for which tokens once existed. A guest cannot write to
or end another guest's session, and a forged `sessionId` is ignored because the
routes resolve their own.

**Token oracle / error behaviour preserved from Task 6**, and re-checked: a
throttle (429) and a server error (500) remain *retryable* rather than being
reported as "this link is no longer active", because a guest has no account and
cannot obtain a new link on the spot.

### Live coding guard

The refusal reaches the rendered UI, not just server state. The engine renders
`guidance.caution` as an independent sibling of the answer block, and suppresses
the "Odesseus only surfaces guidance when it identifies a question" note when a
caution exists — otherwise a deliberate refusal would read as Odesseus having
merely not understood. Verified live for LeetCode, code-fence, take-home and
time-complexity asks; all four return the explicit refusal and no answer.

### Billing and wallet isolation

Candidate wallet is candidate-only and server-controlled: a candidate cannot top
up their own balance or grant themselves passes — both raise
`insufficient_privilege`, and the values are asserted unchanged afterwards.
Employer billing is org-scoped. A guest has neither.

### Gmail / inbox scope

**No mailbox access is reachable.** There is no Gmail scope string anywhere in
the tree — not `gmail.readonly`, not `gmail.modify`, not `https://mail.google.com/`.
There is no IMAP or POP3 client and no mail library in `package.json`; outbound
mail is a single HTTP POST to Resend. The only Google OAuth that actually runs
is Supabase Sign-In with Google, which requests default identity scopes
(`openid email profile`) and no `scope` option at all.

Two residual traces, neither reachable: `email.readonly` and
`calendar.events.readonly` appear only as prose in `docs/integrations/google.md`
and are referenced by no code; the `ODESSEUS_CONNECT_*` connector names appear
in config-check surfaces and are never passed to a token exchange. The
`external_signals` table has a `source` of `email|calendar` but nothing ever
writes it, and its only reader is a function with no production caller.
`docs/development/production-readiness.md` still describes
`/api/integrations/google/connect` and a `google-sync-button` that do not exist
— stale docs, reported rather than deleted, since removing them is not a
security fix.

---

## Tests added

- `supabase/tests/final-rc-authorization-audit.test.sql` — 75 assertions, real
  database roles. Candidate cross-user, candidate-into-employer,
  employer-cross-org, employer-into-candidate, no-role-can-mutate,
  wallet-self-grant, privilege escalation by insert, anon access, and the
  identity reader's return type.
- `tests/unit/final-rc-boundaries.test.ts` — walks the route tree and asserts
  that nothing sensitive is exempt from the session check, and that no public
  page renders Live or a Live price. The marketing scan excludes comments,
  because one page *documents* that it does not mention Live; scanning raw
  source would flag the comment and train a reader to expect false positives.
- `tests/integration/api-data-minimisation.test.ts` — the two projection fixes.
- `tests/unit/proxy-public-surfaces.test.ts` — extended for the machine paths,
  including that every cron in `vercel.json` is actually exempted and has a
  route file, so the two lists cannot drift.

No existing test was weakened.

---

## Known limitations, carried forward

- `GET /api/wallet/transactions` still returns `external_reference` (a Stripe
  payment reference) and `metadata`, which its consumer does not read. Left
  alone: it is the caller's own data, and an existing test pins the response
  shape.
- `POST /api/interviews` still returns the whole inserted row via a bare
  `.select()`. It is the caller's own newly-created row, and no client consumes
  the route.
- The fit-score route returns five bookkeeping fields (`id`, `modelVersion`,
  `versionNumber`, `createdAt`, `updatedAt`) its consumer does not read. Org
  scoped and non-sensitive.
- `odesseus_private.is_org_hiring_manager` is defined but referenced by no
  policy, route or service function; hiring-manager gating lives in TypeScript.
  Dead code, not a hole.
- `isTrustedOrigin` is absent on `PATCH org`, `POST/PATCH jobs`, `POST pipeline`,
  `POST fit-score` and the notification writes. It is a supplement to SameSite
  cookies, not the primary defence.
- Two employer routes (`analytics`, `dashboard`) pass a route-checked `orgId` to
  a service-role RPC that does not re-prove membership. The route's `getOrgRole`
  is the only org boundary there, and the service re-asserts the returned org id.
