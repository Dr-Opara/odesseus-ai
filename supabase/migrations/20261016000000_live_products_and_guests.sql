-- Odesseus Live commercial catalog + Live Share guest architecture.
-- Additive migration; local stack. Nothing historical is rewritten.
--
-- Locked candidate pricing implemented here:
--   apply             39 cents per verified successful submission
--   smart_apply       99 cents per verified successful submission
--   live_single      1499 cents  (one-time, one interview session)
--   live_monthly     1999 cents  (recurring, 30d)
--   live_personal_annual 9900 cents (recurring, 365d, personal only)
--   live_share_annual 49900 cents (recurring, 365d, 10 activated guests/yr)
--
-- Employer pricing is deliberately NOT touched here.
--
-- Design notes — this reuses the mechanisms that already exist rather than
-- standing up a parallel billing system:
--
--   * Apply rates. The atomic finalization RPC
--     (odesseus_finalize_application, 20260925000000) already reads the
--     USD_US reference price for candidate_standard_apply /
--     candidate_smart_apply rather than a hardcoded amount, so updating the
--     two reference prices below is the whole change. src/lib/billing/catalog.ts
--     applyRates is the mirrored TypeScript surface and a static test pins the
--     two to each other. Historical application_runs.price_cents is a
--     snapshot column and is never rewritten, so completed applications keep
--     showing what they were actually charged.
--
--   * live_single ($14.99). A one-time Live purchase is exactly what the
--     existing pipeline already does: billing_events insert ->
--     odesseus_private.fulfill_billing_event -> credit_transactions row ->
--     apply_credit_transaction trigger -> interview_passes + 1. So this SKU
--     needs no trigger change at all; it only needs a catalog entry. It keeps
--     credit_type = 'interview' because billing_events_credit_type_check
--     admits only ('application','interview','wallet_topup') and widening
--     that CHECK is not needed for this contract.
--
--   * Recurring Live plans. Monthly/Personal Annual/Share Annual are
--     time-boxed entitlements, not discrete-pass grants, so the same
--     treatment the old $499 annual used: the trigger grants no
--     credit_transactions row and instead (a) upserts a live_memberships row
--     and (b) extends credit_balances.live_unlimited_until. Keeping
--     live_unlimited_until in sync means the existing Live activation path
--     keeps working unchanged for members, and it is what preserves paid
--     legacy annual entitlements.
--
--   * Fair use. The backend never advertises "unlimited". The monthly session
--     ceiling lives in pricing_products.metadata
--     (fair_use_sessions / fair_use_window_days) and is copied onto the
--     membership row at grant time, so the ceiling is configured in exactly
--     one place (the catalog) and is not scattered as a literal.
--
--   * Idempotency. billing_events.stripe_event_id is UNIQUE, so a replayed
--     Stripe webhook fails the insert and grants nothing twice. That single
--     constraint is what makes purchase fulfillment, subscription grants and
--     renewals retry-safe.
--
--   * The 10-guest cap is enforced in the database by a BEFORE INSERT
--     trigger that takes a row lock on the parent membership and compares the
--     maintained guest_count against guest_limit. Guests hold no write
--     policies at all, and activated guests can be neither deleted nor
--     reassigned (no DELETE/UPDATE policies, and the entitlement's unique
--     index pins one guest to one membership period), so a member cannot
--     delete-and-replace an activated guest to buy an eleventh slot.

-- ===========================================================================
-- 1. Apply rate reference prices
-- ===========================================================================

UPDATE public.pricing_prices
SET amount_minor = 39, updated_at = now()
WHERE product_key = 'candidate_standard_apply' AND market_key = 'USD_US';

UPDATE public.pricing_prices
SET amount_minor = 99, updated_at = now()
WHERE product_key = 'candidate_smart_apply' AND market_key = 'USD_US';

-- ===========================================================================
-- 2. Retire the old Live commercial catalog
-- ===========================================================================
--
-- candidate_live_single (2499), candidate_live_pack_3 (5999) and
-- candidate_live_annual (49900) are deactivated, never deleted, so historical
-- billing_events reporting keeps resolving. Entitlements already purchased
-- under them stay usable: interview_passes are untouched, and any live
-- annual's live_unlimited_until window is left running to its original end.
-- The catalog check (in the pgTAP suite) asserts these rows survive.

UPDATE public.pricing_products
SET active = false, updated_at = now()
WHERE product_key IN ('candidate_live_single', 'candidate_live_pack_3', 'candidate_live_annual');

UPDATE public.pricing_prices
SET active = false, updated_at = now()
WHERE product_key IN ('candidate_live_single', 'candidate_live_pack_3', 'candidate_live_annual');

-- ===========================================================================
-- 3. New Live products + USD reference prices
-- ===========================================================================

INSERT INTO public.pricing_products
  (product_key, family, display_name, billing_type, billing_period_days, metadata)
VALUES
  ('live_single', 'candidate', 'Live — single interview', 'one_time', NULL,
   '{"charge_type":"live_session","credit_type":"interview","sessions":1,
     "legacy_sku":"interview_1"}'),
  ('live_monthly', 'candidate', 'Live — monthly', 'recurring', 30,
   '{"charge_type":"live_subscription","credit_type":"interview",
     "plan_type":"monthly","period_days":30,"guest_limit":0,
     "fair_use_sessions":20,"fair_use_window_days":30}'),
  ('live_personal_annual', 'candidate', 'Live — personal annual', 'recurring', 365,
   '{"charge_type":"live_subscription","credit_type":"interview",
     "plan_type":"personal_annual","period_days":365,"guest_limit":0,
     "fair_use_sessions":20,"fair_use_window_days":30}'),
  ('live_share_annual', 'candidate', 'Live Share — annual', 'recurring', 365,
   '{"charge_type":"live_subscription","credit_type":"interview",
     "plan_type":"share_annual","period_days":365,"guest_limit":10,
     "fair_use_sessions":20,"fair_use_window_days":30}')
