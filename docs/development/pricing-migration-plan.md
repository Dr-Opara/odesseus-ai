# Pricing Migration Plan — legacy contract → current pricing contract

Status: **Phase 2 done (database, additive, local stack). Gate 0 CLOSED → Path A. Phase 3 (app
billing core) is locked until Phase 2 is validated.** No production data changes; no Stripe
products created; no pricing activation.

Source of truth: `docs/product/pricing-contract.md`. This plan sequences the migration into the
codebase. Phase 0–2 are applied on the local stack; production remains untouched.

---

## Gate 0 — Legacy `application_credits` reconciliation

Rule: do not assume or infer whether production balances exist. Run a **read-only** reconciliation
first.

### Status: CLOSED → Path A (no real legacy balances)

Gate 0 was reconciled on 2026-09-24 (read-only) and the result was verified with the user:

| Check | Result |
| --- | --- |
| Production `credit_balances` rows with real value | **Zero** — no positive/negative balances exist to preserve |
| Legacy SKU rows in `pricing_products` / `pricing_prices` | Zero production rows of the 6 retired contract products |
| Decision | **Path A** — retire/deactivate the legacy credit model in place, no backfill mint, no `legacy_conversion` credit type |

Path A consequences (locked, not re-openable without new production signals):
- Legacy products/prices are **deactivated** (`active = false`), never deleted.
- `application_credits` column is retained through the transition and dropped only later, once no
  readers remain (S3, one release cycle after Path A migration).
- No `convert_legacy_application_credits` RPC and no `legacy_conversion` rows are built or run.
- Phase 3 finalization debits the wallet directly at 49¢ / 199¢.

### Reconciliation evidence (historical, 2026-09-24)

The read-only reconciliation (`BEGIN READ ONLY … ROLLBACK`) reported zero production rows with
meaningful value, and the user verified the result. That is what closed Gate 0 to **Path A**. The
query shape used was:

```sql
BEGIN READ ONLY;
SELECT
  count(*) FILTER (WHERE application_credits > 0)        AS users_with_positive,
  coalesce(sum(application_credits) FILTER (WHERE application_credits > 0), 0) AS total_positive,
  count(*) FILTER (WHERE application_credits < 0)        AS users_negative,
  coalesce(sum(application_credits) FILTER (WHERE application_credits < 0), 0) AS total_negative,
  count(*) FILTER (WHERE application_credits IS NULL)    AS users_null,
  count(*)                                                AS total_rows,
  count(*) FILTER (WHERE application_credits = 0)        AS users_zero
FROM public.credit_balances;
ROLLBACK;
```

### Decision path taken

- **Path A (selected)** — no real balances: retire/deactivate the legacy-credit model without a
  backfill mint. `application_credits` column retires after no readers remain (one release cycle).
- Path B (not taken) — preserve balances; convert at **49¢ wallet value per legacy credit**
  (1 legacy credit = 1 Standard Apply) with a zero-drift reconciliation report before conversion.

---

## Smart Apply architecture (approved)

Smart Apply is **not a separate automation stack**. It is a distinct mode/strategy **on top of the
existing assisted workflow engine** (`src/workflows/application`, `src/lib/apply` Browserbase
adapter):

- Shared: orchestration, resume tailoring + PDF artifact, durable browser session, pause/resume,
  user-takeover, pre-submission approval gate, verified-success detection, idempotent debit.
- Smart Apply adds configurable deeper automation: account creation when required, multi-page ATS
  navigation, question completion from known verified candidate data, document attachment, form
  completion, retry/recovery, application-package preparation.
- Hard invariants (unchanged from Standard): user approval required before final submission; no
  silent submission; stop/escalate when answers are uncertain; debit **$1.99 only after verified
  successful submission**.

Implementation shape: `execution_mode ∈ {standard, smart}` on `application_runs`; the workflow
reads a per-mode automation depth config; the finalization RPC debits 49¢ (standard) or 199¢
(smart) from the wallet. Standard and Smart share orchestration infrastructure.

---

## Sequenced phases

### Phase 0 — Recon & Gate 0 (done)
- Gate 0 reconciliation (**CLOSED 2026-09-24 → Path A**; user-verified zero real balances).
- Green-baseline snapshot of gates (tsc, lint, vitest, pgTAP, build) for regression comparison.

### Phase 1 — Rules & docs (done)
- `AGENTS.md` billing/security rules → current contract (**done**).
- `README.md` pricing/billing sections → current contract (**done**).
- `docs/product/pricing-contract.md` — source of truth (**done**).
- This plan (**done**). `docs/development/pricing-engine.md` — updated in Phase 2 with the final
  product matrix (**done**).

