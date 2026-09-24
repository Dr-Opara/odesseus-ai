# Pricing Migration Plan — legacy contract → current pricing contract

Status: **Phase 0/1. Design + contract docs only. No migrations, no production data changes,
no Stripe products, no pricing activation.**

Source of truth: `docs/product/pricing-contract.md`. This plan sequences the migration into the
codebase. Nothing here has been applied.

---

## Gate 0 — Legacy `application_credits` reconciliation

Rule: do not assume or infer whether production balances exist. Run a **read-only** reconciliation
first.

### Status: BLOCKED — no production credential available on this machine

Evidence gathered (read-only):

| Check | Result |
| --- | --- |
| Hosted Supabase project | Linked: ref `ievsjfudakeugfalihzq`, name `odysseus-ai`, `aws-0-us-west-2.pooler.supabase.com` (`supabase/.temp/linked-project.json`) |
| Production URL in code | `https://ievsjfudakeugfalihzq.supabase.co` (hardcoded fallback in `next.config.ts` and `src/lib/supabase/public-config.ts`) |
| DB password | **Absent** — `supabase/.temp/pooler-url` is credential-less |
| Supabase CLI login | Absent — `~/.supabase/access-token` does not exist |
| Vercel CLI | Authenticated as `dr-opara`, but production env pull redacts all secret values (`[SENSITIVE]`) |
| Anon/publishable key in repo | Public-only (cannot read RLS-scoped `credit_balances`) |
| Local `.env.local` | Points to local dev stack `127.0.0.1:54321` — dev data, not production |

No production-capable credential exists on this machine, so the reconciliation query cannot run
yet. **No numbers are reported and none will be inferred.**

### Ready-to-run reconciliation (read-only)

The script exists at:
`C:\Users\chima\AppData\Local\Temp\opencode\pricing-recon\recon.cjs` — runs inside
`BEGIN READ ONLY … ROLLBACK`, prints the report below. Equivalently, the SQL to run in the
production SQL editor:

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

**Required report fields:** users with non-zero balances · total credits outstanding · affected
accounts · projected wallet cents at 49¢/credit (`total_positive * 49`) · anomalies (negative/null).

### Unblock options (any one)

1. Provide the hosted project's DB password (or a read-only pooler URL) → I run `recon.cjs`.
2. Run `supabase login` (interactive device flow) on this machine + provide DB password when
   `supabase link --project-ref ievsjfudakeugfalihzq` prompts.
3. Run the SQL above yourself in Supabase Studio / `psql` and paste the result.
4. Attestation that no production balances exist (only if you can truthfully state this).

### Decision paths (after Gate 0 numbers)

- **Path A — no real balances:** retire/deactivate the legacy-credit model without a backfill mint.
  `application_credits` column retires after no readers remain (one release cycle).
- **Path B — balances exist:** preserve balances; convert at **49¢ wallet value per legacy credit**
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

### Phase 0 — Recon & Gate 0 (this phase)
- Gate 0 reconciliation (above). **Blocked pending credentials.**
- Green-baseline snapshot of gates (tsc, lint, vitest, pgTAP, build) for regression comparison.

### Phase 1 — Rules & docs (approved, done in this pass)
- `AGENTS.md` billing/security rules → current contract (**done**).
- `README.md` pricing/billing sections → current contract (**done**).
- `docs/product/pricing-contract.md` — source of truth (**done**).
- This plan (**done**). `docs/development/pricing-engine.md` — update in Phase 2 with the final
  product matrix (after schema design is reviewed).

### Phase 2 — Database (new additive migration; local stack only; design below)
- New migration: new products/prices, deactivate (do not delete) legacy products, wallet columns,
  ledger additions, employer/featured/seat tables, RPC changes.
- Rewrite `supabase/tests/pricing.test.sql`; run `supabase test db` + security/performance advisors.

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

## Additive schema design (DESIGN ONLY — NOT APPLIED, NOT EXECUTABLE)