ON CONFLICT (product_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      billing_type = EXCLUDED.billing_type,
      billing_period_days = EXCLUDED.billing_period_days,
      metadata = EXCLUDED.metadata,
      active = true,
      updated_at = now();

INSERT INTO public.pricing_prices
  (product_key, market_key, currency, amount_minor, metadata)
VALUES
  ('live_single', 'USD_US', 'USD',  1499, '{"kind":"reference"}'),
  ('live_monthly', 'USD_US', 'USD', 1999, '{"kind":"reference"}'),
  ('live_personal_annual', 'USD_US', 'USD', 9900, '{"kind":"reference"}'),
  ('live_share_annual', 'USD_US', 'USD', 49900, '{"kind":"reference"}')
ON CONFLICT (product_key, market_key) DO UPDATE
  SET amount_minor = EXCLUDED.amount_minor,
      metadata = EXCLUDED.metadata,
      active = true,
      updated_at = now();

-- ===========================================================================
-- 4. live_memberships
-- ===========================================================================

CREATE TABLE public.live_memberships (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type               text NOT NULL
                            CHECK (plan_type IN ('monthly','personal_annual','share_annual')),
  status                  text NOT NULL DEFAULT 'incomplete'
                            CHECK (status IN ('incomplete','trialing','active','past_due','canceled','unpaid','paused')),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  -- guest_limit is 0 for personal plans; only share_annual may carry guests.
  guest_limit             integer NOT NULL DEFAULT 0 CHECK (guest_limit >= 0),
  -- Maintained by odesseus_private.sync_live_membership_guest_count(). The
  -- guest-cap trigger reads this column while holding a row lock on this
  -- row, which is what makes the cap race-free.
  guest_count             integer NOT NULL DEFAULT 0 CHECK (guest_count >= 0),
  -- Copied from pricing_products.metadata at grant time so the fair-use
  -- ceiling is configured in the catalog, not hardcoded at each call site.
  fair_use_sessions       integer NOT NULL DEFAULT 20 CHECK (fair_use_sessions > 0),
  fair_use_window_days    integer NOT NULL DEFAULT 30 CHECK (fair_use_window_days > 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_memberships_user_plan_key UNIQUE (user_id, plan_type),
  -- A personal plan must never advertise guest capacity.
  CONSTRAINT live_memberships_personal_has_no_guests
    CHECK (plan_type = 'share_annual' OR guest_limit = 0),
  -- guest_count can never exceed the cap it is measured against.
  CONSTRAINT live_memberships_guest_count_within_limit
    CHECK (guest_count <= guest_limit),
  -- An active period is the only state that may be considered for access.
  CONSTRAINT live_memberships_period_ordered
    CHECK (current_period_start IS NULL OR current_period_end IS NULL
           OR current_period_start <= current_period_end)
);

ALTER TABLE public.live_memberships ENABLE ROW LEVEL SECURITY;

-- The owner may read their own membership. Guests deliberately get NO policy
-- here: a guest learns what their entitlement is from
-- odesseus_get_live_entitlement (service role), never by reading the owner's
-- membership row, Stripe ids or fair-use counters.
CREATE POLICY live_memberships_owner_read ON public.live_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON TABLE public.live_memberships TO authenticated;
GRANT ALL ON TABLE public.live_memberships TO postgres, service_role;

CREATE INDEX live_memberships_user_idx ON public.live_memberships (user_id);
CREATE UNIQUE INDEX live_memberships_stripe_sub_key
  ON public.live_memberships (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX live_memberships_period_idx
  ON public.live_memberships (user_id, current_period_end DESC);

-- ===========================================================================
-- 5. live_guest_invites
-- ===========================================================================

CREATE TABLE public.live_guest_invites (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id           uuid NOT NULL REFERENCES public.live_memberships(id) ON DELETE CASCADE,
  owner_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_email             text NOT NULL,
  -- Normalized copy maintained by the create RPC. Postgres cannot index an
  -- expression inside a unique constraint, so the normalized value is stored
  -- and constrained to stay in sync with guest_email.
  guest_email_normalized  text NOT NULL,
  guest_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- sha256 hex of the one-time token. The token itself is generated in the
  -- API route with node:crypto and never persisted.
  invite_token_hash       text NOT NULL,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','activated','revoked','expired')),
  invited_at              timestamptz NOT NULL DEFAULT now(),
  accepted_at             timestamptz,
  activated_at            timestamptz,
  revoked_at              timestamptz,
  expires_at              timestamptz NOT NULL,
  membership_period_start timestamptz NOT NULL,
  membership_period_end   timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_guest_invites_email_normalized_check
    CHECK (guest_email_normalized = lower(btrim(guest_email))),
  -- Only an accepted-but-not-yet-activated invite has a guest identity
  -- bound; a plain invitation never permanently consumes a slot.
  CONSTRAINT live_guest_invites_activation_shape
    CHECK ((status = 'activated') = (activated_at IS NOT NULL))
);

ALTER TABLE public.live_guest_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY live_guest_invites_owner_all ON public.live_guest_invites
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- A guest may read only their own invite, and only once it has been bound to
-- them. Owner data (other guests, token hashes) stays invisible.
CREATE POLICY live_guest_invites_guest_read ON public.live_guest_invites
  FOR SELECT TO authenticated
  USING (guest_user_id = auth.uid() AND status IN ('accepted','activated'));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.live_guest_invites TO authenticated;
GRANT ALL ON TABLE public.live_guest_invites TO postgres, service_role;

CREATE INDEX live_guest_invites_membership_idx
  ON public.live_guest_invites (membership_id, status);
CREATE INDEX live_guest_invites_owner_idx
  ON public.live_guest_invites (owner_user_id, status);
CREATE INDEX live_guest_invites_guest_idx
  ON public.live_guest_invites (guest_user_id)
  WHERE guest_user_id IS NOT NULL;
-- One live pending invitation per email per membership. Sending the same
-- email again is therefore an update, not a second pending row.
CREATE UNIQUE INDEX live_guest_invites_pending_email_key
  ON public.live_guest_invites (membership_id, guest_email_normalized)
  WHERE status = 'pending';
-- A guest may never be bound to the same membership twice.
CREATE UNIQUE INDEX live_guest_invites_bound_guest_key
  ON public.live_guest_invites (membership_id, guest_user_id)
  WHERE guest_user_id IS NOT NULL;

-- ===========================================================================
-- 6. live_guest_entitlements
-- ===========================================================================

CREATE TABLE public.live_guest_entitlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id           uuid NOT NULL REFERENCES public.live_memberships(id) ON DELETE RESTRICT,
  owner_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_id               uuid REFERENCES public.live_guest_invites(id) ON DELETE SET NULL,
  activated_at            timestamptz NOT NULL DEFAULT now(),
  membership_period_start timestamptz NOT NULL,
  membership_period_end   timestamptz NOT NULL,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','expired')),
  sessions_used           integer NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- The anti-double-spend rule: one unique activated guest consumes exactly
  -- one slot in exactly one membership period. Retrying an activation hits
  -- this constraint instead of consuming a second slot.
  CONSTRAINT live_guest_entitlements_guest_period_key
    UNIQUE (membership_id, guest_user_id, membership_period_start),
  CONSTRAINT live_guest_entitlements_period_ordered
    CHECK (membership_period_start < membership_period_end),
  -- A guest can never be the owner of the membership they are entitled to.
  CONSTRAINT live_guest_entitlements_not_self
    CHECK (owner_user_id <> guest_user_id)
);

ALTER TABLE public.live_guest_entitlements ENABLE ROW LEVEL SECURITY;

-- Read-only for both roles, and deliberately with no UPDATE/DELETE policy:
-- an activated guest can be neither edited into a different identity nor
-- removed, which is what closes the delete-and-replace bypass of the cap.
-- All writes go through the service-role RPC below.
CREATE POLICY live_guest_entitlements_owner_read ON public.live_guest_entitlements
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY live_guest_entitlements_guest_read ON public.live_guest_entitlements
  FOR SELECT TO authenticated
  USING (guest_user_id = auth.uid());

GRANT SELECT ON TABLE public.live_guest_entitlements TO authenticated;
GRANT ALL ON TABLE public.live_guest_entitlements TO postgres, service_role;

CREATE INDEX live_guest_entitlements_membership_idx
  ON public.live_guest_entitlements (membership_id, status);
CREATE INDEX live_guest_entitlements_guest_idx
  ON public.live_guest_entitlements (guest_user_id, status);
CREATE INDEX live_guest_entitlements_period_idx
  ON public.live_guest_entitlements (membership_id, membership_period_start);

-- Enforce the 10-activated-guest cap in the database.
CREATE OR REPLACE FUNCTION odesseus_private.enforce_live_guest_cap()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_limit integer;
  v_count integer;
begin
  -- Lock the membership row so two concurrent activations of the eleventh
  -- guest serialize: the second one sees the first one's incremented count.
  select guest_limit, guest_count
  into v_limit, v_count
  from public.live_memberships
  where id = new.membership_id
  for update;

  if not found then
    raise exception 'live membership % does not exist', new.membership_id;
  end if;

  if v_limit < 1 then
    raise exception 'plan % does not include guest access', new.membership_id;
  end if;

  if v_count >= v_limit then
    raise exception 'guest limit reached: % of % activated guests for this membership year',
      v_count, v_limit;
  end if;

  return new;
end;
$function$;

CREATE TRIGGER live_guest_entitlements_cap
  BEFORE INSERT ON public.live_guest_entitlements
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.enforce_live_guest_cap();

-- Keep live_memberships.guest_count equal to the number of live entitlements
-- ACTIVE IN THE CURRENT MEMBERSHIP PERIOD, so the cap column and the rows can
-- never diverge and so a prior year's activated guests do not permanently
-- occupy slots after a renewal. Each entitlement is stamped with the
-- membership_period_start it was activated under; scoping the count to the
-- membership's *current* current_period_start is what makes a renewal (which
-- advances current_period_start) reset this back toward zero on its own,
-- with no separate "reset" step required here.
CREATE OR REPLACE FUNCTION odesseus_private.sync_live_membership_guest_count()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  update public.live_memberships m
  set guest_count = (
        select count(*)::int
        from public.live_guest_entitlements e
        where e.membership_id = coalesce(new.membership_id, old.membership_id)
          and e.status = 'active'
          and e.membership_period_start = m.current_period_start
      ),
      updated_at = now()
  where m.id = coalesce(new.membership_id, old.membership_id)
    and m.guest_limit > 0;

  return coalesce(new, old);
end;
$function$;

CREATE TRIGGER live_guest_entitlements_guest_count
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.live_guest_entitlements
  FOR EACH ROW EXECUTE FUNCTION odesseus_private.sync_live_membership_guest_count();

-- ===========================================================================
-- 7. live_guest_transactions (monetization foundation, no payouts)
-- ===========================================================================
--
-- Foundation only. platform_fee_cents and owner_earnings_cents stay NULL and
-- no function in this migration moves money, because the revenue split, Stripe
-- Connect onboarding and the compliance path are a separate phase. Nothing
-- here grants a wallet balance.

CREATE TABLE public.live_guest_transactions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id             uuid NOT NULL REFERENCES public.live_memberships(id) ON DELETE CASCADE,
  owner_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_entitlement_id      uuid REFERENCES public.live_guest_entitlements(id) ON DELETE SET NULL,
  gross_amount_cents        integer NOT NULL CHECK (gross_amount_cents > 0),
  platform_fee_cents        integer CHECK (platform_fee_cents IS NULL OR platform_fee_cents >= 0),
  owner_earnings_cents      integer CHECK (owner_earnings_cents IS NULL OR owner_earnings_cents >= 0),
  currency                  text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','succeeded','failed','refunded')),
  stripe_payment_intent_id  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_guest_transactions_earnings_consistent
    CHECK (owner_earnings_cents IS NULL
           OR platform_fee_cents IS NULL
           OR owner_earnings_cents + platform_fee_cents <= gross_amount_cents)
);

