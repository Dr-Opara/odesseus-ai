-- Current pricing contract (Phase 2, Path A). Additive migration; local stack only.
--
-- Gate 0 is CLOSED: production credit_balances held zero rows of real value
-- (reconciled read-only, 2026-09-24), so this is Path A — the legacy credit
-- model is retired in place (deactivated, never deleted) and NO legacy balance
-- backfill/conversion is built or run.
--
-- Scope (design doc §1–§5, “Additive schema design” in pricing-migration-plan.md):
--   1. pricing_products / pricing_prices
--        * insert 12 new contract products and their USD_US reference prices
--        * deactivate (active = false, DO NOT delete) 6 legacy products/prices
--        * candidate_live_* rows are left byte-for-byte unchanged and active
--   2. Wallet (candidate)
--        * credit_balances.wallet_balance_cents (integer, NOT NULL DEFAULT 0,
--          CHECK >= 0). Server-side mutations only; clients keep read-only
--          access through the existing credit_balances_select_own policy.
--   3. Ledger additions
--        * credit_transactions.balance_cents_after (audit trail; NULL except
--          wallet rows, where the trigger records the post-transaction balance)
--        * credit_type CHECKs widened on credit_transactions, credit_ledger and
--          billing_events to admit wallet credit types
--        * wallet-typed rows must carry amount_cents = abs(delta)
--        * odesseus_private.apply_credit_transaction() gains a wallet branch
--   4. Employer / featured / recruiter tables (all RLS-scoped)
--        * employer_organizations, employer_members, employer_subscriptions,
--          employer_job_post_credits, job_post_credit_ledger, featured_listings,
--          recruiter_seats
--        * NOTE: public.job_postings does not exist yet (only job_opportunities
--          / job_preferences are candidate-side). featured_listings.job_id is a
--          plain uuid with the FK deferred until the employer job-postings
--          table is built; RLS scoping is via an explicit org_id column.
--   5. RPC changes (Phase 2 slice)
--        * trigger wallet branch (this migration)
--        * grant_employer_tier_job_posts(p_org_id, p_tier) — webhook-invoked
--        * expire_ended_featured_listings() — scheduled job
--        * convert_legacy_application_credits is NOT built (Path A)
--        * the apply-finalization signature change (mode → wallet debit) is a
--          Phase 3 change done in lockstep with app code + tests; the existing
--          odesseus_finalize_successful_application(uuid,uuid,text,text) is
--          preserved byte-for-byte as the deprecated legacy path.
--
-- Invariants preserved: no DROP/DELETE/TRUNCATE of pricing or credit data; no
-- RLS weakening; wallet/ledger mutations server-side only; live products
-- unchanged.

-- ---------------------------------------------------------------------------
-- 1. Pricing catalog: new products + reference prices, legacy deactivation
-- ---------------------------------------------------------------------------

INSERT INTO public.pricing_products
  (product_key, family, display_name, billing_type, billing_period_days, metadata)
