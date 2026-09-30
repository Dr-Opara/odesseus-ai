# Task 8 — Real Integration Testing and Functional Blocker Resolution

Branch: `integration/odesseus-final-rc`

Task 7 audited the code. This task exercised it. Every finding below was
reproduced against the real local Supabase stack over real HTTP with real
Supabase-issued session cookies, not read off a screen. Where a finding could
only be reached with a provider credential that is not configured, it is
recorded as a blocker and the exact variable is named rather than asserted past.

## Method

Seven flows run against `supabase start` + `npm run dev`:

| Script | Covers |
| --- | --- |
| `scripts/local-flow-1-employer-writes.mjs` | org creation, org PATCH, job create/edit/publish/close/delete |
| `scripts/local-flow-2-capacity.mjs` | plan capacity, credit consumption, idempotency |
| `scripts/local-flow-3-employer-authz.mjs` | the full role × org matrix, forged ids, anonymous |
| `scripts/local-flow-4-employer-reads-seats.mjs` | candidates, Fit Score, pipeline, analytics, team, notifications, seat checkout |
| `scripts/local-flow-5-candidate.mjs` | profile, localization, jobs, match, wallet, apply eligibility, tracked-job status, interviews, entitlement |
| `scripts/local-flow-6-resume.mjs` | storage bucket isolation and resume upload |
| `scripts/local-flow-7-guest-live.mjs` | share links, setup, session, activation, transcript, end, analysis, isolation |

Sessions are real: each flow signs in through GoTrue with
`@supabase/ssr` against an in-process cookie store and replays the exact cookies
the server set. No mock, no fabricated JWT, no fixture-flagged success.

The keys come from the environment, not from the harness, and it exits with
instructions when they are absent:

```
node --env-file=.env.local scripts/local-flow-1-employer-writes.mjs
```

A credential in version control is a credential in version control even when it
is a local-stack value, and the first attempt at this harness hardcoded them and
was correctly refused by the remote's secret scanner.

**The probes repeatedly found things the code did not say.** The `seats` /
`seatCount` mismatch was in the code. The false success on a zero-row update was
only visible by writing to another candidate's row and reading the database
afterwards. The storage failure was only visible in the storage container's log,
where the failing statement named the missing index.

---

## 8A — Employer write paths (resolved)

`authenticated` holds SELECT only on every employer table. That is the correct
default — a missing role check must not be exploitable through PostgREST — and
it has a consequence: the session client cannot perform the write either, because
it is the same role. So job create/edit/publish/close/delete and the org PATCH
failed for every role, including the owner.

Fixed with `src/lib/employer/authorized-write.ts`. `grantOrgAdminWrite` proves
the role **on the session client**, where RLS decides membership, and returns a
service client *only once that has passed*. The credential is returned by the
check rather than created at the call site, so a route cannot reach a privileged
client without having passed the check — there is no other way to obtain one.

What did not change:

- no `GRANT`; `authenticated` still cannot write any employer table
- no RLS policy touched; the membership proof is still RLS's answer
- no credential in the browser; the service client is server-only
- cross-org writes still impossible: every mutation filters
  `.eq("org_id", orgId)` against the same id the check ran on, and the org PATCH
  additionally filters `.eq("owner_user_id", userId)`

Verified live: 26/26 writes, 11/11 capacity, 41/41 authorization matrix.
Capacity is exactly right — 3 publishes on Starter, 4th and 5th refused with
`at_capacity`, exactly 3 credits consumed, closing one frees exactly one slot,
and editing a published job consumes no second credit.

## 8B — Recruiter seat checkout (resolved)

Both callers sent `seats`; the endpoint's schema names `seatCount`, which is also
the Stripe metadata key `odesseus_seat_count` the webhook re-verifies. The
endpoint is authoritative, so the callers were wrong: sending `seats` meant
every seat purchase was refused with a 400 before reaching Stripe.

Both callers now send `seatCount`. No second billing mechanism was introduced.
`local-flow-4` asserts the whole contract: `seats` still refused, `seatCount`
accepted, `0` / `1.5` / `101` / `"3"` all refused, `1` and `100` accepted, viewer
and non-member refused, and the catalog is $20.00 billed monthly per seat.

**Idempotency and webhook reconciliation are not verified.** No Stripe
credentials exist here; see the blockers.

## 8C — Real local Supabase

`supabase db reset --local` from zero, then every flow above against it.