ALTER TABLE public.live_guest_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY live_guest_transactions_owner_read ON public.live_guest_transactions
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY live_guest_transactions_guest_read ON public.live_guest_transactions
  FOR SELECT TO authenticated
  USING (guest_user_id = auth.uid());

GRANT SELECT ON TABLE public.live_guest_transactions TO authenticated;
GRANT ALL ON TABLE public.live_guest_transactions TO postgres, service_role;

CREATE INDEX live_guest_transactions_membership_idx
  ON public.live_guest_transactions (membership_id, status);
CREATE INDEX live_guest_transactions_owner_idx
  ON public.live_guest_transactions (owner_user_id, status);
CREATE INDEX live_guest_transactions_guest_idx
  ON public.live_guest_transactions (guest_user_id, status);

-- ===========================================================================
-- 8. Fulfillment: grant Live memberships from a paid billing event
-- ===========================================================================
--
-- live_single is intentionally absent: it falls through to the existing
-- credit_transactions path and becomes interview_passes + 1, which is exactly
-- what a one-session purchase should do.

CREATE OR REPLACE FUNCTION odesseus_private.fulfill_billing_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_product public.pricing_products%rowtype;
  v_plan_type text;
  v_period_days integer;
  v_guest_limit integer;
  v_fair_use_sessions integer;
  v_fair_use_window_days integer;
  v_period_end timestamptz;
  v_is_live_subscription boolean := false;
