# Odesseus Backend — Phase 13 Production Readiness Audit

Date: 2026-09-27
Scope: final release audit, stale-contract sweep, migration/security audit, and production
preparation for the backend at commit `b46528c` (branch `backend/pricing-wallet`), complete
through Phase 14B. This document does not redo Phase 2, 4, 9A, 11A, or 14B work — it audits what
is already built and prepares it for a production cutover.

**Follow-up pass (same date):** closed the remaining real release gaps this audit had left
flagged-not-fixed — retry/recovery wiring (§2), the AI Featured pricing-key mismatch (§4), a
database-types regeneration, and the growth-table consumer classification (§7). Each is marked
below as it was closed.

No production system was touched to produce this document: no deploy, no remote Supabase
migration push, no merge to `main`. All commands ran locally against the repo working tree.

A parallel review pass ran alongside this one in the same session and landed one real fix this
document would otherwise have only flagged: every page reading `credit_balances.application_credits`
(dashboard, applications, integrations, interviews, match, profile, resume-tailoring, settings,
billing, apply/start, and the mobile Apply/Home screens) has been migrated to read
`wallet_balance_cents` instead, `AppShell`'s now-unused `applicationCredits` prop was removed, and
the mobile Apply screen's stale "$0.99" copy was corrected to the real $0.49 Standard / $1.99 Smart
pricing. This is exactly the cleanup `docs/development/pricing-migration-plan.md` called for once
Gate 0 (Path A) closed. Re-verified independently after the fact: `tsc --noEmit` clean, `eslint`
clean (1 pre-existing warning), `vitest run` 843/843 passing against the current tree.

---

## 1. Release audit — verified green (re-run, not just taken on claim)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean, 0 errors |
| `npm run lint` | 0 errors, 1 pre-existing warning (`google-signup-button.tsx` router-navigation lint rule) |
| `npm run build` | Clean production build, all 57 API routes and all pages compiled |
| `npm test` (Vitest) | **858/858 passed**, 72 files (was 843/71 before the follow-up pass; +15 net new tests for the retry wiring) |
| `npx supabase db reset --local` | Clean reset from zero, all 33 migrations apply in order with no error |
| `npx supabase db lint` | No schema errors |
| `npx supabase test db --local` | **743/743 pgTAP assertions passed**, 17 files (was 721/16 before the follow-up pass added `supabase/tests/retry-jobs.test.sql`) |

Conclusion: the app compiles, type-checks, lints, builds, and its full unit/integration/pgTAP suite
is green — independently re-run against a live local Postgres, not taken on claim.

---

## 2. Phase 11A retry/recovery layer — now wired (closed in the follow-up pass)

**Original finding:** `src/lib/retry/service.ts` provided `enqueueRetryJob`, `claimRetryJob`,
`completeRetryJob`, `withRetry`, and idempotency-key generators for every major money/side-effect
flow, backed by a correctly-RLS'd `retry_jobs` table and three `service_role`-only RPCs — but
nothing called any of it, there was no worker draining the queue, and `withRetry` itself had a
latent bug (it claimed a hardcoded `"critical_operation"` job type instead of the caller's actual
`jobType`, so calling it would always throw `"No job claimed"`).

**What changed:**

- **Fixed `withRetry`.** It now runs the operation inline and, only on failure, durably records the
  attempt (deduplicated by idempotency key) for the worker below — instead of the broken
  enqueue-then-immediately-claim design that could never succeed.
- **Built the worker**: `src/app/api/cron/process-retry-jobs/route.ts`, registered in `vercel.json`
  (`*/15 * * * *`, `CRON_SECRET`-gated like the other crons). It claims and reprocesses every
  registered job type each tick, bounded per type so one tick can't run unbounded, and reports a
  per-type succeeded/failed/dead-lettered summary.
