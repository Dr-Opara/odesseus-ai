# Odesseus Pricing Contract (current source of truth)

Status: **Approved product contract — active in code and Stripe checkout/webhook fulfillment as of Phase 14B (commit b46528c). Not yet reconciled against live production data; see the legacy application-credits reconciliation note below before any production cutover.**

This file is the single source of truth for Odesseus pricing until it is superseded by an explicit
revision here. The previous contract (one "$0.99 application credit" per submission) is **legacy**
and must not be treated as authoritative (see `docs/development/pricing-migration-plan.md`).

Effective: 2026-09-24. Applies to: all marketing pages, billing catalog, Stripe products,
database price seeds, charging/fulfillment logic, and e2e/unit/db tests.

---

## Candidate

Effective with `supabase/migrations/20261123000000_spec_candidate_pricing.sql`.

| Product | Price (USD) | Charged when |
| --- | --- | --- |
| Application credit | $0.99 | 1 credit is used per **verified successful submission** |
| 25 application credits | $20 | At purchase |
| 50 application credits | $35 | At purchase |
| 100 application credits | $59 | At purchase |

- 1 application credit = 1 successfully submitted application, Apply or Smart Apply (same price).
- Failed, unsupported, cancelled, closed-role or unconfirmed applications consume 0 credits.
- Credits never expire. No required subscription.
- Balances are server-controlled (`credit_balances.application_credits`); browsers can never grant
  themselves credits.
- Legacy wallet: wallet top-ups are no longer sold. An existing `wallet_balance_cents` stays
  spendable — `odesseus_finalize_application` spends a credit first and otherwise debits $0.99 from
  the wallet.

Smart Apply bounds (product rule):

- Deeper automation than Apply, built **on the existing assisted workflow engine**: account
  creation when required, multi-page ATS navigation, question completion using known candidate
  data, document attachment, retry/recovery.
- Must preserve: user approval before final submission, no silent submission, stop/escalate when
  answers are uncertain, charge only after a verified successful submission.

## Employer

Effective with `supabase/migrations/20261124000000_spec_employer_pricing.sql`.

| Product | Price (USD) | Credits | Billing |
| --- | --- | --- | --- |
| AI Starter Bundle | $100 every 30 days | 5 base job-post credits per cycle | Recurring (30-day interval) |
| Additional job post | $10 each | 1 credit, valid 30 days from purchase | One-time, only while the bundle is active |

Two independent clocks:

- **Credit clock** (`employer_job_post_credits.expires_at`). Base credits expire at the end of
  their billing cycle and never roll over. Each add-on purchase expires 30 days after its own
  purchase timestamp and stays valid even if the bundle later lapses.
- **Job post clock** (`employer_jobs.expires_at`). Consuming a credit to publish starts a fresh
  30-day live window. The publish trigger spends the usable credit that expires soonest.

Job states: **Active** (`published`), **Paused** (hidden; the original 30-day clock keeps
running; free to reactivate inside the window; no refund), **Filled / Closed** (`closed`,
permanent, applicant data archived, no refund, cannot be reopened), **Expired** (window ended;
reposting uses a new credit). With auto-renew on, expiry consumes an available credit and
relaunches for another 30 days; with no credit available the post expires and the team is told.

Lifecycle emails (hourly `/api/cron/employer-job-lifecycle`):

1. 5 days before a cycle's unused base credits expire — `EMPLOYER_BASE_CREDITS_EXPIRING`.
2. When a post reaches its 30-day expiry — `EMPLOYER_JOB_POST_EXPIRED`.
3. 5 days before an individual add-on credit expires — `EMPLOYER_ADDON_CREDIT_EXPIRING`.

The earlier Starter $79 / Growth $149 / Business $299 plans are no longer sold. Existing
subscribers keep renewing on their tier at their original price and keep their credits.

Positioning: AI-powered hiring infrastructure ("The AI Multi-Post Bundle"), not cheap job posts.

## Promotion (featured listings)

| Listing type | Price | Duration |
| --- | --- | --- |
| Featured Job | $29 | 7 days |
| Featured Job | $49 | 14 days |
| AI Featured | $129 | 30 days |

## Recruiter

| Product | Price |
| --- | --- |
| Recruiter seat | $20/month per additional employer-team seat |

- Recruiters are **employer-organization team members**, not a separate account architecture.
- Recruiter seats and employer plans may be **recurring subscriptions** — the "no subscription"
  rule applies to **candidate core usage only**.

## Odesseus Live (authenticated applicants only)

| Product | Price (USD) |
| --- | --- |
| Live — 1 interview | $24.99 |
| Live — 3 interviews | $59.99 |
| Odesseus Live Annual | $499 (12 months, one-time, fair use) |

- Interview preparation is free.
- 1 Live pass = 1 successfully activated live interview round; a failed activation consumes nothing.
- Annual grants a 12-month window subject to fair use (20 sessions per rolling 30 days). It is a
  one-time purchase, not a subscription.
