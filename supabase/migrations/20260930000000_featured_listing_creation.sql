-- Featured listings fulfillment (M6). Additive migration; local stack.
--
-- The pricing contract (20260924000000) created public.featured_listings with
-- a tier CHECK ('featured_7d', 'featured_14d', 'ai_30d'), a UNIQUE
-- stripe_payment_intent, and a scheduled expire_ended_featured_listings() job —
-- but left creation to the billing webhook. M4 bound job_id to employer_jobs.
-- This migration adds the webhook's service-role-only creation RPC:
--
--   public.odesseus_create_featured_listing(
--     p_org_id uuid, p_job_id uuid, p_tier text, p_stripe_payment_intent text)
--
-- It computes the paid visibility window from the tier (7 / 14 / 30 days),
-- verifies the featured job belongs to the paying organization, and creates
-- the listing exactly once per payment intent (replays return the original
-- row instead of a duplicate). Pricing stays server-side: the webhook verifies
-- the paid checkout amount against the featured catalog before calling this.
--
-- Invariants preserved: additive-only; featured_listings RLS/grants untouched
-- (still member-read / service-role-write); no changes to candidate wallet,
-- apply settlement, employer plan quotas, recruiter seats, or Live pricing.

-- ---------------------------------------------------------------------------
-- 1. Featured listing creation (service role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_create_featured_listing (
  p_org_id                 uuid,
  p_job_id                 uuid,
  p_tier                   text,
  p_stripe_payment_intent  text
)
  RETURNS TABLE (
    listing_id  uuid,
    expires_at  timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_days        integer;
  v_listing_id  uuid;
  v_expires_at  timestamptz;
begin
  -- Tier duration mapping is server-side: 7 / 14 / 30 days for the three
  -- featured products; anything else fails closed before any row is written.
  case p_tier
    when 'featured_7d'  then v_days := 7;
    when 'featured_14d' then v_days := 14;
    when 'ai_30d'       then v_days := 30;
    else raise exception 'unknown featured tier: %', p_tier;
  end case;

  if p_stripe_payment_intent is null or length(trim(p_stripe_payment_intent)) = 0 then
    raise exception 'a stripe payment intent is required';
  end if;

  if not exists (select 1 from public.employer_organizations where id = p_org_id) then
    raise exception 'employer organization not found';
  end if;

  -- Ownership gate: the job being featured must belong to the paying org.
  if not exists (
    select 1 from public.employer_jobs
    where id = p_job_id and org_id = p_org_id
  ) then
    raise exception 'featured job not found in this organization';
  end if;

  v_expires_at := now() + make_interval(days => v_days);

  -- Idempotent creation keyed on the money-verified payment intent: a replayed
  -- event (Redelivery or a duplicate checkout.session.completed) returns the
  -- original listing instead of creating a second row.
  insert into public.featured_listings (
    org_id, job_id, tier, starts_at, expires_at, is_active, stripe_payment_intent
  )
  values (p_org_id, p_job_id, p_tier, now(), v_expires_at, true, p_stripe_payment_intent)
  on conflict (stripe_payment_intent) do nothing;

  select fl.id, fl.expires_at
    into v_listing_id, v_expires_at
  from public.featured_listings fl
  where fl.stripe_payment_intent = p_stripe_payment_intent;

  return query select v_listing_id, v_expires_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_create_featured_listing(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_create_featured_listing(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_create_featured_listing(uuid, uuid, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_create_featured_listing(uuid, uuid, text, text) TO postgres, service_role;