- **Wired 5 call sites**, each re-invoking the exact same idempotent RPC/transport the original
  code path uses (never a different or unsafe operation), so a replay — whether by the worker,
  by a caller's own retry, or by both — cannot double-charge, double-debit, double-submit,
  double-grant, or double-activate:
  - `src/lib/apply/runner.ts` (`finalizeConfirmedExistingSubmission`) — covers **application
    submission/finalization**, **Smart Apply finalization**, and **wallet settlement** in one
    wiring, since all three are the same atomic `odesseus_finalize_application` RPC call,
    mode-parameterized. This is the highest-value site: it fires only when the employer has
    already confirmed the submission but *our own* accounting failed, so it's the case where a
    silent failure would leave a real external side effect unresolved internally. Vercel Workflow
    already retries the step 3x on its own; this adds a second, durable path past that limit.
  - `src/app/api/webhooks/stripe/route.ts` — **employer subscription sync**, **recruiter seat
    sync** (both the `invoice.paid` and lifecycle-event code paths), and **featured-job
    activation**. Stripe already redelivers a failed webhook for a while on its own; this is the
    independent recovery path once that window is exhausted, plus a queryable `dead_letter` state
    instead of a one-off `errored` log row.
  - `src/lib/email/send.ts` (`sendEmail`) — **email delivery**, wired once in the shared transport
    so both callers (partner emails, employer team invitations) get it for free. `not_configured`
    is treated as terminal (never enqueued) since retrying it can never succeed.
- **Deliberately not wired:** the Stripe webhook's two `try/catch`-and-log-only *best-effort*
  side effects (partner referral attribution, refund-reversal attribution) were left alone — they
  already fail without blocking the paying customer, which is correct, and wiring them was outside
  this pass's five listed critical paths. **Analytics event ingestion** has no wiring either: there
  is no ingestion endpoint yet (see §7), so there is nothing to wrap — `analyticsEventIdempotencyKey`
  is ready to use whichever call site eventually calls `log_analytics_event`.