- The earlier Live subscriptions (monthly $19.99, personal annual $99, Share annual $499) are no
  longer sold. Existing subscribers keep renewing at their original price and keep access,
  including Share's guest links.
- **Odesseus Live is never advertised on a public surface.** It is private to signed-in applicants
  and token-scoped guest links. Live prices live in `src/lib/billing/catalog.ts`, which is
  auth-gated, and are deliberately absent from the public display catalogue
  `src/lib/pricing/candidate-pricing.ts`. See `tests/unit/live-public-surface.test.ts` and
  `tests/e2e/live-visibility.spec.ts`.
- **Live Share has no guest cap.** There is no guest allowance, no slot count,
  no consumption, no concurrency accounting, no activation window, and no
  automatic expiry after an interview. A Share Annual holder generates secure
  Guest Live Access links and shares them, for as long as the membership runs.

  What gates a link is the plan, not a number:

  ```ts
  canGenerateGuestLinks(row) =>
    row.has_access && row.is_owner && row.plan === "share_annual";
  ```

  plus the security of the token itself (a 256-bit secret, stored only as a
  SHA-256 hash) and the per-token rate limits on the token-scoped guest routes.
  **Those rate limits are abuse protection, not a commercial quota** — they bound
  how fast one token can be hammered, not how many guests a member may have.

  `live_memberships.guest_limit` and `guest_count` still exist as columns, and
  `guest_count` is still kept accurate, but they are historical bookkeeping. No
  authorization reads them, nothing displays them, and the trigger, the
  CHECK constraints and the service-layer result that once refused an eleventh
  guest have all been removed. See
  `supabase/migrations/20261121000000_retire_live_guest_quota.sql`.

## Cross-cutting rules

- No silent submission, ever (Standard or Smart).
- Success-only charging for candidate apply products.
- Employer plans and recruiter seats are subscription-eligible; candidate core usage is strictly
  prepaid credits, with no required subscription.
- Sensitive demographic data must never be inferred; no qualifications may be manufactured.

## Legacy application credits (policy)

- Do **not** assume or infer whether production `application_credits` balances exist.
- Perform a **read-only reconciliation** against production before any conversion.
  - If no real balances exist → retire/deactivate the legacy-credit model without migration.
  - If balances exist → preserve them, then convert at **49¢ wallet value per legacy credit**
    (preserves 1 legacy credit = 1 Standard Apply), with a zero-drift reconciliation report before
    conversion. No production data has been modified as of this revision.

## Reference inventory (locations to update during migration)

- `AGENTS.md` billing/security rules; `README.md` pricing + billing sections
- `src/lib/billing/catalog.ts`; `src/app/actions/billing.ts`; `src/app/api/webhooks/stripe/route.ts`
- `supabase/migrations/2026…_localized_pricing_engine.sql` seed (`pricing_products`/`pricing_prices`)
- `supabase/tests/pricing.test.sql`; `tests/unit/billing-catalog.test.ts`; e2e marketing specs
- `src/app/pricing/page.tsx` (desktop + mobile screen 30); `src/app/apply*`; `src/app/employers/**`;
  `src/app/agents/page.tsx`; `src/app/billing/page.tsx`
- `docs/development/pricing-engine.md`

## Change log

- 2026-09-30: Live Share's guest allowance retired. The 10-places-per-year cap
  is no longer part of the product: no allowance, no slot consumption, no
  concurrency accounting, no activation window, no post-interview expiry. Removed
  the service-layer refusal, the `BEFORE INSERT` trigger, two CHECK constraints on
  `live_memberships`, the `guest_limit` metadata key on the reference catalog, the
  `guest_limit`-gated branches in three bookkeeping functions, the API fields and
  the UI copy that displayed a remaining count, and `LIVE_SHARE_GUEST_LIMIT`. The
  historical columns are retained and still accurate; nothing reads them.
- 2026-09-29: Odesseus Live re-cut from the retired $24.99 session / $59.99
  three-pass / $499 annual bundle to Single $14.99, Monthly $19.99, Personal
  Annual $99, and Share Annual $499. The retired figures are removed rather than
  kept as a legacy tier, because no SKU in `src/lib/billing/catalog.ts` charges
  them. Live stays authenticated-only. Apply pricing is unchanged at
  Standard $0.39 / Smart $0.99.
- 2026-09-24: contract recorded (Standard $0.49, Smart $1.99, wallet $10/$20/$50,
  employer $79/$149/$299, featured $29/$49/$129, recruiter seat $20/mo; Live
  $24.99/$59.99/$499). Legacy $0.99 credit contract marked legacy.
  The $0.49/$1.99 Apply figures and the $24.99/$59.99 Live bundle in this entry
  are historical and no longer charged.