VALUES
  -- Apply rates (wallet debits on verified successful submission).
  ('candidate_standard_apply', 'candidate', 'Standard Apply',                'one_time',  NULL,
   '{"charge_type":"apply_rate","mode":"standard","credits_expire":false}'),
  ('candidate_smart_apply',    'candidate', 'Smart Apply',                   'one_time',  NULL,
   '{"charge_type":"apply_rate","mode":"smart","credits_expire":false}'),
  -- Wallet top-ups (prepaid; the only candidate purchase path for applies).
  ('wallet_topup_10',          'candidate', 'Wallet top-up — $10',           'one_time',  NULL,
   '{"charge_type":"wallet_topup","credit_type":"wallet_topup","legacy_sku":"wallet_10"}'),
  ('wallet_topup_20',          'candidate', 'Wallet top-up — $20',           'one_time',  NULL,
   '{"charge_type":"wallet_topup","credit_type":"wallet_topup","legacy_sku":"wallet_20"}'),
  ('wallet_topup_50',          'candidate', 'Wallet top-up — $50',           'one_time',  NULL,
   '{"charge_type":"wallet_topup","credit_type":"wallet_topup","legacy_sku":"wallet_50"}'),
  -- Employer plans (recurring every 30 days; job-post credits, no rollover).
  ('employer_starter',         'employer',  'Employer Starter',              'recurring', 30,
   '{"charge_type":"employer_plan","credit_type":"job_post","jobs":3,"rollover":false,"billing_period_days":30}'),
  ('employer_growth',          'employer',  'Employer Growth',               'recurring', 30,
   '{"charge_type":"employer_plan","credit_type":"job_post","jobs":10,"rollover":false,"billing_period_days":30}'),
  ('employer_business',        'employer',  'Employer Business',             'recurring', 30,
   '{"charge_type":"employer_plan","credit_type":"job_post","jobs":25,"rollover":false,"billing_period_days":30}'),
  -- Featured listings (one-time purchases).
  ('featured_7d',              'employer',  'Featured listing — 7 days',     'one_time',  NULL,
   '{"charge_type":"featured","credit_type":"featured","featured_days":7,"ai":false}'),
  ('featured_14d',             'employer',  'Featured listing — 14 days',    'one_time',  NULL,
   '{"charge_type":"featured","credit_type":"featured","featured_days":14,"ai":false}'),
  ('featured_30d_ai',          'employer',  'AI Featured listing — 30 days', 'one_time',  NULL,
   '{"charge_type":"featured","credit_type":"featured","featured_days":30,"ai":true}'),
  -- Recruiter seat (recurring per team member per month).
  ('recruiter_seat_month',     'employer',  'Recruiter seat — monthly',      'recurring', 30,
   '{"charge_type":"recruiter_seat","credit_type":"recruiter_seat","billing_period_days":30}')
ON CONFLICT (product_key) DO NOTHING;

-- Approved USD reference prices for the new products (integer minor units).
INSERT INTO public.pricing_prices
  (product_key, market_key, currency, amount_minor, stripe_price_id, stripe_product_id, metadata)
VALUES
  ('candidate_standard_apply', 'USD_US', 'USD',    49, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_smart_apply',    'USD_US', 'USD',   199, NULL, NULL, '{"kind":"reference"}'),
  ('wallet_topup_10',          'USD_US', 'USD',  1000, NULL, NULL, '{"kind":"reference"}'),
  ('wallet_topup_20',          'USD_US', 'USD',  2000, NULL, NULL, '{"kind":"reference"}'),
  ('wallet_topup_50',          'USD_US', 'USD',  5000, NULL, NULL, '{"kind":"reference"}'),
  ('employer_starter',         'USD_US', 'USD',  7900, NULL, NULL, '{"kind":"reference"}'),
  ('employer_growth',          'USD_US', 'USD', 14900, NULL, NULL, '{"kind":"reference"}'),
  ('employer_business',        'USD_US', 'USD', 29900, NULL, NULL, '{"kind":"reference"}'),
  ('featured_7d',              'USD_US', 'USD',  2900, NULL, NULL, '{"kind":"reference"}'),
  ('featured_14d',             'USD_US', 'USD',  4900, NULL, NULL, '{"kind":"reference"}'),
  ('featured_30d_ai',          'USD_US', 'USD', 12900, NULL, NULL, '{"kind":"reference"}'),
  ('recruiter_seat_month',     'USD_US', 'USD',  2000, NULL, NULL, '{"kind":"reference"}')
ON CONFLICT (product_key, market_key) DO NOTHING;

-- Deactivate (do not delete) the retired legacy products and their prices.
-- candidate_live_single / candidate_live_pack_3 / candidate_live_annual are
-- deliberately NOT touched: active and byte-for-byte unchanged.
UPDATE public.pricing_products
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_application_single',
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'employer_starter_bundle',
  'employer_addon_post'
);
UPDATE public.pricing_prices
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_application_single',
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'employer_starter_bundle',
  'employer_addon_post'
);