- **New test coverage**: `tests/unit/retry-service.test.ts` (the fixed `withRetry`, claim/complete,
  and the worker's payload-validated dispatch), `tests/unit/email-send.test.ts` additions, retry-
  enqueue assertions added to the existing Stripe webhook failure-path tests, and
  `supabase/tests/retry-jobs.test.sql` (22 pgTAP assertions: enqueue idempotency, claim ordering
  and type isolation, and both the reschedule-with-attempts-remaining and dead-letter-on-exhaustion
  transitions).

Money-correctness was never at risk either before or after this change — the underlying RPCs'
own idempotency already guaranteed it. What this closes is the actual reliability/observability
gap: transient failures are now retried automatically, and failures that exhaust retries land in a
queryable `dead_letter` state instead of a one-off log line.

---

## 3. Migration and security spot-checks (independent verification)

- **Wallet tables are write-locked from the browser**: `credit_balances` and `credit_transactions`
  have `REVOKE ALL ... FROM authenticated` / `FROM anon`, `GRANT SELECT` only to `authenticated`,
  full access only to `postgres`/`service_role` (`supabase/migrations/20260918180133_baseline_v0_11.sql:1670-1815`).
  Matches the AGENTS.md rule that browser users cannot self-grant funds.
- **Finalize-application RPC is idempotent** via a unique constraint, not just app-level logic
  (`20260925000000_apply_wallet_finalization.sql:179`); a dedicated test
  (`tests/integration/apply-finalization.test.ts`) proves calling it twice for the same run is
  safe.
- **Admin wallet adjustment is fully wired end-to-end**: capability-gated at the route
  (`wallet:adjust`), re-checked at the RPC layer, idempotent via caller-supplied `reference`, and
  writes to the append-only `admin_audit_log` via `odesseus_record_admin_action`
  (`supabase/migrations/20261010000000_admin_wallet_adjustment.sql:293`). `admin_audit_log` itself
  denies all browser access and is INSERT-only through that one SECURITY DEFINER function. This is
  a good contrast case to §2 — Phase 9A's claimed integration is genuinely end-to-end; Phase 11A's
  is not yet.
- **SECURITY DEFINER functions**: 59 occurrences across migrations; a structural spot-check found
  none missing an explicit `search_path` pin near their body. Not exhaustively verified line-by-line
  in this pass.
- **RLS negative-path coverage**: 14 of 16 `supabase/tests/*.sql` files contain explicit
  cross-user/cross-org/forbidden-path assertions, not just happy-path coverage.
- **Job-post quota enforcement** is single-sourced in a database trigger (`claim_job_post_credit`),
  not duplicated in application code — no drift risk there.
- **retry_jobs RLS**: correctly locked to `service_role` only (see §2) — the gap is integration, not
  access control.

None of the above surfaced a release-blocking security defect. A deeper automated pass (every
SECURITY DEFINER function individually, full RLS policy diff, dead-letter replay
authorization-context check) was dispatched to a background review and had not returned findings
at the time this document was written; see the addendum note at the bottom of this file if one was
appended after a later pass.

---

## 4. Stale-contract sweep findings

| Finding | Severity | Status |
| --- | --- | --- |
| `docs/product/pricing-contract.md` status banner said "not yet activated in code, Stripe, or production data" despite wallet/Stripe/billing being fully shipped through Phase 14B | Doc accuracy — misleading for a production sign-off reader | **Fixed** — banner updated |
| `.env.example` missing `ODESSEUS_ADMIN_EMAILS` (bootstraps the *only* way to reach `/admin` on a fresh deploy), `RESEND_API_KEY`, `ODESSEUS_PARTNER_FROM_EMAIL` (partner emails silently no-op without both) | Ops trap on first production deploy | **Fixed** — added with inline explanation |
| `supabase/config.toml` `project_id = "Odysseus-ai"` — stale from the pre-rename project name (Kernor → Odysseus → Odesseus) | Cosmetic (local Docker namespace label only, not the cloud project ref) | **Reverted after applying** — the locally running Docker stack's containers are already named `..._Odysseus-ai` (confirmed via `docker ps`); changing `project_id` alone would desync the CLI from the running stack on the next `supabase stop`/`start` without a deliberate local-env reset. Left as-is; rename only as part of an intentional stack recreation, not a blind text edit. |
| Candidate wallet vs. legacy `application_credits`: `credit_balances.application_credits` is permanently `0` under the current wallet contract (confirmed zero rows, Gate 0/Path A), yet `src/components/mobile/mobile-apply-start.tsx` gated the **entire mobile Apply flow** on `applicationCredits >= 1` — mobile Apply could never start, on any wallet balance, for any user. The shared `AppShell` header badge and the desktop Dashboard/MobileHome balance cards also displayed `{applicationCredits} app credits`, permanently reading "0" for every user. `src/app/billing/page.tsx` already carried an in-code comment flagging the `AppShell` badge as retired and "handed off for removal." | **Release blocker** — core mobile product surface non-functional; misleading money display on every authenticated screen | **Fixed** — mobile Apply now gates on `wallet_balance_cents` (matching desktop) with corrected Standard/Smart Apply pricing copy (was a stale "$0.99"); the dead `applicationCredits` prop was removed from `AppShell` and all ~20 call sites; the Dashboard and MobileHome balance displays now show the real wallet balance in dollars instead of the always-zero legacy field. Full `tsc`/`lint`/`build`/`vitest` (843/843) re-verified green after the change. |
| `/api/cron/google-sync`, `src/lib/integrations/google-sync.ts`, `/api/integrations/google/connect/route.ts` (writes `integration_connections`) were briefly registered as a third `vercel.json` cron during this audit on the theory that a live table lacked a scheduler. Deeper trace found the opposite: `src/app/integrations/google/page.tsx` is literally named `LegacyGoogleIntegrationPage` and redirects away, the live UI's Google connect button uses `/api/integrations/oauth/connect` → `integration_accounts` (already served by the `integrations-sync` cron) instead, and `src/components/google-sync-button.tsx` (the only manual trigger for the legacy path) is defined but never rendered anywhere. | Investigation false-start, self-corrected | **Reverted** — `vercel.json` is back to its original two crons (`integrations-sync`, `job-discovery`). The legacy subsystem (`integration_connections` table, the two routes above, the unused button/page) is real dead code confirmed unreachable from any live UI — see the dead-code cleanup row below. |
| Two parallel featured-listing catalogs disagreed on the AI-tier key: `src/lib/billing/catalog.ts` (live Stripe checkout path, DB `featured_listings.tier` CHECK, `odesseus_create_featured_listing`) used `ai_30d`; `src/lib/pricing/config.ts` + `pricing_products` (the newer, not-yet-wired localized-pricing display catalog) used `featured_30d_ai` | Latent — no frontend consumed either catalog for this flow, so nothing broke *before* this fix, but the day a frontend wires `/api/pricing` into the featured-checkout tier selector it would have sent a key the checkout endpoint's `isFeaturedTier` rejects | **Fixed** — `ai_30d` is canonical (it's what the three live, money-moving pieces already agreed on). `src/lib/pricing/config.ts` updated; a new migration (`20261015000000_fix_featured_ai_tier_key.sql`) re-keys the two inert `pricing_products`/`pricing_prices` reference rows without touching the historical migration or any real `featured_listings` purchase row. `supabase/tests/pricing.test.sql` updated to match. |
| `src/app/admin/system/page.tsx` "System Readiness" tracker still lists `ODESSEUS_CONNECT_MICROSOFT_CONNECTOR` / `ODESSEUS_CONNECT_MICROSOFT_SEND_CONNECTOR` even though Microsoft integration support was removed (`20260920061755_remove_microsoft_integration_provider.sql`) | Cosmetic — the readiness dashboard would always show these two as "Missing" | **Fixed** — removed from `src/app/admin/system/page.tsx` and the matching `Provider` union/test list in `src/components/admin-system-readiness.tsx`. The route those buttons posted to (`/api/admin/system/test`) never accepted `"microsoft"` in the first place, so this was UI-only dead weight. |
| `job_reports` status rename (`'open'` → `'new'`, Phase 14B-adjacent) | — | Verified clean — no lingering `'open'` literal comparisons anywhere in `src/` |

