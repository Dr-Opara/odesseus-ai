# Odesseus Pricing Contract (current source of truth)

Status: **Approved product contract — active in code and Stripe checkout/webhook fulfillment as of Phase 14B (commit b46528c). Not yet reconciled against live production data; see the legacy application-credits reconciliation note below before any production cutover.**

This file is the single source of truth for Odesseus pricing until it is superseded by an explicit
revision here. The previous contract (one "$0.99 application credit" per submission) is **legacy**
and must not be treated as authoritative (see `docs/development/pricing-migration-plan.md`).

Effective: 2026-09-24. Applies to: all marketing pages, billing catalog, Stripe products,
database price seeds, charging/fulfillment logic, and e2e/unit/db tests.

---

## Candidate

| Product | Price | Charged when |
| --- | --- | --- |
| Standard Apply | $0.49 | Per **verified successful submission** |
| Smart Apply | $1.99 | Per **verified successful submission** |
| Wallet top-up | $10 / $20 / $50 | At purchase (funds the prepaid wallet) |

Wallet model:

- The wallet is a **server-controlled, cents-denominated balance** (`wallet_balance_cents`).
- Browser users must never be able to grant themselves funds (server-side balance mutations only).
- Standard Apply and Smart Apply draw from the wallet only after Odesseus verifies a successful
  submission. Failed, unsupported, paused, cancelled, closed, incomplete-CAPTCHA/MFA, or
  unconfirmed submissions never deduct wallet funds.
- Top-ups do not auto-convert into an integer count of applies; the wallet is monetary.

Smart Apply bounds (product rule):

- Deeper automation than Standard Apply, built **on the existing assisted workflow engine**
  (not a separate automation stack): account creation when required, multi-page ATS navigation,
  question completion using known candidate data, resume tailoring, document attachment, form
  completion, retry/recovery logic, application-package preparation.
- Must preserve: user approval before final submission, no silent submission, stop/escalate when
  answers are uncertain, charge only after a verified successful submission.

## Employer

| Plan | Price | Included job posts | Billing |
| --- | --- | --- | --- |
| Starter | $79 | 3 jobs | Recurring |
| Growth | $149 | 10 jobs | Recurring |
| Business | $299 | 25 jobs | Recurring |

The previous "$100 / 30 days / 5 jobs" starter bundle and the "$10 per add-on post" product are
**removed** from the current contract.

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

| Product | Price |
| --- | --- |
| Live Single | $14.99 per interview |
| Live Monthly | $19.99 per month |
| Live Personal Annual | $99 per year (12-month entitlement) |
| Live Share Annual | $499 per year (12-month entitlement, plus 10 guest places) |

- Interview preparation is free.
- A Live pass is consumed only when the live session actually starts, and a
  recurring plan is fulfilled as a time-boxed entitlement rather than a
  per-session credit.
- **Odesseus Live is never advertised on a public surface.** It is private to
  signed-in applicants and token-scoped guest links. Correcting these figures
  in documentation does not make Live publicly marketable; the Live SKU prices
  live in `src/lib/billing/catalog.ts`, which is auth-gated, and are
  deliberately absent from the public display catalogue
  `src/lib/pricing/candidate-pricing.ts`.
  See `tests/unit/live-public-surface.test.ts` and
  `tests/e2e/live-visibility.spec.ts`.
- The Share Annual guest allowance is 10 places per membership year, enforced
  by the database rather than by the client
  (`LIVE_SHARE_GUEST_LIMIT` in `src/lib/billing/catalog.ts`).

## Cross-cutting rules

- No silent submission, ever (Standard or Smart).
- Success-only charging for candidate apply products.
- Employer plans and recruiter seats are subscription-eligible; candidate core usage is strictly
  pay-per-use from the wallet.
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

- 2026-09-29: Odesseus Live re-cut from the retired $24.99 session / $59.99
  three-pass / $499 annual bundle to Single $14.99, Monthly $19.99, Personal
  Annual $99, and Share Annual $499 (10 guest places per year). The retired
  figures are removed rather than kept as a legacy tier, because no SKU in
  `src/lib/billing/catalog.ts` charges them. Live stays authenticated-only.
  Apply pricing is unchanged at Standard $0.39 / Smart $0.99.
- 2026-09-24: contract recorded (Standard $0.49, Smart $1.99, wallet $10/$20/$50,
  employer $79/$149/$299, featured $29/$49/$129, recruiter seat $20/mo; Live
  $24.99/$59.99/$499). Legacy $0.99 credit contract marked legacy.
  The $0.49/$1.99 Apply figures and the $24.99/$59.99 Live bundle in this entry
  are historical and no longer charged.