### Phase 2 — Database (DONE — local stack; additive migration below)
- Migration `20260924000000_current_pricing_contract.sql` applied to the local stack:
  - 12 new products + USD reference prices seeded; 6 legacy products/prices deactivated in place.
  - `credit_balances.wallet_balance_cents` (integer, `CHECK >= 0`), ledger
    `credit_transactions.balance_cents_after`, credit-type CHECK widening, wallet-typed
    `amount_cents = abs(delta)` CHECK.
  - Wallet branch in `odesseus_private.apply_credit_transaction()` (top-up credits, apply debits,
    insufficient-wallet rollback, audit-trail balance).
  - 7 employer/featured/seat tables with RLS + grants; org-membership SECURITY DEFINER helpers.
  - RPCs `grant_employer_tier_job_posts(uuid,text)` and `expire_ended_featured_listings()`
    (service-role-only EXECUTE). No legacy-conversion RPC (Path A).
- `supabase/tests/pricing.test.sql` rewritten to the contract (132 assertions).
- Validation passed on the local stack: `supabase test db` (177/177), `vitest` (310/310 excluding
  two OpenAI-network-dependent tests), `tsc --noEmit`, eslint, `supabase db lint` (no errors).

### Phase 3 — App billing core
- `src/lib/billing/catalog.ts` (new SKU set; split apply rates; keep `interview_*` byte-for-byte).
- `src/lib/billing/prices.ts` SKU→Stripe Price map; `createCheckoutSession` subscription support.
- Webhook: `invoice.paid`, `customer.subscription.updated/canceled`; keep existing completed path.
- Apply charge path: wallet gates 49¢/199¢, `execution_mode`, finalization + ledger.

### Phase 4 — UX
- Pricing page (desktop + mobile screen 30), Apply UI (mode selector, wallet dollars), billing page
  (top-ups + wallet ledger), employer UI (tiers, featured, seats), agents billing card, wallet-aware
  pages (`match`, `applications`, `settings`, `profile`, `interviews`, `integrations`, export).

### Phase 5 — Tests (rewritten to the new contract, same change set as code)
- `tests/unit/billing-catalog.test.ts`, `tests/integration/apply-finalization.test.ts`,
  `tests/unit/candidate-service.test.ts`, e2e `marketing-pages.spec.ts`, new wallet/smart/employer/
  featured/seat tests; **keep** Live 2499/5999/49900 assertions and duplicate-credit idempotency.

### Phase 6 — Release
- Gate sweep → dev migrate → preview deploy → **Gate 0 resolved here if still open** → prod DB
  apply → backfill (Path B) → Stripe live prices → smoke → PR merge (never main directly).

---

## Additive schema design (APPLIED in migration `20260924000000_current_pricing_contract.sql`)

Banner: this section was review material before Phase 2 and is now implemented for real on the
local stack. Where the applied migration deliberately differs from the earlier design sketch, the
difference is called out inline below. Gate 0 is **CLOSED → Path A**, so the backfill design
(S2, Section 6) is retained for reference only and will never be built unless new production
balances appear.

Design goals: strictly additive; legacy products deactivated (never deleted); wallet balances
preserved (no legacy balance to convert); server-side-only balance mutations; no RLS weakening.

### 1. `pricing_products` / `pricing_prices` (new rows in a NEW migration)

Insert (USD_US reference):

| product_key | amount_minor | family | billing_type | period | metadata |
| --- | --- | --- | --- | --- | --- |
| `candidate_standard_apply` | 49 | candidate | one_time (rate) | — | `{charge_type:"apply_rate", mode:"standard", credits_expire:false}` |
| `candidate_smart_apply` | 199 | candidate | one_time (rate) | — | `{charge_type:"apply_rate", mode:"smart", credits_expire:false}` |
| `wallet_topup_10` / `_20` / `_50` | 1000 / 2000 / 5000 | candidate | one_time | — | `{charge_type:"wallet_topup", legacy_sku:"wallet_10"…}` |
| `employer_starter` | 7900 | employer | recurring | 30d | `{charge_type:"employer_plan", jobs:3, rollover:false}` |
| `employer_growth` | 14900 | employer | recurring | 30d | `{charge_type:"employer_plan", jobs:10, rollover:false}` |
| `employer_business` | 29900 | employer | recurring | 30d | `{charge_type:"employer_plan", jobs:25, rollover:false}` |
| `featured_7d` | 2900 | employer | one_time | — | `{charge_type:"featured", days:7, ai:false}` |
| `featured_14d` | 4900 | employer | one_time | — | `{charge_type:"featured", days:14, ai:false}` |
| `featured_30d_ai` | 12900 | employer | one_time | — | `{charge_type:"featured", days:30, ai:true}` |
| `recruiter_seat_month` | 2000 | employer | recurring | 30d | `{charge_type:"recruiter_seat"}` |