No pricing-amount drift was found between `docs/product/pricing-contract.md`, the
`current_pricing_contract` migration seed, and `src/lib/billing/catalog.ts` (the catalog actually
used by live Stripe checkout code) — every dollar figure matches across all three.

---

## 5. Production checklist

### Environment variables (Vercel project settings, per environment)

Core:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, confirm it is never in a `NEXT_PUBLIC_*` var (verified clean in this audit)

AI:
- `OPENAI_API_KEY`, `ODESSEUS_MATCH_MODEL`, `ODESSEUS_LIVE_GUIDANCE_MODEL`, `ODESSEUS_POST_INTERVIEW_MODEL`

Billing:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — point the webhook secret at the **production**
  endpoint signing secret from the Stripe dashboard, not the CLI-forwarding secret used locally

Apply:
- `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`

Discovery / cron:
- `ODESSEUS_JOB_SOURCES_JSON`, `ODESSEUS_JOB_DISCOVERY_MAX_MATCHES_PER_USER`, `CRON_SECRET` — must
  match whatever Vercel Cron sends; confirmed both cron routes (`integrations-sync`,
  `job-discovery`) reject requests without the correct bearer token

Integrations:
- `ODESSEUS_CONNECT_GOOGLE_CONNECTOR`, `ODESSEUS_CONNECT_YAHOO_CONNECTOR`,
  `ODESSEUS_CONNECT_INDEED_CONNECTOR`, `ODESSEUS_CONNECT_GOOGLE_SEND_CONNECTOR` (optional)

Operations (previously undocumented — now in `.env.example`):
- `ODESSEUS_ADMIN_EMAILS` — **set this before first production login**, or nobody can reach `/admin`
- `RESEND_API_KEY`, `ODESSEUS_PARTNER_FROM_EMAIL` — required for partner-program outbound email

Use `/admin/system` (admin-only, already built) after deploy to confirm every tracked variable
shows "Configured." `/api/health/config` deliberately 404s in production — it's a local/preview-only
diagnostic, confirmed not to leak secret values (booleans only).

### Cron