Banner: this section is review material. Do not run any of it until Phase 2 is approved.

### 1. `pricing_products` / `pricing_prices` (update seed in a NEW migration)

Insert (USD_US reference):

| product_key | amount_minor | billing_type | metadata |
| --- | --- | --- | --- |
| `candidate_standard_apply` | 49 | one_time (rate) | `{charge_type:"apply_rate", mode:"standard"}` |
| `candidate_smart_apply` | 199 | one_time (rate) | `{charge_type:"apply_rate", mode:"smart"}` |
| `wallet_topup_10` / `wallet_topup_20` / `wallet_topup_50` | 1000 / 2000 / 5000 | one_time | `{credit_type:"wallet_topup"}` |
| `employer_starter` | 7900 | recurring · 30d | `{jobs:3}` |
| `employer_growth` | 14900 | recurring · 30d | `{jobs:10}` |
| `employer_business` | 29900 | recurring · 30d | `{jobs:25}` |
| `featured_7d` | 2900 | one_time | `{featured_days:7, ai:false}` |
| `featured_14d` | 4900 | one_time | `{featured_days:14, ai:false}` |
| `featured_30d_ai` | 12900 | one_time | `{featured_days:30, ai:true}` |
| `recruiter_seat_month` | 2000 | recurring · 30d | `{seat:true}` |

Deactivate (`active = false`), do not delete: `candidate_application_single`, `candidate_application_pack_25/50/100`,
`employer_starter_bundle` (5-job), `employer_addon_post` ($10 add-on — removed per contract).
Keep `candidate_live_single/pack_3/annual` active and unchanged.

### 2. Wallet (candidate)

```sql
ALTER TABLE public.credit_balances
  ADD COLUMN wallet_balance_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.credit_balances
  ADD CONSTRAINT credit_balances_wallet_non_negative CHECK (wallet_balance_cents >= 0);
```
`application_credits` retained through the transition; dropped only after no readers remain and
Path A/B backfill is complete.

### 3. Ledger

```sql
ALTER TABLE public.credit_transactions
  ADD COLUMN balance_cents_after integer;
```
New `credit_type` values: `wallet_topup` (+), `standard_apply` (−49), `smart_apply` (−199),
`legacy_conversion` (+49/credit, Path B only). `external_reference` unique constraint unchanged
(idempotency preserved via `credit-references.ts` key patterns).

### 4. Employer / featured / recruiter (new tables, all RLS-scoped)

- `employer_organizations(id, name, created_at)` — RLS: owner + members.
- `employer_members(org_id, user_id, role)` — **recruiters are org team members**; RLS by org.
- `employer_subscriptions(org_id, tier, status, period_start/end, stripe_subscription_id)`.
- `employer_job_post_credits(org_id, total, used, granted_at, expires_at)` + ledger.
- `featured_listings(job_id, tier, starts_at, expires_at, stripe_*_id)`.
- `recruiter_seats(org_id, count, active_until, stripe_subscription_id)`.

### 5. RPC changes (design)

- Apply finalization RPC (migration `20260918190158`; verify final name through the rename
  migrations before editing): accept `execution_mode`; debit `wallet_balance_cents` by 49 or 199;
  keep atomic wallet+ledger update, keep external_reference idempotency.
- Live consume RPCs: unchanged (`interview_passes` still decremented, `live_unlimited_until` logic
  untouched).
- New (later): employer renewal grant via `invoice.paid`, featured-expiry enforcement.

### 6. Invariants

- RLS on every exposed table; never weaken to fix permission errors.
- Wallet/ledger mutations server-side only (service role / RPC).
- Run Supabase security and performance advisors after schema changes (Phase 2 exit gate).

---

## Rollback

All schema work is additive: legacy products are deactivated (not deleted), `wallet_balance_cents`
is additive, legacy credits untouched until Path B backfill. Rollback = re-activate legacy products,
revert catalog/UI constants, cancel Stripe subscriptions. No destructive schema reverse needed for
an immediate revert.