Deactivate (`active = false`), **do not delete**: `candidate_application_single`,
`candidate_application_pack_25/50/100`, `employer_starter_bundle` (5-job), `employer_addon_post`
($10 add-on — removed per contract). Keep `candidate_live_single/pack_3/annual` **active and
unchanged** (values, metadata, billing period). `pricing_prices.stripe_price_id/product_id` stay
nullable; they are populated only during Phase 3 Stripe wiring — never by this migration.

### 2. Wallet (candidate) — DDL design

```sql
ALTER TABLE public.credit_balances
  ADD COLUMN wallet_balance_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.credit_balances
  ADD CONSTRAINT credit_balances_wallet_non_negative CHECK (wallet_balance_cents >= 0);
COMMENT ON COLUMN public.credit_balances.wallet_balance_cents IS
  'Monetary wallet in minor units (USD cents). Server-side mutations only.';
```
- `application_credits` is **retained** through the transition and dropped only after no readers
  remain (design S3, one release cycle later).
- Existing rows: `wallet_balance_cents` defaults to 0 for all current users (no mint — Path A).
- Index: none needed (PK is `user_id`); a partial index `(wallet_balance_cents) WHERE (wallet_balance_cents > 0)`
  only if dashboard queries need it — deferred.
- **Applied:** matches this design exactly (column + `credit_balances_wallet_non_negative` CHECK).

### 3. Ledger — DDL design

```sql
ALTER TABLE public.credit_transactions
  ADD COLUMN balance_cents_after integer;
COMMENT ON COLUMN public.credit_transactions.balance_cents_after IS
  'Wallet balance in cents after this transaction (audit trail). NULL for non-wallet rows.';
```

`credit_type` values (design):
| credit_type | delta sign | amount_cents | source |
| --- | --- | --- | --- |
| `wallet_topup` | + | 1000/2000/5000 | `billing_events` (Stripe checkout) |
| `standard_apply` | − | 49 | finalization RPC on verified success |
| `smart_apply` | − | 199 | finalization RPC on verified success |
| `legacy_conversion` | + | 49/credit | Path B backfill only — **NOT built (Path A confirmed)** |
| `application` / `interview` | unchanged | — | legacy rows remain as-is |

Wallet semantics fixed in the applied migration: `delta` is the **signed cents** change
(`standard_apply −49` → wallet −49¢), `amount_cents` is its absolute value, and the CHECK
`credit_transactions_wallet_amount_check` pins `amount_cents = abs(delta)` for wallet-typed rows.
`balance_cents_after` holds the wallet balance immediately after the transaction (`NULL` for
non-wallet rows), written by the trigger via `UPDATE credit_transactions … WHERE id = new.id`;
the trigger is INSERT-only so the UPDATE cannot re-fire.

Idempotency key patterns (design, extend `src/lib/billing/credit-references.ts`):
| operation | external_reference |
| --- | --- |
| wallet top-up | `billing:<billing_event_id>` (existing pattern via stripe_event_id uniqueness) |
| standard apply debit | `application:<run_id>` (existing) |
| smart apply debit | `smart-application:<run_id>` |
| legacy conversion mint | `legacy:<batch_id>:<user_id>` (new; batch-scoped, re-runnable) — never built (Path A) |

Add CHECK: `wallet`-typed rows must carry `amount_cents` exactly equal to `abs(delta)`; existing
`credit_transactions` rows are untouched (additive column only).

### 4. Employer / featured / recruiter (new tables, all RLS-scoped) — DDL design

```sql
create table public.employer_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
-- RLS: owner sees; members see (via employer_members); select for org, write owner-only.

create table public.employer_members (
  org_id uuid not null references public.employer_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','recruiter','viewer')), -- recruiters are org team members
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- RLS: member sees own row; org owner sees all; self-delete allowed.

create table public.employer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.employer_organizations(id),
  tier text not null check (tier in ('starter','growth','business')),
  status text not null default 'incomplete' check (status in ('incomplete','active','past_due','canceled','trialing')),
  job_posts_included int not null,
  period_start timestamptz, period_end timestamptz,
  stripe_subscription_id text unique, stripe_customer_id text,
  created_at timestamptz not null default now()
);
-- RLS: org members select; write via webhook/service only.

create table public.employer_job_post_credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.employer_organizations(id),
  total int not null check (total > 0), used int not null default 0,
  granted_at timestamptz not null default now(),
  expires_at timestamptz, -- tier cycle end for recurring grants
  check (used <= total)
);
-- plus job_post_credit_ledger(org_id, delta, reason, ref unique, created_at) for audit.

create table public.featured_listings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null, -- **bare uuid in the applied migration** (see note)
  tier text not null check (tier in ('featured_7d','featured_14d','ai_30d')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > starts_at),
  is_active boolean not null default true, -- applied migration adds this flag
  stripe_payment_intent text unique,
  created_at timestamptz not null default now()
);
-- RLS: org members of the owning org select; insert via paid purchase flow (service).
-- Expiry: scheduled job (pg_cron or edge worker) marks listings inactive.
-- **Applied delta:** `public.job_postings` does not exist yet (only candidate-side
-- `job_opportunities` / `job_preferences`). `job_id` is therefore a plain uuid with NO FK, and
-- RLS scoping is via an explicit `org_id` column (FK → employer_organizations). The job FK is
-- deferred until the employer job-postings table is built.

create table public.recruiter_seats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.employer_organizations(id),
  count int not null check (count >= 0),
  active_until timestamptz,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);
-- RLS: org members select; write via webhook/service only.
```