-- ---------------------------------------------------------------------------
-- 2. Wallet (candidate) — additive column on credit_balances
-- ---------------------------------------------------------------------------

ALTER TABLE public.credit_balances
  ADD COLUMN wallet_balance_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.credit_balances
  ADD CONSTRAINT credit_balances_wallet_non_negative CHECK (wallet_balance_cents >= 0);

COMMENT ON COLUMN public.credit_balances.wallet_balance_cents IS
  'Monetary wallet in minor units (USD cents). Server-side mutations only.';

-- ---------------------------------------------------------------------------
-- 3. Ledger additions
-- ---------------------------------------------------------------------------

-- Audit column: post-transaction wallet balance. NULL for non-wallet rows.
ALTER TABLE public.credit_transactions
  ADD COLUMN balance_cents_after integer;

COMMENT ON COLUMN public.credit_transactions.balance_cents_after IS
  'Wallet balance in cents after this transaction (audit trail). NULL for non-wallet rows.';

-- Widen credit_type CHECKs to admit the wallet credit types.
-- (Path A: legacy_conversion is intentionally NOT included — no backfill.)
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT credit_transactions_credit_type_check;
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_credit_type_check
  CHECK (credit_type = ANY (ARRAY['application'::text, 'interview'::text,
    'wallet_topup'::text, 'standard_apply'::text, 'smart_apply'::text]));

ALTER TABLE odesseus_private.credit_ledger
  DROP CONSTRAINT credit_ledger_credit_type_check;
ALTER TABLE odesseus_private.credit_ledger
  ADD CONSTRAINT credit_ledger_credit_type_check
  CHECK (credit_type = ANY (ARRAY['application'::text, 'interview'::text,
    'wallet_topup'::text, 'standard_apply'::text, 'smart_apply'::text]));

-- billing_events records purchases; wallet top-ups are the only new purchase
-- kind that flows through it in this phase (apply debits are posted directly
-- by the finalization RPC, not through checkout events).
ALTER TABLE public.billing_events
  DROP CONSTRAINT billing_events_credit_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_credit_type_check
  CHECK (credit_type = ANY (ARRAY['application'::text, 'interview'::text, 'wallet_topup'::text]));

-- Wallet-typed ledger rows must carry a concrete money amount equal to the
-- signed delta magnitude: wallet_topup +1000 → amount_cents 1000;
-- standard_apply −49 → 49; smart_apply −199 → 199. Existing legacy rows
-- ('application' / 'interview') are untouched and exempt.
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_wallet_amount_check
  CHECK (credit_type NOT IN ('wallet_topup'::text, 'standard_apply'::text, 'smart_apply'::text)
         OR (amount_cents IS NOT NULL AND amount_cents = abs(delta)));

-- Wallet branch in the shared credit-application trigger. This trigger is the
-- single server-side choke point for every balance mutation: wallet top-ups
-- credit wallet_balance_cents, apply debits decrement it, and the resulting
-- balance is recorded on the ledger row. Insufficient wallet raises and rolls
-- back the surrounding transaction (e.g. finalization never half-applies).
CREATE OR REPLACE FUNCTION odesseus_private.apply_credit_transaction()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  current_app integer;
  current_interview integer;
  current_wallet integer;
  v_wallet_change integer;
  v_wallet_after integer;
