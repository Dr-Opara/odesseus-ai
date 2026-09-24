# Odesseus Pricing Contract (current source of truth)

Status: **Approved product contract — not yet activated in code, Stripe, or production data.**

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

## Odesseus Live (unchanged — remains valid)

| Product | Price |
| --- | --- |
| Live session | $24.99 per interview |
| 3 passes | $59.99 |
| Annual Live | $499 (12-month entitlement) |

- Interview preparation is free.
- A Live pass is consumed only when the live session actually starts.

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

- 2026-09-24: current contract recorded (Standard $0.49, Smart $1.99, wallet $10/$20/$50,
  employer $79/$149/$299, featured $29/$49/$129, recruiter seat $20/mo; Live $24.99/$59.99/$499
  unchanged). Legacy $0.99 credit contract marked legacy.