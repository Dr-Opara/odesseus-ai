-- Recruiter seat sync (M5). Additive migration; local stack.
--
-- The pricing contract (20260924000000) created public.recruiter_seats as an
-- org-scoped entitlement table but left fulfillment to the billing webhook.
-- This migration adds the webhook's service-role-only sync RPC:
--
--   public.odesseus_sync_recruiter_seat(
--     p_org_id, p_count, p_status, p_stripe_subscription_id,
--     p_stripe_customer_id, p_period_start, p_period_end)
--
-- It upserts one recruiter_seats row per Stripe subscription. Active/trialing
-- seats keep the paid count with an active_until derived from the paid period;
-- past_due keeps the count (the plan still owes seats) but marks the period
-- end; canceled/incomplete voids the entitlement (count 0, active_until now).
-- All validation fails closed so a malformed event can never inflate a seat
-- count. Pricing stays server-side: the webhook verifies the paid invoice
-- amount equals seat count x $20.00 before calling this RPC.
--
-- Invariants preserved: additive-only; recruiter_seats RLS/grants untouched
-- (still member-read / service-role-write); no changes to candidate wallet,
-- apply settlement, employer plan quotas, or Live pricing.

-- The Stripe customer id lands on the row so the seat entitlement is
-- auditable back to the billing customer (mirrors employer_subscriptions).
ALTER TABLE public.recruiter_seats
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- ---------------------------------------------------------------------------
-- 1. Recruiter seat sync (service role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_sync_recruiter_seat (
  p_org_id                 uuid,
  p_count                  integer,
  p_status                 text,
  p_stripe_subscription_id text,
  p_stripe_customer_id     text DEFAULT NULL,
  p_period_start           timestamptz DEFAULT NULL,
  p_period_end             timestamptz DEFAULT NULL
)
  RETURNS TABLE (
    seat_id      uuid,
    seat_count   integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_seat_id  uuid;
  v_count    integer;
  v_until    timestamptz;
begin
  if p_status not in ('active', 'past_due', 'canceled', 'trialing', 'incomplete') then
    raise exception 'unknown subscription status: %', p_status;
  end if;

  if not exists (select 1 from public.employer_organizations where id = p_org_id) then
    raise exception 'employer organization not found';
  end if;

  if p_stripe_subscription_id is null or length(trim(p_stripe_subscription_id)) = 0 then
    raise exception 'a stripe subscription id is required to sync';
  end if;

  -- Entitlement shape per status. Active/trialing seats carry the paid count;
  -- canceled/incomplete void the entitlement so lapsed seats never linger.
  -- active_until anchors to the paid period end, falling back to one month
  -- after the period start when a period end is not yet available.
  if p_status in ('active', 'trialing') then
    if p_count < 1 then
      raise exception 'recruiter seat count must be at least 1, got %', p_count;
    end if;
    v_count := p_count;
    v_until := coalesce(p_period_end, p_period_start + interval '1 month', now() + interval '1 month');
  elsif p_status = 'past_due' then
    v_count := greatest(p_count, 0);
    v_until := coalesce(p_period_end, p_period_start + interval '1 month', now() + interval '1 month');
  else
    v_count := 0;
    v_until := coalesce(p_period_end, now());
  end if;

  insert into public.recruiter_seats (
    org_id, count, active_until, stripe_subscription_id, stripe_customer_id
  )
  values (p_org_id, v_count, v_until, p_stripe_subscription_id, p_stripe_customer_id)
  on conflict (stripe_subscription_id) do update
    set count = excluded.count,
        active_until = excluded.active_until,
        stripe_customer_id = excluded.stripe_customer_id,
        updated_at = now()
  returning id into v_seat_id;

  return query select v_seat_id, v_count;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz) TO postgres, service_role;