begin
  select p.metadata->>'plan_type', p.billing_period_days,
         coalesce((p.metadata->>'guest_limit')::integer, 0),
         coalesce((p.metadata->>'fair_use_sessions')::integer, 20),
         coalesce((p.metadata->>'fair_use_window_days')::integer, 30)
  into v_plan_type, v_period_days, v_guest_limit, v_fair_use_sessions, v_fair_use_window_days
  from public.pricing_products p
  where p.product_key = new.sku
    and p.metadata->>'charge_type' = 'live_subscription';

  v_is_live_subscription := (v_plan_type is not null);

  if v_is_live_subscription then
    -- The period comes from Stripe when the webhook supplied it; the catalog
    -- period is the fallback so a grant can never be written period-less.
    v_period_end := coalesce(
      (new.metadata->>'current_period_end')::timestamptz,
      now() + make_interval(days => v_period_days)
    );

    insert into public.live_memberships (
      user_id, plan_type, status, stripe_customer_id, stripe_subscription_id,
      current_period_start, current_period_end,
      guest_limit, guest_count, fair_use_sessions, fair_use_window_days, updated_at
    )
    values (
      new.user_id, v_plan_type, 'active', new.stripe_customer_id,
      nullif(new.metadata->>'stripe_subscription_id', ''),
      coalesce((new.metadata->>'current_period_start')::timestamptz, now()),
      v_period_end,
      v_guest_limit, 0, v_fair_use_sessions, v_fair_use_window_days, now()
    )
    on conflict (user_id, plan_type) do update
      set status = 'active',
          stripe_customer_id = coalesce(excluded.stripe_customer_id, public.live_memberships.stripe_customer_id),
          stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.live_memberships.stripe_subscription_id),
          -- A renewal or a re-purchase extends from the later of the existing
          -- end and now, so a member is never billed a gap and never loses
          -- the remainder of a period they already paid for.
          current_period_start = excluded.current_period_start,
          current_period_end = greatest(public.live_memberships.current_period_end,
                                        excluded.current_period_start,
                                        excluded.current_period_end),
          guest_limit = excluded.guest_limit,
          fair_use_sessions = excluded.fair_use_sessions,
          fair_use_window_days = excluded.fair_use_window_days,
          updated_at = now();

    -- Keep the pre-existing annual-entitlement column in step so the current
    -- Live activation path keeps honouring members without a code change.
    insert into public.credit_balances (user_id, application_credits, interview_passes, live_unlimited_until, updated_at)
    values (new.user_id, 0, 0, v_period_end, now())
    on conflict (user_id) do update
      set live_unlimited_until = greatest(coalesce(public.credit_balances.live_unlimited_until, now()),
                                          v_period_end),
          updated_at = now();

    return new;
  end if;

  if new.sku = 'interview_annual' then
    -- Retired catalog entry, kept for legacy purchases made before this
    -- migration. Already-paid annual entitlements are honoured on exactly the
    -- terms they were bought under and are not shortened.
    insert into public.credit_balances (user_id, application_credits, interview_passes, live_unlimited_until, updated_at)
    values (new.user_id, 0, 0, now() + interval '12 months', now())
    on conflict (user_id) do update
      set live_unlimited_until = greatest(coalesce(public.credit_balances.live_unlimited_until, now()), now()) + interval '12 months',
          updated_at = now();
  else
    -- Wallet top-ups and live_single both land here and are applied to
    -- credit_balances by the existing apply_credit_transaction trigger.
    insert into public.credit_transactions
      (user_id, credit_type, delta, reason, external_reference, amount_cents, metadata)
    values
      (
        new.user_id,
        new.credit_type,
        new.credit_delta,
        'stripe_purchase',
        new.stripe_event_id,
        new.amount_cents,
        jsonb_build_object(
          'sku', new.sku,
          'checkout_session_id', new.checkout_session_id,
          'currency', new.currency,
          'stripe_customer_id', new.stripe_customer_id
        ) || new.metadata
      );
  end if;

  return new;