begin
  insert into public.credit_balances (user_id, application_credits, interview_passes, updated_at)
  values (new.user_id, 0, 0, now())
  on conflict (user_id) do nothing;

  select application_credits, interview_passes, wallet_balance_cents
  into current_app, current_interview, current_wallet
  from public.credit_balances
  where user_id = new.user_id
  for update;

  if new.credit_type = 'application' then
    if current_app + new.delta < 0 then
      raise exception 'insufficient application credits';
    end if;

    update public.credit_balances
    set application_credits = application_credits + new.delta,
        updated_at = now()
    where user_id = new.user_id;
  elsif new.credit_type in ('wallet_topup', 'standard_apply', 'smart_apply') then
    -- delta is the signed cents change (wallet_topup +1000, apply −49/−199);
    -- the CHECK credit_transactions_wallet_amount_check pins amount_cents to
    -- abs(delta), so the balance moves exactly by delta.
    v_wallet_change := new.delta;

    if current_wallet + v_wallet_change < 0 then
      raise exception 'insufficient wallet balance';
    end if;

    v_wallet_after := current_wallet + v_wallet_change;

    update public.credit_balances
    set wallet_balance_cents = v_wallet_after,
        updated_at = now()
    where user_id = new.user_id;

    -- Record the audit-trail balance on the just-inserted ledger row. This
    -- UPDATE cannot re-fire the trigger (it is INSERT-only on this table).
    update public.credit_transactions
    set balance_cents_after = v_wallet_after
    where id = new.id;
  else
    if current_interview + new.delta < 0 then
      raise exception 'insufficient interview passes';
    end if;

    update public.credit_balances
    set interview_passes = interview_passes + new.delta,
        updated_at = now()
    where user_id = new.user_id;
  end if;

  insert into odesseus_private.credit_ledger
    (user_id, credit_type, delta, reason, external_reference)
  values
    (new.user_id, new.credit_type, new.delta, new.reason, new.external_reference);

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Employer / featured / recruiter tables (all RLS-scoped)
-- ---------------------------------------------------------------------------

-- NOTE: membership helper functions (is_org_member / is_org_owner /
-- is_org_admin_or_owner) are defined AFTER the employer tables below, because
-- a LANGUAGE sql function body is validated at CREATE time and the tables must
-- already exist.

CREATE TABLE public.employer_organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_organizations IS
  'Employer account. owner_user_id is the billing owner; team members join via employer_members.';
COMMENT ON COLUMN public.employer_organizations.owner_user_id IS
  'Auth user who owns the employer account and its billing.';

CREATE TABLE public.employer_members (
  org_id     uuid NOT NULL REFERENCES public.employer_organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id),
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'recruiter', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

COMMENT ON TABLE public.employer_members IS
  'Employer team membership. recruiters are org team members, not seats.';

CREATE TABLE public.employer_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.employer_organizations(id),
  tier                 text NOT NULL CHECK (tier IN ('starter', 'growth', 'business')),
  status               text NOT NULL DEFAULT 'incomplete'
                       CHECK (status IN ('incomplete', 'active', 'past_due', 'canceled', 'trialing')),
  job_posts_included   integer NOT NULL CHECK (job_posts_included > 0),
  period_start         timestamptz,
  period_end           timestamptz,
  stripe_subscription_id text UNIQUE,
  stripe_customer_id   text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_subscriptions IS
  'Current employer plan subscription. Written by the billing webhook (service role); org members read-only.';

CREATE TABLE public.employer_job_post_credits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.employer_organizations(id),
  total      integer NOT NULL CHECK (total > 0),
  used       integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK (used <= total)
);

COMMENT ON TABLE public.employer_job_post_credits IS
  'Job-post credit grants (tier cycles). used counts posts consumed; expires_at is the tier cycle end for recurring grants.';

CREATE TABLE public.job_post_credit_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.employer_organizations(id),
  delta              integer NOT NULL CHECK (delta <> 0),
  reason             text NOT NULL CHECK (length(trim(reason)) > 0),
  external_reference text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_post_credit_ledger IS
  'Immutable audit trail for employer job-post credits. unique ref makes webhook grants idempotent.';