Candidate: signup/login, profile, localization (including that a field outside
the six-field whitelist is *not* written), resume, jobs, Match, wallet, apply
eligibility, tracked-job status, interview creation, Live entitlement — 80/80.

Employer: org creation, onboarding, org PATCH, job create/edit/publish/close,
capacity, candidate list and detail, Fit Score, pipeline transition, analytics,
team, notifications — 47/47 and 41/41 and 11/11.

Guest: link minting, opening with no session, setup, session, activation,
transcript, end, post-analysis, isolation — 78/78.

## 8D / 8F — Stripe and provider credentials (blockers)

Not exercised. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`OPENAI_API_KEY` are unset in this environment, and no test-mode keys are
configured. Nothing was fabricated.

What *was* verified without them, and is worth stating because it is the part
that does not need the provider:

- every checkout route answers `503 Billing is not configured.` when the Stripe
  key is absent, and says so before touching Stripe
- catalog prices are correct as source: seats $20.00/month, plans
  $79/$149/$299, featured $29/$49/$129 for 7/14/30 days
- the wallet credits only through a `billing_events` row, and **replaying the
  same `stripe_event_id` does not credit twice** (the replay is a 409 and the
  balance is unchanged) — the idempotency mechanism, exercised through the same
  table the webhook writes
- `marketing_admin` and an unknown role are both refused the ability to move a
  candidate's money, by the database rather than only by the route
- Match, job discovery and Apply all fail closed with `INTEGRATION_NOT_CONFIGURED`
  and name the missing variable rather than inventing a result
- Live activation does not call the provider at all: the browser holds the
  realtime credential and hands the session id back, so the server records the
  transition. The state machine and place accounting were verified in full; the
  realtime connection was not, because minting an answer needs the key
  (`OpenAI Realtime is not configured.`)

## 8E — Live activation (verified as far as infrastructure allows)

Applicant side is covered by the existing suite. Guest side, live: a 64-hex
token per link, different each time; a signed-out guest opens the link; setup
records the *guest's* details, not the owner's; activation before a session
exists is refused with 409 by ordering, not by luck; activation with a supplied
session id moves the session to `active`; reconnecting is idempotent and creates
no second session; the transcript turn is durable and replaying a realtime item
id does not duplicate it; end and post-analysis are served. Bad tokens all get a
byte-identical answer, so there is no oracle distinguishing a wrong token from a
spent one. The guest page is `noindex`.

The coding-interview refusal still renders: `appendTranscriptItem` returns a
caution-only guidance in the same snake_case shape as a successful answer, so
the engine reads one shape either way.

## 8G — API contract cleanup

`POST /api/interviews` returned `select()` — the whole row, including
`transcript_storage_path` (a pointer into a private bucket) and
`source_external_id` / `source_signal_id`. Narrowed to named columns. Safe
because nothing in the app posts to that route: the four
`/api/interviews/[id]/*` routes are the ones with callers, so there is no
consumer shape to preserve.

`/api/wallet/transactions` was left alone. `external_reference` and `metadata`
are the candidate's own, the shape is pinned by
`tests/integration/wallet-api.test.ts`, and the reconciliation use
(`external_reference` carrying the Stripe event id) is real. Narrowing it would
be churn.

## 8H — Dead and stale items

**`/api/countries` and `/api/pricing` — deliberate choice: private.** Nothing
fetches either over HTTP; the country pickers and the pricing surfaces are
server components that read the catalog directly. A signed-out request is
redirected (verified: 307), not served. `docs/development/global-identity.md`
claimed "public … No session required", which was wrong, and now documents what
the code does and how to change it deliberately. `docs/development/pricing-engine.md`
now distinguishes the tables' public `anon` grant from the routes' session
requirement, because conflating them is what produced the original finding.

Widening the proxy for an endpoint with no signed-out caller would enlarge the
reachable surface for nothing.

**`/api/cron/expire-featured-listings` — added to `vercel.json`.** It was
implemented and guarded but never scheduled, so featured listings never expired.

**CI ran no database tests at all.** `.github/workflows/ci.yml` ran lint, type
check, `npm test` and build. The 34 pgTAP files — the RLS audit, the Task 7
cross-actor authorization audit, the wallet ledger, the seat policy, Live guest
access — never executed, so a change to a `GRANT`, a policy or a
`SECURITY DEFINER` function could merge having passed only the tests that mock
the database. Added a `database` job: start, `db reset --local`, `db lint`, then
`test db --local`. This was the highest-value finding in the task: the
repository's strongest evidence was ungated.