Every new table: RLS `ENABLE ROW LEVEL SECURITY`; policies scoped to `auth.uid()`
(owner/member checks via `employer_members`), `SELECT` for members, writes restricted to
service role paths. Run the Supabase security and performance advisors after applying (Phase 2
exit gate).

### 5. RPC changes (design-level signatures → Phase 2 slice applied)

The Phase 2 slice (applied) adds exactly two service-role-only RPCs and leaves everything else:

```sql
-- Employer renewal (applied; webhook-invoked on invoice.paid).
-- Grants a tier cycle of job-post credits, mirrors to job_post_credit_ledger, and returns total.
create or replace function public.grant_employer_tier_job_posts(
  p_org_id uuid, p_tier text
) returns table (total int);
-- REVOKE from PUBLIC/anon/authenticated; GRANT EXECUTE to postgres, service_role only.

-- Featured expiry (applied; scheduled).
create or replace function public.expire_ended_featured_listings()
returns table (expired int);
-- REVOKE from PUBLIC/anon/authenticated; GRANT EXECUTE to postgres, service_role only.
```

Deliberately NOT in Phase 2 (documented so reviewers can audit the boundary):

- Apply finalization signature change (`apply_finalize_successful_application(p_run_id, p_mode)`
  with wallet debit + `balance_after`) → **Phase 3**, done in lockstep with app code and tests.
  The existing `odesseus_finalize_successful_application(uuid,uuid,text,text)` is preserved
  byte-for-byte as the deprecated legacy path and continues to pass its tests.
- `convert_legacy_application_credits(p_batch_id)` → **never built** (Path A confirmed). No
  `legacy_conversion` credit type exists.

- Live consume RPCs: **unchanged** (`interview_passes` decrement, `live_unlimited_until` logic).
- Webhook additions (Phase 3): `invoice.paid` → grant employer credits / seat continuation;
  `customer.subscription.updated/canceled` → update `employer_subscriptions` / `recruiter_seats`.
- All RPCs run as `security definer` with explicit role checks; browser users can only invoke the
  read/self-scoped SQL functions.

### 6. Backfill design (Path B) — reference only, NOT built (Path A confirmed)

Retained for completeness and auditability. With Gate 0 closed to Path A (zero real balances), this
section is never executed unless new production balances appear. If it ever runs, every step is its
own reviewed migration/script, never combined with S0:

1. **S0 — schema** (Phase 2): additive tables/columns/products above; legacy rows untouched.
2. **S1 — Gate 0 recon** (needs production credential): read-only, reports the fields below.
3. **S2 — conversion (Path B only)**: `convert_legacy_application_credits(p_batch_id)` mints
   `49¢ × application_credits` into `wallet_balance_cents`, ledger row per user with
   `external_reference = legacy:<batch_id>:<user_id>`; runs in a transaction; re-runnable.
4. **S3 — retirement (later release)**: after zero readers, drop `application_credits`.

Zero-drift verification (design queries, run before and after S2):

```sql
-- before: snapshot sum
select sum(application_credits) as legacy_total,
       count(*) filter (where application_credits > 0) as accounts
from public.credit_balances;

-- after: minted must equal legacy_total * 49, with no double-mint
select sum(delta * coalesce(amount_cents, 0)) as minted_cents
from public.credit_transactions
where credit_type = 'legacy_conversion';

-- invariant: minted_cents == (legacy_total) * 49  AND  every converted user shows
-- exactly one legacy_conversion row (idempotency key) AND wallet_balance_cents >= 0 for all.
```

### 7. Invariants

- RLS on every exposed table; never weaken to fix permission errors.
- Wallet/ledger mutations server-side only (service role / `security definer` RPCs).
- No destructive DDL; legacy products deactivated, not deleted.
- Run Supabase security and performance advisors after schema changes (Phase 2 exit gate).
- Live products/values byte-for-byte unchanged throughout.

---

## Rollback

All schema work is additive: legacy products are deactivated (not deleted), `wallet_balance_cents`
is additive, legacy credits untouched until Path B backfill. Rollback = re-activate legacy products,
revert catalog/UI constants, cancel Stripe subscriptions. No destructive schema reverse needed for
an immediate revert.