`vercel.json` declares `integrations-sync` (every 15 min), `job-discovery` (every 6h), and —
new in the follow-up pass — `process-retry-jobs` (every 15 min, drains the retry queue described
in §2). All three verify `CRON_SECRET` server-side. No action needed beyond setting the secret.

### Stripe

- Confirm the production webhook endpoint in the Stripe dashboard points at
  `https://<production-domain>/api/webhooks/stripe` and is subscribed to the event types the
  handler branches on (`charge.refunded`, `invoice.paid`, `customer.subscription.*`, checkout
  completion, etc. — see `src/app/api/webhooks/stripe/route.ts`).
- Signature verification uses `stripe.webhooks.constructEvent` — confirmed, not a manual parse.

### Rate limiting

`src/lib/security/rate-limit.ts` is an in-memory, single-instance limiter by design (documented in
its own header comment) — it slows down abuse on one warm serverless instance but gives no
cross-instance guarantee. This is a known, already-acknowledged limitation, not a regression. If
sustained abuse becomes a real concern post-launch, back it with Upstash Redis
(`@upstash/ratelimit`); not required to ship.

### Dependencies / runtime

- `workflow: "5.0.0-beta.53"` is a **beta** dependency powering the durable Apply workflow — worth
  a deliberate go/no-go rather than an assumed-stable dependency.
- No `engines` field in `package.json` — confirm the Vercel project's configured Node version
  matches what was used for local validation.
- `.well-known/workflow/**` build artifacts are correctly gitignored and regenerate at build time
  (confirmed present after a clean `npm run build`).
- Stripe SDK pinned to API version `2026-08-26.dahlia` in `src/lib/stripe.ts` — confirm this
  matches the Stripe dashboard's configured API version for the production account.

### Explicitly out of scope for this launch

- Automated partner payouts — post-launch enhancement, not implemented, not required for launch.
- Building consumers for the Phase 14B growth tables (careers page, analytics dashboard, First 100
  signup flow) — see §7; schema and RPCs are ready, but building three new frontend surfaces is
  feature work, not a release-gap closure.

---

## 6. Rollback plan

### Application (Vercel)

Standard instant rollback: promote the previous production deployment from the Vercel dashboard or
`vercel rollback`. No code-level rollback risk beyond the usual — this backend has no in-place
stateful migrations that a code-only rollback would desync, **except** where a new migration
changed a shape old code doesn't expect (see below).

### Database (Supabase migrations)

Supabase CLI migrations here are forward-only — there is no down-migration convention in this
repo. Rollback strategy is therefore "roll the app back, leave the schema forward" wherever
possible, which works because the most recent migration set is overwhelmingly additive:

- `20261012000000_phase11a_performance_indexes.sql` — new indexes + new `retry_jobs` table/RPCs
  only. Safe to leave in place under an old app version; nothing old code reads or writes.
- `20261013000000_phase14b_growth_backend.sql`, `20261014000000_phase14b_metrics_functions.sql` —
  additive (new tables/functions for careers/partners/referrals/analytics). Safe to leave in place.
- `20261009000000_admin_capabilities_and_audit.sql` — additive (`admin_audit_log`,
  `odesseus_record_admin_action`), plus one `DROP FUNCTION IF EXISTS` immediately followed by
  recreation of `odesseus_update_job_report_status` with a wider signature. If rolling back to
  code that called the *old* signature, that function would need to be restored — check this
  specifically before rolling back past this migration.