**`is_org_hiring_manager` — reported, not removed.** Zero application
references; only a definition in one migration and an assertion in one pgTAP
file. Removing it means editing a migration plus its test for no behavioural
gain.

**Stale Google docs are not stale.** The mentions in
`docs/development/production-readiness.md` are audit narrative describing a
false start that was self-corrected, and the files they name
(`/api/integrations/google/connect/route.ts`, `src/components/google-sync-button.tsx`,
`src/lib/integrations/google-sync.ts`) are genuinely gone. Rewriting the record
would destroy it.

---

## Defects found and fixed

Probing found these; reading the code did not.

### 1. A write that reported success without writing — `jobs/[id]/status`

`POST /api/jobs/[id]/status` filtered on `user_id`, so another candidate's id
or a nonexistent one matched zero rows — but only the *error* was inspected, so
it answered `200 {ok: true}`. A candidate was told a tracked job's status had
changed when nothing was written.

Reproduced: attacker session, victim's `job_opportunities` id, `status=200
{"ok":true}`, victim's row unchanged.

The write was correctly scoped, so this was not a leak. It was a false success,
which is the same class of harm: the standing rule is that nothing is reported
as done until the backend confirms it.

Fixed with `.select("id, status").maybeSingle()` and a 404 when nothing matched.
Cross-user, nonexistent and non-uuid ids now all answer 404; the owner's own
write returns `200 {ok: true, status}`.

A non-uuid id additionally reached Postgres as a `uuid` cast and surfaced as a
500, so that is refused as a 404 first.

### 2. Internal error text returned to the caller — four routes

`interviews/[id]/memory`, `interviews/[id]/post-analysis`,
`interviews/[id]/readiness` and `live/guest-access/[token]/session/post-analysis`
each answered a 500 whose body was `error.message` — the last thing the model,
the database or the provider said, which carries a PostgREST code or a
constraint name as readily as anything useful. The product sentence already
existed in each handler as the `else` branch; the handler preferred the
diagnostic over it. The detail now goes to the log.

`live/guests`' revoke is deliberately left: there the RPC's message *is* the
product's answer ("an activated guest cannot be handed to somebody else"), and
the handler says so.

### 3. A 500 carrying the raw thrown message — the interview workspace

`buildInterviewContext` threw a plain `Error("Interview not found.")` and the
route's catch-all reported any throw as a 500 with the message. Asking about
another candidate's interview is an *ordinary* outcome and answered as a server
fault, with internal text. `InterviewNotFoundError` now distinguishes it: 404
with a safe message, and a genuine failure keeps the 500 but loses the text.

### 4. A provider failure broke a live interview

`appendTranscriptItem` persisted the transcript turn, then called
`generateLiveGuidance` unguarded. The provider's throw propagated out of both
transcript routes as a bare non-JSON 500 — losing the confirmation that the turn
was recorded and breaking the session for somebody mid-interview.

The turn is durable before guidance is generated, so this is now a successful
append carrying `guidanceUnavailable: true`, threaded through both transports
and rendered by the panel as one calm line. It is deliberately distinct from
`isQuestion: false`, which means "there was nothing to answer": both leave
`guidance` null, and without the flag a candidate mid-interview would read our
failure as Odesseus having stopped listening.

### 5. Eight employer routes 500'd on a malformed org id

`jobs`, `jobs/[jobId]`, and all five notification routes reached Postgres with
whatever was in the path segment. Fourteen sibling routes already validated it
and answered 404; these did not, and answered 500. Same guard, same message.

### 6. A missing configuration answered 500 — four routes

The three employer checkout routes and the candidate checkout action checked
`NEXT_PUBLIC_SITE_URL` and called that "the billing configuration". With the
site URL set and `STRIPE_SECRET_KEY` absent, `getStripe()` threw and the caller
got an unhandled 500 where the route plainly meant 503. A missing key is a
deployment state, not a fault in the request.

---

## Findings reported but not fixed

### ~~Live share links are not drawn against the guest-place allowance~~ — **not a defect; finding retracted**

The Task 8 report read this as a revenue-bound bypass. It is not. The approved
Live Share model has **no guest cap**: no allowance, no slot consumption, no
concurrency accounting, no activation window, no post-interview expiry. A Share
Annual holder generates secure links and shares them, so "a link does not consume
one of ten places" is the product working, not a hole in it.

Reconciled in `supabase/migrations/20261121000000_retire_live_guest_quota.sql`,
which removes five enforcement points that a stale model had left behind. The
audit for it was worth doing regardless, because it found that the retired column
was still deciding authorization — see below.

### What the reconciliation actually found

`guest_limit` was not inert. Five separate places still depended on it, and one of
them was an authorization gate:

| # | Place | What it did |
| --- | --- | --- |
| 1 | `odesseus_create_live_guest_invite` | **`v_membership.guest_limit < 1` → raise** |
| 2 | `enforce_live_guest_cap` trigger | raise 'guest limit reached' past the cap |
| 3 | `live_memberships_guest_count_within_limit` | `CHECK (guest_count <= guest_limit)` |
| 4 | `live_memberships_personal_has_no_guests` | `CHECK (plan_type = 'share_annual' OR guest_limit = 0)` |
| 5 | three bookkeeping functions | did nothing at all when `guest_limit` was 0 |

#1 is the serious one. `guest_limit` defaults to 0, so a Share Annual membership
created without an explicit limit could not issue a single emailed invitation —
a paying customer silently denied, inside the database, where no API-level test
reaches. It would not have been caught by a test that sets `guest_limit = 10`,
which is what the Task 8 harness did and what therefore masked it.

#5 is the quiet one. Each of the three read `guest_limit` and skipped its work
when it was zero: the counter stopped maintaining `guest_count`, prior-period
entitlements stopped being expired on renewal, and the rollover stopped running.
Removing the catalog's `guest_limit` key without decoupling them would have made
history and counters go quietly stale — no error, just wrong numbers.

Authorization is now plan-only everywhere, and
`tests/unit/live-guest-no-quota.test.ts` asserts that structurally.

### ~~Resume upload cannot be exercised against this local stack~~ — **resolved: local toolchain drift**

Every Storage API upload failed with
`42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`.
The cause was **not** the application and **not** the schema, and no Supabase-owned
object was modified to work around it.

The local stack is a set of container images. The **storage-api binary** issues

```sql
INSERT INTO storage.objects (...) ON CONFLICT (name, bucket_id) DO UPDATE
```

and the **Postgres image** seeds `storage.objects`. Postgres needs a unique index
on exactly that column pair for the `ON CONFLICT` to resolve, and the image's
baseline carries only partial and version-scoped indexes, which cannot serve as
an arbiter. Our migrations insert buckets and add policies; they never touch
`storage.objects`, so the schema was never wrong.

What was wrong was the pair of images:

| Component | Running | CLI 2.118.0 expects |
| --- | --- | --- |
| `storage-api` | **v1.73.1** (3 weeks old, left over from an earlier pull) | v1.77.0 |
| `postgres` | 17.6.1.171 (2 weeks old) | 17.6.1.171 |

A v1.73.1 binary against a newer database baseline. Reconciling the pair with
`supabase stop && supabase start` moved storage-api to v1.77.0, and uploads
succeeded with **no schema change at all** — own path 200, another user's path
refused by RLS with 403, anonymous refused with 400, master resume registered,
and tailor then reaching the provider instead of stopping on its precondition.
`scripts/local-flow-6-resume.mjs` now passes 7/7.

**The structural cause is that nothing pinned the CLI.** It was not a
devDependency, not referenced by any npm script, and CI asked
`supabase/setup-cli` for `latest`. Every developer and every run got whatever
version npm happened to serve, and `supabase start` would happily leave an older
image in place. A drift like this is invisible: not in the schema, not in
`db lint`, not in any project file. It surfaces only as a runtime failure deep
inside a provider, with an error naming an index the project never created.

Fixed by pinning rather than by patching:

- `supabase` is now a **devDependency at 2.118.0**, with the lockfile committed
- every entry point is an npm script — `npm run db:start`, `db:reset`, `db:test`,
  `db:lint` — so the pinned binary is the only one anyone runs
- CI requests that exact version instead of `latest`

Do not `npx supabase@latest`. That reintroduces exactly this.

**Still required before production merge:** verify resume upload against the
Vercel Preview environment and its non-production Supabase project. The local
stack is now sound, but "the local stack works" is not the same as "the hosted
storage path works", and the hosted project has a different storage schema and a
different storage-api build. That check belongs where the real thing is.

### Guest Live commercial model reconciled

Live Share has **no guest cap**: no allowance, no slot consumption, no concurrency
accounting, no activation window, no post-interview expiry. A Share Annual
holder generates secure Guest Live Access links and shares them. The retracted
finding above was this product working, not a hole in it.

What the audit for it found is worth recording on its own, because the retired
model had five enforcement points left behind and one of them was an
authorization gate:

| # | Where | What it did |
| --- | --- | --- |
| 1 | `odesseus_create_live_guest_invite` | **`v_membership.guest_limit < 1` → raise** |
| 2 | `enforce_live_guest_cap` trigger | raise 'guest limit reached' past the cap |
| 3 | `live_memberships_guest_count_within_limit` | `CHECK (guest_count <= guest_limit)` |
| 4 | `live_memberships_personal_has_no_guests` | `CHECK (plan_type = 'share_annual' OR guest_limit = 0)` |
| 5 | three bookkeeping functions | silently did nothing when `guest_limit` was 0 |

#1 is the serious one. `guest_limit` defaults to 0, so a Share Annual membership
created without an explicit limit could not issue a single emailed invitation —
a paying customer silently denied, inside the database, where no API-level test
reaches it.

It survived this long because **the Task 8 harness set `guest_limit: 10`**. A
fixture that fills a retired column makes the gate it guards invisible. The
harness now leaves the column at zero, so the whole flow is the proof:

```
[PASS] the retired column is still zero and access is unaffected
       -- guest_limit=0 while the owner can still mint links