end;
$function$;

-- ===========================================================================
-- 9. odesseus_get_live_entitlement — extended with membership/guest access
-- ===========================================================================
--
-- This function already exists (20261011000000_live_entitlement_helper.sql,
-- Phase 7A) with OUT parameters covering discrete passes and the legacy
-- annual window; src/app/api/interviews/[id]/live/eligibility/route.ts
-- destructures its six fields by name. Postgres refuses to change a
-- function's return shape via CREATE OR REPLACE, so it is dropped and
-- recreated here with those exact six original fields — same names, order
-- and types — plus five new trailing fields for memberships and guests.
-- Every existing caller keeps working unchanged; the membership/guest
-- resolution is checked first and returns early, then the original
-- pass/annual/none logic runs byte-for-byte as before.
--
-- This becomes the one authoritative Live access check: a membership owner,
-- an activated guest, a discrete pass holder and a legacy annual member are
-- all resolved by the same function, so no route or client has to re-derive
-- entitlement rules of its own.

DROP FUNCTION IF EXISTS public.odesseus_get_live_entitlement(uuid);

CREATE FUNCTION public.odesseus_get_live_entitlement (
  p_user_id uuid,
  OUT has_entitlement boolean,
  OUT entitlement_type text,
  OUT passes_remaining integer,
  OUT unlimited_until timestamptz,
  OUT fair_use_count integer,
  OUT fair_use_reset timestamptz,
  OUT is_owner boolean,
  OUT is_guest boolean,
  OUT membership_id uuid,
  OUT guest_limit integer,
  OUT activated_guest_count integer,
  -- The specific plan behind entitlement_type = 'membership'
  -- ('monthly' | 'personal_annual' | 'share_annual') or 'guest' when the
  -- caller is an activated guest; null for passes/annual/none, where there
  -- is no plan to name.
  OUT plan text
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_balances public.credit_balances%rowtype;
  v_now timestamptz := now();
  v_fair_use_count integer;
  v_fair_use_reset timestamptz;
  v_membership public.live_memberships%rowtype;
  v_guest public.live_guest_entitlements%rowtype;
  v_owner_membership public.live_memberships%rowtype;
  v_recent integer;
begin
  is_owner := false;
  is_guest := false;
  membership_id := null;
  guest_limit := 0;
  activated_guest_count := 0;
  plan := null;

  -- 1. Owner membership (monthly / personal annual / share annual). A
  -- cancelled-at-period-end subscription keeps access until its paid period
  -- actually ends, so 'canceled' still grants while current_period_end is in
  -- the future; unpaid / incomplete / paused and any lapsed period grant
  -- nothing.
  select * into v_membership
  from public.live_memberships m
  where m.user_id = p_user_id
    and m.status in ('active', 'trialing', 'canceled')
    and m.current_period_end is not null
    and m.current_period_end > v_now
  order by m.current_period_end desc
  limit 1;

  if found then
    select count(*)::int into v_recent
    from public.live_interview_sessions s
    where s.user_id = p_user_id
      and s.activated_at is not null
      and s.activated_at >= v_now - make_interval(days => v_membership.fair_use_window_days);

    has_entitlement := true;
    entitlement_type := 'membership';
    passes_remaining := greatest(v_membership.fair_use_sessions - v_recent, 0);
    unlimited_until := v_membership.current_period_end;
    fair_use_count := v_recent;
    fair_use_reset := v_now + make_interval(days => v_membership.fair_use_window_days);
    is_owner := (v_membership.plan_type = 'share_annual');
    membership_id := v_membership.id;
    guest_limit := v_membership.guest_limit;
    activated_guest_count := v_membership.guest_count;
    plan := v_membership.plan_type;
    return;
  end if;

  -- 2. Guest access. Resolved against the OWNER's membership so the guest
  -- gets the owner's fair-use window, and the guest never reads the owner's
  -- row directly — this function is the only thing that crosses that
  -- boundary.
  select e.* into v_guest
  from public.live_guest_entitlements e
  where e.guest_user_id = p_user_id
    and e.status = 'active'
    and e.membership_period_start <= v_now
    and e.membership_period_end > v_now
  order by e.membership_period_end desc
  limit 1;

  if found then
    select * into v_owner_membership
    from public.live_memberships m
    where m.id = v_guest.membership_id;

    if found and v_owner_membership.status in ('active', 'trialing', 'canceled') then
      select count(*)::int into v_recent
      from public.live_interview_sessions s
      where s.user_id = p_user_id
        and s.activated_at is not null
        and s.activated_at >= v_now - make_interval(days => v_owner_membership.fair_use_window_days);

      has_entitlement := true;
      entitlement_type := 'guest';
      passes_remaining := greatest(coalesce(v_owner_membership.fair_use_sessions, 20) - v_recent, 0);
      unlimited_until := v_guest.membership_period_end;
      fair_use_count := v_recent;
      fair_use_reset := v_now + make_interval(days => coalesce(v_owner_membership.fair_use_window_days, 30));
      is_guest := true;
      membership_id := v_guest.membership_id;
      plan := 'guest';
      return;
    end if;
  end if;

  -- 3. Original Phase 7A logic, unchanged: discrete passes, then the legacy
  -- annual window, then nothing.
  select * into v_balances from public.credit_balances where user_id = p_user_id;

  if not found then
    has_entitlement := false;
    entitlement_type := 'none';
    passes_remaining := 0;
    unlimited_until := null;
    fair_use_count := 0;
    fair_use_reset := v_now;
    return;
  end if;

  v_fair_use_reset := v_now - interval '30 days';

  select count(*)
  into v_fair_use_count
  from public.live_interview_sessions
  where user_id = p_user_id
    and activated_at >= v_fair_use_reset
    and status in ('active', 'completed');

  if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
    has_entitlement := true;
    entitlement_type := 'annual';
    passes_remaining := 0;
    unlimited_until := v_balances.live_unlimited_until;
    fair_use_count := v_fair_use_count;
    fair_use_reset := v_fair_use_reset + interval '30 days';
    return;
  end if;

  if v_balances.interview_passes > 0 then
    has_entitlement := true;
    entitlement_type := 'passes';
    passes_remaining := v_balances.interview_passes;
    unlimited_until := null;
    fair_use_count := 0;
    fair_use_reset := v_fair_use_reset + interval '30 days';
    return;
  end if;

  has_entitlement := false;
  entitlement_type := 'none';
  passes_remaining := 0;
  unlimited_until := null;
  fair_use_count := 0;
  fair_use_reset := v_fair_use_reset + interval '30 days';
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_get_live_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_get_live_entitlement(uuid) TO postgres, service_role;

-- ===========================================================================
-- 10. odesseus_sync_live_membership — subscription lifecycle
-- ===========================================================================
--
-- Called from the Stripe webhook for renewal, plan change, cancellation and
-- delinquency. Idempotent by stripe_subscription_id, so a retried webhook
-- converges on the same row instead of creating a second membership.

CREATE OR REPLACE FUNCTION public.odesseus_sync_live_membership (
  p_stripe_subscription_id text,
  p_user_id                uuid,
  p_status                 text,
  p_period_start           timestamptz DEFAULT NULL,
  p_period_end             timestamptz DEFAULT NULL,
  p_stripe_customer_id     text          DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_membership public.live_memberships%rowtype;
  v_plan_type text;
  v_guest_limit integer;
  v_effective_end timestamptz;
  v_is_renewal boolean;
begin
  if p_stripe_subscription_id is null or p_user_id is null then
    return null;
  end if;

  if p_status is not null
     and p_status not in ('incomplete','trialing','active','past_due','canceled','unpaid','paused') then
    return null;
  end if;

  -- Only plan_type and guest_limit are needed here: a renewal rolls the
  -- period forward from what Stripe sent (p_period_start/p_period_end), it
  -- does not recompute the period length or fair-use ceiling from the
  -- catalog — those were already copied onto the row at grant time.
  select p.metadata->>'plan_type',
         coalesce((p.metadata->>'guest_limit')::integer, 0)
  into v_plan_type, v_guest_limit
  from public.live_memberships m
  join public.pricing_products p
    on p.metadata->>'plan_type' = m.plan_type
   and p.metadata->>'charge_type' = 'live_subscription'
  where m.stripe_subscription_id = p_stripe_subscription_id
  order by p.product_key
  limit 1;

  if v_plan_type is null then
    return null;
  end if;

  select * into v_membership
  from public.live_memberships
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if not found then
    return null;
  end if;

  v_effective_end := coalesce(p_period_end, v_membership.current_period_end);

  -- A renewal is specifically a period_start that has moved forward, not
  -- just any sync call (a status-only lifecycle event passes no period and
  -- must not be mistaken for one).
  v_is_renewal := (
    p_period_start is not null
    and (v_membership.current_period_start is null
         or p_period_start > v_membership.current_period_start)
  );

  update public.live_memberships
  set status = coalesce(p_status, v_membership.status),
      current_period_start = coalesce(p_period_start, v_membership.current_period_start),
      current_period_end = v_effective_end,
      stripe_customer_id = coalesce(p_stripe_customer_id, v_membership.stripe_customer_id),
      updated_at = now()
  where id = v_membership.id;

  -- The guest allocation resets for the new membership year. Prior-period
  -- entitlements are marked expired (status bookkeeping — what the cap
  -- actually reads is guest_count, scoped to current_period_start by
  -- sync_live_membership_guest_count), and guest_count is recomputed here
  -- immediately rather than waiting for the next entitlement write to
  -- trigger it, so the first activation of the new year is never blocked by
  -- a stale count left over from the year that just ended.
  if v_is_renewal and v_guest_limit > 0 then
    update public.live_guest_entitlements
    set status = 'expired', updated_at = now()
    where membership_id = v_membership.id
      and status = 'active'
      and membership_period_start < p_period_start;

    update public.live_memberships m
    set guest_count = (
          select count(*)::int
          from public.live_guest_entitlements e
          where e.membership_id = m.id
            and e.status = 'active'
            and e.membership_period_start = m.current_period_start
        ),
        updated_at = now()
    where m.id = v_membership.id;
  end if;

  -- A membership that has actually lapsed must stop granting the legacy
  -- unlimited window too, or a lapsed member would keep activating Live.
  if v_effective_end is null or v_effective_end <= now() then
    update public.credit_balances b
    set live_unlimited_until = null, updated_at = now()
    where b.user_id = v_membership.user_id
      and b.live_unlimited_until is not null
      and b.live_unlimited_until > now();
  else
    update public.credit_balances b
    set live_unlimited_until = greatest(coalesce(b.live_unlimited_until, now()), v_effective_end),
        updated_at = now()
    where b.user_id = v_membership.user_id;
  end if;

  return v_membership.id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text)
  TO postgres, service_role;

-- ===========================================================================
-- 11. Guest invite lifecycle RPCs
-- ===========================================================================
--
-- All three are service-role only. The API route resolves the caller from the
-- Supabase session and passes the id in, so authorization never depends on
-- client-supplied identity and never reads user_metadata.

-- Invites a guest. An invitation alone does not consume a slot: the cap is
-- checked on activation, not here, so a member may keep spare invitations
-- pending and revoke or replace them freely.
CREATE OR REPLACE FUNCTION public.odesseus_create_live_guest_invite (
  p_membership_id  uuid,
  p_owner_user_id  uuid,
  p_guest_email    text,
  p_invite_token   text,
  p_expires_at     timestamptz DEFAULT NULL
)
RETURNS TABLE (invite_id uuid, status text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_membership public.live_memberships%rowtype;
  v_email text := lower(btrim(p_guest_email));
  v_expires timestamptz;
  v_invite_id uuid;
begin
  if p_invite_token is null or length(p_invite_token) < 32 then
    raise exception 'invite token is missing or too short';
  end if;

  if v_email is null or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid guest email address is required';
  end if;

  select * into v_membership
  from public.live_memberships m
  where m.id = p_membership_id
    and m.user_id = p_owner_user_id
  for update;

  if not found then
    raise exception 'live membership not found';
  end if;

  if v_membership.plan_type <> 'share_annual' or v_membership.guest_limit < 1 then
    raise exception 'only Live Share Annual includes guest access';
  end if;

  if v_membership.status not in ('active', 'trialing', 'canceled')
     or v_membership.current_period_end is null
     or v_membership.current_period_end <= now() then
    raise exception 'the Live Share membership is not active';
  end if;

  -- A member cannot invite themselves or use a guest slot on themselves.
  if exists (select 1 from auth.users u where u.id = p_owner_user_id and lower(u.email) = v_email) then
    raise exception 'the owner cannot be their own guest';
  end if;

  v_expires := least(
    coalesce(p_expires_at, now() + interval '14 days'), v_membership.current_period_end
  );

  -- Re-inviting the same address refreshes the existing pending invitation
  -- rather than creating a second one. The alias is required: this function's
  -- RETURNS TABLE has an OUT column also named `status`, which would
  -- otherwise shadow the table column in plpgsql.
  update public.live_guest_invites i
  set expires_at = v_expires,
      invite_token_hash = encode(sha256(p_invite_token::bytea), 'hex'),
      updated_at = now()
  where i.membership_id = p_membership_id
    and i.guest_email_normalized = v_email
    and i.status = 'pending'
  returning i.id into v_invite_id;

  if v_invite_id is null then
    insert into public.live_guest_invites (
      membership_id, owner_user_id, guest_email, guest_email_normalized,
      invite_token_hash, status, expires_at,
      membership_period_start, membership_period_end
    )
    values (
      p_membership_id, p_owner_user_id, p_guest_email, v_email,
      encode(sha256(p_invite_token::bytea), 'hex'), 'pending', v_expires,
      v_membership.current_period_start, v_membership.current_period_end
    )
    returning id into v_invite_id;
  end if;

  return query select v_invite_id, 'pending'::text, v_expires;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_create_live_guest_invite(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_create_live_guest_invite(uuid, uuid, text, text, timestamptz)
  TO postgres, service_role;

-- Accepts an invitation and consumes one guest slot. This is the single place
-- the 10-guest cap is applied: the BEFORE INSERT trigger rejects an eleventh
-- activation, and the unique (membership_id, guest_user_id,
-- membership_period_start) index makes a retried acceptance a no-op instead
-- of a second slot.
CREATE OR REPLACE FUNCTION public.odesseus_accept_live_guest_invite (
  p_token         text,
  p_guest_user_id uuid
)
RETURNS TABLE (
  result          text,
  message         text,
  membership_id   uuid,
  period_end      timestamptz,
  guest_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_invite public.live_guest_invites%rowtype;
  v_membership public.live_memberships%rowtype;
  v_guest_email text;
  v_token_hash text;
  v_remaining integer;
begin
  if p_token is null or p_guest_user_id is null then
    return query select 'invalid', 'A signed-in account and a valid invitation link are both required.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  v_token_hash := encode(sha256(btrim(p_token)::bytea), 'hex');

  -- Look the invitation up in any state so a retried acceptance can be
  -- answered "already active" rather than the misleading "not valid".
  select * into v_invite
  from public.live_guest_invites i
  where i.invite_token_hash = v_token_hash
  for update;

  if not found or v_invite.status = 'revoked' then
    return query select 'invalid', 'This invitation link is not valid.', null::uuid, null::timestamptz, 0;
    return;
  end if;

  if v_invite.status = 'expired' or v_invite.expires_at <= now() then
    update public.live_guest_invites i
    set status = 'expired', updated_at = now()
    where i.id = v_invite.id and i.status <> 'activated';
    return query select 'expired', 'This invitation has expired. Ask the owner for a new one.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  -- Resolve the guest's email from auth, not from the request, so a
  -- forwarded link cannot be redeemed by a different account.
  select lower(u.email) into v_guest_email
  from auth.users u
  where u.id = p_guest_user_id;

  if v_guest_email is null or v_guest_email <> v_invite.guest_email_normalized then
    return query select 'invalid', 'This invitation was sent to a different email address.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  if v_invite.guest_user_id is not null and v_invite.guest_user_id <> p_guest_user_id then
    return query select 'invalid', 'This invitation has already been claimed.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  select * into v_membership
  from public.live_memberships m
  where m.id = v_invite.membership_id
  for update;

  if not found then
    return query select 'invalid', 'The Live Share membership no longer exists.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  if v_membership.status not in ('active', 'trialing', 'canceled')
     or v_membership.current_period_end is null
     or v_membership.current_period_end <= now() then
    return query select 'inactive', 'The Live Share membership is not active.',
                   null::uuid, null::timestamptz, 0;
    return;
  end if;

  -- Already activated in this period: report the existing entitlement rather
  -- than consuming a second slot.
  if exists (
    select 1 from public.live_guest_entitlements e
    where e.membership_id = v_membership.id
      and e.guest_user_id = p_guest_user_id
      and e.membership_period_start = v_invite.membership_period_start
      and e.status = 'active'
  ) then
    v_remaining := greatest(v_membership.guest_limit - v_membership.guest_count, 0);
    return query select 'already_active', 'You already have Live access through this membership.',
                   v_membership.id, v_membership.current_period_end, v_remaining;
    return;
  end if;

  insert into public.live_guest_entitlements (
    membership_id, owner_user_id, guest_user_id, invite_id, activated_at,
    membership_period_start, membership_period_end, status
  )
  values (
    v_membership.id, v_membership.user_id, p_guest_user_id, v_invite.id, now(),
    v_invite.membership_period_start, v_invite.membership_period_end, 'active'
  );

  update public.live_guest_invites
  set status = 'activated',
      guest_user_id = p_guest_user_id,
      accepted_at = coalesce(accepted_at, now()),
      activated_at = now(),
      updated_at = now()
  where id = v_invite.id;

  v_remaining := greatest(v_membership.guest_limit - v_membership.guest_count, 0);

  return query select 'activated'::text, 'Your Live access through this membership is active.',
                 v_membership.id, v_membership.current_period_end, v_remaining;
exception
  when unique_violation then
    -- Two activations of the same guest raced: the unique index decided, and
    -- the loser consumes no slot.
    v_remaining := greatest(v_membership.guest_limit - v_membership.guest_count, 0);
    return query select 'already_active', 'You already have Live access through this membership.',
                   v_membership.id, v_membership.current_period_end, v_remaining;
  when others then
    if sqlerrm like 'guest limit reached%' then
      return query select 'guest_limit_reached',
                     'This Live Share membership has used all of its guest slots for this year.',
                     v_membership.id, v_membership.current_period_end, 0;
      return;
    end if;
    raise;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid)
  TO postgres, service_role;

-- Revokes an invitation. Only a pending invitation can be revoked: an
-- activated guest has consumed a slot for the year and must not be removable.
CREATE OR REPLACE FUNCTION public.odesseus_revoke_live_guest_invite (
  p_membership_id uuid,
  p_owner_user_id uuid,
  p_invite_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_invite public.live_guest_invites%rowtype;
begin
  select * into v_invite
  from public.live_guest_invites i
  where i.id = p_invite_id
    and i.membership_id = p_membership_id
    and i.owner_user_id = p_owner_user_id
  for update;

  if not found then
    return false;
  end if;

  if v_invite.status = 'activated' then
    raise exception 'this guest has already been activated and their slot cannot be released';
  end if;

  if v_invite.status = 'revoked' then
    return true;
  end if;

  update public.live_guest_invites
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invite_id;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_revoke_live_guest_invite(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_revoke_live_guest_invite(uuid, uuid, uuid)
  TO postgres, service_role;

-- Guest-facing view of an invitation's status, without exposing the owner.
CREATE OR REPLACE FUNCTION public.odesseus_live_guest_invite_status (p_token text)
RETURNS TABLE (
  result       text,
  guest_email  text,
  owner_label  text,
  period_end   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_invite public.live_guest_invites%rowtype;
begin
  select * into v_invite
  from public.live_guest_invites i
  where i.invite_token_hash = encode(sha256(btrim(p_token)::bytea), 'hex');

  if not found then
    return query select 'invalid', null::text, null::text, null::timestamptz;
    return;
  end if;

  return query select
    v_invite.status,
    -- Only the domain is echoed back, never the whole address, so a leaked
    -- link reveals nothing more than the invitee's own mailbox.
    split_part(v_invite.guest_email_normalized, '@', 2),
    'Odesseus Live Share',
    v_invite.membership_period_end;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_live_guest_invite_status(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_live_guest_invite_status(text)
  TO postgres, service_role;