- `20261010000000_admin_wallet_adjustment.sql` — swaps CHECK constraints
  (`credit_transactions_credit_type_check`, `credit_ledger_credit_type_check`,
  `credit_transactions_wallet_amount_check`) to widen allowed values. Widening is safe to leave in
  place under old app code (old code just won't use the new values); this is not reversible in the
  other direction without re-adding the narrower constraint if you roll the app back *and* need to
  re-narrow data integrity.

General rule for any future rollback decision: additive migrations (new tables, new indexes, new
functions, widened constraints) are safe to leave forward when rolling the app back. A migration
that renames or drops a column/constraint the old app code depends on is not — none of the last 10
migrations do this except the job-report status rename
(`20261007000000_job_report_status_new.sql`), which is itself additive-compatible (`'new'` is a
superset scenario, old code reading `'open'` would simply see zero rows post-migration, not error).

### Billing safety during any rollback

Because the finalize-application RPC and admin wallet-adjustment RPC are idempotent at the
database layer (unique constraints, not app-level dedup), a rollback-and-reprocess scenario cannot
double-charge a wallet or double-grant a wallet adjustment, regardless of which app version is
running.

### Legacy credit reconciliation

Not a rollback concern: Gate 0 of the pricing migration was already closed to **Path A** (zero real
production `application_credits` balances existed as of 2026-09-24, verified read-only) — see
`docs/development/pricing-migration-plan.md`. No legacy-credit conversion is pending.

---

## 7. Phase 14B growth-table classification (follow-up pass)

Six schema objects from `20261013000000_phase14b_growth_backend.sql` and
`20261014000000_phase14b_metrics_functions.sql` have zero consumers anywhere in `src/` today.
Each was reviewed individually rather than treated as one bucket:

| Object | RLS / design | Classification |
| --- | --- | --- |
| `career_job_openings`, `career_applications` | Public read of `published` openings, admin write, public application insert | **Required but missing consumer** — schema-ready for an "Odesseus is hiring" careers page and an admin management surface. Not the candidate-facing job-discovery feature (that's `job_opportunities`, already live) — this is Odesseus's own company careers listing. |
| `analytics_events` | `anon`/`authenticated` INSERT-only, admin-only SELECT | **Required but missing consumer** — correctly designed for direct client-side inserts (no server route needed once a frontend calls it), backed by a ready-to-call `log_analytics_event()` RPC that also has zero callers yet. |
| `first100_campaign`, `first100_enrollments` | Public read of active campaigns, self-service enrollment insert/read, admin override | **Required but missing consumer** — schema-ready for a signup-flow promotion, backed by a ready-to-call `enroll_first100()` RPC with zero callers yet. |
| `get_candidate_metrics`, `get_employer_metrics`, `get_growth_metrics` | `service_role`-only RPCs (two of the three were redefined once, in the later metrics-functions migration — the live schema reflects that final definition) | **Required but missing consumer** — schema-ready for an admin analytics dashboard. |

None of these are unused/dead code to remove — every one is RLS-correct, coherent with its sibling
tables, and (for four of the six) already has a purpose-built RPC waiting for a caller. Per the
instruction not to remove anything an upcoming frontend/admin UI needs, **nothing here was
deleted, and nothing was built** — building three new frontend surfaces (careers page, analytics
dashboard, First 100 signup flow) is feature work, not a release-gap closure. `src/types/database.ts`
(see §8) now at least gives whoever builds those surfaces accurate generated types to build against.

## 8. Database types — regenerated (follow-up pass)

`src/types/database.ts` was regenerated from the local schema (`supabase gen types typescript
--local`) and now represents every current table, RPC, and enum, including everything from Phase
11A (`retry_jobs`) and Phase 14B (`career_job_openings`, `career_applications`, `analytics_events`,
`first100_campaign`, `first100_enrollments`, `log_analytics_event`, `enroll_first100`,
`get_candidate_metrics`, `get_employer_metrics`, `get_growth_metrics`) that the previous generation
predated.

The regeneration surfaced one real, previously-latent gap in the *old* file: for an RPC parameter
with no SQL `DEFAULT`, Supabase's codegen types it as a bare required `string` even when the
underlying column is genuinely nullable and Postgres accepts an explicit `NULL` for it fine — only
a parameter with `DEFAULT NULL` gets `| undefined`. The stricter, more accurate regenerated types
caught several existing call sites quietly relying on the old, looser inference
(`src/lib/admin/audit.ts`, `src/lib/admin/wallet.ts`, `src/lib/apply/runner.ts`,
`src/lib/employer/seat-sync.ts`, `src/lib/reports/service.ts`). Each was fixed with a narrow,
value-preserving type assertion at the call site (documented inline) rather than changed behavior —
four pre-existing tests pin the exact `null` (not `undefined`) value sent to those RPCs, and all
four still pass unchanged.