```

#5 is the quiet one. Removing the catalog's `guest_limit` key without first
decoupling those three would have left counters and history silently stale: each
read the column and skipped its work when it was zero. They now run on the event,
not on a number.

Removed: the service-layer refusal, the trigger, both CHECK constraints, the
`guest_limit` metadata key on the reference catalog, the `guest_limit`-gated
branches in three functions, the `guest_limit` gate in the invitation RPC, the
API fields and UI copy that displayed a remaining count, `LIVE_SHARE_GUEST_LIMIT`,
and the `guest_limit_reached` status mapping.

Retained: `live_memberships.guest_limit` / `guest_count`, and the
`live_guest_entitlements` table. They have real rows and foreign keys, both
bookkeeping triggers, and `COMMENT`s saying they are historical and gate
nothing. No `DROP TABLE`, no `DROP COLUMN`.

Access is now plan-only:

```ts
canGenerateGuestLinks(row) =>
  row.has_access && row.is_owner && row.plan === "share_annual";
```

plus the security of the token itself and the per-token rate limits, which are
**abuse protection, not a commercial quota** — they bound how fast one token can
be hammered, not how many guests a member may have.

`tests/unit/live-guest-no-quota.test.ts` (17 assertions) pins this structurally.
It is a code-vs-comment sweep rather than a behavioural test, because the failure
mode being guarded against is a *reintroduction*, and a reintroduction looks like
code that reads the retired column rather than like a test that fails. Two files
may name the columns and the exception is named in the test: the RPC result type
(declared `HISTORICAL`) and the generated schema types.

---

## Validation

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm test` | 133 files, 1887 tests, 0 failures |
| `supabase db reset --local` | clean, all migrations applied |
| `supabase test db --local` | 34 files, 1354 tests, 0 failures |
| `supabase db lint --local --level warning` | No schema errors found |
| `npm run build` | clean, 120 routes |
| live local flows | 288 assertions across seven flows, 0 failures |