CREATE TABLE public.featured_listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.employer_organizations(id),
  -- Employer job postings table does not exist yet (only candidate-side
  -- job_opportunities / job_preferences). FK deferred until that table is
  -- built; RLS scoping uses org_id.
  job_id               uuid NOT NULL,
  tier                 text NOT NULL CHECK (tier IN ('featured_7d', 'featured_14d', 'ai_30d')),
  starts_at            timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL CHECK (expires_at > starts_at),
  is_active            boolean NOT NULL DEFAULT true,
  stripe_payment_intent text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.featured_listings IS
  'Paid featured listings. is_active is flipped false by expire_ended_featured_listings(); insert flow is service-role only.';

CREATE TABLE public.recruiter_seats (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.employer_organizations(id),
  count                 integer NOT NULL CHECK (count >= 0),
  active_until          timestamptz,
  stripe_subscription_id text UNIQUE,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recruiter_seats IS
  'Paid recruiter seats per org. Written by the billing webhook (service role); org members read-only.';

CREATE INDEX employer_members_org_idx ON public.employer_members (org_id);
CREATE INDEX employer_members_user_idx ON public.employer_members (user_id);
CREATE INDEX employer_subscriptions_org_idx ON public.employer_subscriptions (org_id);
CREATE INDEX employer_job_post_credits_org_idx ON public.employer_job_post_credits (org_id);
CREATE INDEX job_post_credit_ledger_org_idx ON public.job_post_credit_ledger (org_id);
CREATE INDEX featured_listings_org_idx ON public.featured_listings (org_id);
CREATE INDEX featured_listings_expiry_idx ON public.featured_listings (expires_at) WHERE is_active;
CREATE INDEX recruiter_seats_org_idx ON public.recruiter_seats (org_id);

-- ---------------------------------------------------------------------------
-- Membership helpers used by RLS policies. SECURITY DEFINER so policy
-- evaluation never recurses into the member table's own RLS; they only ever
-- answer boolean membership questions for the current auth.uid(). Defined
-- here (after the tables) because sql-function bodies are validated at
-- CREATE time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION odesseus_private.is_org_member(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.employer_members
    where org_id = p_org_id and user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION odesseus_private.is_org_owner(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.employer_organizations
    where id = p_org_id and owner_user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION odesseus_private.is_org_admin_or_owner(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.employer_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) or exists (
    select 1 from public.employer_organizations
    where id = p_org_id and owner_user_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION odesseus_private.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.is_org_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION odesseus_private.is_org_admin_or_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odesseus_private.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION odesseus_private.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION odesseus_private.is_org_admin_or_owner(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS on the new employer tables.
-- Clients: read what their org (owner or member) owns; write only along the
-- documented owner/member flows. Purchases/webhook writes run as service_role
-- (BYPASSRLS), which is why no client INSERT/UPDATE/DELETE policy exists for
-- subscriptions, credits, ledger, featured listings, or seats.
-- ---------------------------------------------------------------------------

ALTER TABLE public.employer_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_job_post_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_post_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employer_organizations_select_member" ON public.employer_organizations
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR odesseus_private.is_org_member(id));

CREATE POLICY "employer_organizations_insert_owner" ON public.employer_organizations
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "employer_organizations_update_owner" ON public.employer_organizations
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "employer_organizations_delete_owner" ON public.employer_organizations
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "employer_members_select_member" ON public.employer_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR odesseus_private.is_org_admin_or_owner(org_id)
         OR odesseus_private.is_org_member(org_id));

CREATE POLICY "employer_members_insert_owner_admin" ON public.employer_members
  FOR INSERT TO authenticated
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_members_update_owner_admin" ON public.employer_members
  FOR UPDATE TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id))
  WITH CHECK (odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_members_delete_self_or_owner" ON public.employer_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR odesseus_private.is_org_admin_or_owner(org_id));

CREATE POLICY "employer_subscriptions_select_member" ON public.employer_subscriptions
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id) OR odesseus_private.is_org_member(org_id));

CREATE POLICY "employer_job_post_credits_select_member" ON public.employer_job_post_credits
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id) OR odesseus_private.is_org_member(org_id));