Two test files gained assertions rather than losing them:
`employer-provisioning` now runs the org PATCH and the publish path through the
granted service client and **asserts the `.eq("id")` / `.eq("owner_user_id")`
filters** that are now the org boundary for those writes, plus a new test that a
refused caller obtains no service client at all. `live-transport` gained the
`guidanceUnavailable` distinction in both directions.

New: `tests/integration/final-rc-integration-regressions.test.ts` (8) and
`tests/integration/live-failure-handling.test.ts` (6).

## Remaining external blockers

| Variable | Blocks |
| --- | --- |
| `STRIPE_SECRET_KEY` | wallet top-up checkout, Live Single/Monthly/Personal Annual/Share Annual, employer Starter/Growth/Business, recruiter seat checkout, featured 7/14/30 — all checkout → webhook → entitlement round trips |
| `STRIPE_WEBHOOK_SECRET` | webhook signature verification and duplicate/retry behaviour |
| `OPENAI_API_KEY` | Match Score, resume tailoring, job discovery, post-interview analysis, Live guidance, the realtime answer |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Odesseus Apply end to end |
| `RESEND_API_KEY` | notification email delivery |
| Vercel Preview + non-production Supabase | resume upload against the hosted storage path — the local stack is now sound, but the hosted project has its own schema and storage-api build, so the real check belongs there |