CREATE POLICY "job_post_credit_ledger_select_member" ON public.job_post_credit_ledger
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id) OR odesseus_private.is_org_member(org_id));

CREATE POLICY "featured_listings_select_member" ON public.featured_listings
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id) OR odesseus_private.is_org_member(org_id));

CREATE POLICY "recruiter_seats_select_member" ON public.recruiter_seats
  FOR SELECT TO authenticated
  USING (odesseus_private.is_org_admin_or_owner(org_id) OR odesseus_private.is_org_member(org_id));

-- Grants: authenticated = member-scoped SELECT only; full access for the
-- service role and postgres (webhook / RPC / maintenance paths).
REVOKE ALL ON TABLE public.employer_organizations FROM anon, authenticated;
REVOKE ALL ON TABLE public.employer_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.employer_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.employer_job_post_credits FROM anon, authenticated;
REVOKE ALL ON TABLE public.job_post_credit_ledger FROM anon, authenticated;
REVOKE ALL ON TABLE public.featured_listings FROM anon, authenticated;
REVOKE ALL ON TABLE public.recruiter_seats FROM anon, authenticated;

GRANT SELECT ON TABLE public.employer_organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_organizations TO postgres, service_role;
GRANT SELECT ON TABLE public.employer_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_members TO postgres, service_role;
GRANT SELECT ON TABLE public.employer_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_subscriptions TO postgres, service_role;
GRANT SELECT ON TABLE public.employer_job_post_credits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employer_job_post_credits TO postgres, service_role;
GRANT SELECT ON TABLE public.job_post_credit_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_post_credit_ledger TO postgres, service_role;
GRANT SELECT ON TABLE public.featured_listings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.featured_listings TO postgres, service_role;
GRANT SELECT ON TABLE public.recruiter_seats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recruiter_seats TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 5. RPC changes (Phase 2 slice)
-- ---------------------------------------------------------------------------

-- Employer tier renewal (webhook-invoked on invoice.paid). Grants a tier
-- cycle of job-post credits plus an immutable ledger row with a unique ref
-- for idempotent replays. Exposes no user data to the browser.
CREATE OR REPLACE FUNCTION public.grant_employer_tier_job_posts (
  p_org_id uuid,
  p_tier   text
)
  RETURNS TABLE (total integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_jobs integer := case p_tier
    when 'starter'  then 3
    when 'growth'   then 10
    when 'business' then 25
    else null
  end;
  v_ref text;
begin
  if v_jobs is null then
    raise exception 'unknown employer tier: %', p_tier;
  end if;

  if not exists (select 1 from public.employer_organizations where id = p_org_id) then
    raise exception 'employer organization not found';
  end if;

  v_ref := 'tier_grant:' || p_org_id::text || ':' || p_tier || ':' || now()::text;

  insert into public.employer_job_post_credits (org_id, total, granted_at, expires_at)
  values (p_org_id, v_jobs, now(), now() + interval '30 days');

  insert into public.job_post_credit_ledger (org_id, delta, reason, external_reference)
  values (p_org_id, v_jobs, 'tier_grant', v_ref);

  return query select v_jobs;
end;
$function$;

-- End the paid visibility of featured listings whose expiry has passed.
-- Scheduled (pg_cron / edge worker) and service-role only.
CREATE OR REPLACE FUNCTION public.expire_ended_featured_listings ()
  RETURNS TABLE (expired integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_count integer;
begin
  update public.featured_listings
  set is_active = false
  where is_active and expires_at <= now();

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$function$;

-- Service-role-only execution for the new RPCs.
REVOKE ALL ON FUNCTION public.grant_employer_tier_job_posts(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_employer_tier_job_posts(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.grant_employer_tier_job_posts(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_employer_tier_job_posts(uuid, text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.expire_ended_featured_listings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_ended_featured_listings() FROM anon;
REVOKE ALL ON FUNCTION public.expire_ended_featured_listings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ended_featured_listings() TO postgres, service_role;