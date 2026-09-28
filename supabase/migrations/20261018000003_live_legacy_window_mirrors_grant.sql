-- The legacy Live window must not outlive a subscription that stopped granting.
--
-- The defect
-- ----------
-- credit_balances.live_unlimited_until is a mirror of a live_memberships period,
-- kept by the fulfillment trigger so the older activation path keeps honouring
-- members without a code change. odesseus_get_live_entitlement falls through to
-- it as its last branch, so it is a second, independent route to Live access.
--
-- odesseus_sync_live_membership extended that mirror on every sync:
--
--   live_unlimited_until = greatest(coalesce(live_unlimited_until, now()),
--                                   v_effective_end)
--
-- ...and only cleared it once the period had actually ended. So the mirror
-- tracked the period's end date and ignored the subscription's state entirely.
--
-- The membership branch of the entitlement check declines correctly -- it grants
-- only on active, trialing, or canceled -- but the check then falls through, and
-- the legacy branch finds the mirror still dated in the future and grants a
-- full fair-use window anyway. Reproduced directly: a monthly subscriber whose
-- invoice went unpaid resolved as source 'annual' with 20 sessions remaining, and
-- the same held for 'paused'. For 'paused' it never recovered, because every
-- subsequent sync extended the mirror again.
--
-- The customer-visible effect is that stopping payment does not stop Live, which
-- is the whole reason the state exists.
--
-- The fix
-- -------
-- Stop treating the mirror as a period end date and start treating it as what it
-- is: a reflection of whether the membership currently grants. It is extended
-- when the membership grants, and cleared when it does not, using the same three
-- statuses the entitlement function and the guest acceptance path already treat
-- as granting. That is the invariant -- the mirror can never disagree with the
-- thing it mirrors, so there is no second place for a status to be honoured.
--
-- This also covers 'past_due', which previously rode the same path. It is not in
-- the granting set, because the entitlement function does not grant on it, so a
-- mirror that granted on it would be exactly the disagreement being closed.
--
-- Symmetric: a subscription that starts paying again is extended again on the
-- next sync, and a lapsed period is still cleared. Nothing else about the
-- function changes -- the renewal path, the guest allocation reset, and the
-- capability filter above it are untouched.

BEGIN;

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
  v_grants_access boolean;
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
  -- catalog -- those were already copied onto the row at grant time.
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
  -- entitlements are marked expired (status bookkeeping -- what the cap
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

  -- credit_balances.live_unlimited_until mirrors whether this membership
  -- currently grants Live. It is extended only when the membership grants,
  -- and cleared when it does not or when the period has lapsed -- so the
  -- mirror can never be the reason somebody keeps access their subscription
  -- no longer pays for. The granting set is the same three statuses
  -- odesseus_get_live_entitlement and odesseus_accept_live_guest_invite use,
  -- which is what makes the two impossible to disagree.
  --
  -- The status read here is the one just written, not the one the row held a
  -- moment ago. v_membership was selected before the update, so on the very
  -- sync that moves a subscription out of a granting state it still reports the
  -- old value -- which is precisely the transition that has to clear the mirror.
  -- A subscription that starts paying again is extended again on its next sync,
  -- so this is reversible by the same mechanism that broke it.
  v_grants_access := (
    coalesce(p_status, v_membership.status) in ('active', 'trialing', 'canceled')
    and v_effective_end is not null
    and v_effective_end > now()
  );

  if v_grants_access then
    update public.credit_balances b
    set live_unlimited_until = greatest(coalesce(b.live_unlimited_until, now()),
                                         v_effective_end),
        updated_at = now()
    where b.user_id = v_membership.user_id;
  else
    update public.credit_balances b
    set live_unlimited_until = null, updated_at = now()
    where b.user_id = v_membership.user_id
      and b.live_unlimited_until is not null
      and b.live_unlimited_until > now();
  end if;

  return v_membership.id;
end;
$function$;

COMMENT ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text) IS
  'Applies a Stripe subscription lifecycle event to the Live membership: status, '
  'period, and the guest allocation reset on renewal. Also keeps '
  'credit_balances.live_unlimited_until in step, extending it only while the '
  'membership grants access and clearing it otherwise, so that legacy mirror can '
  'never be a second, independent route to a paid Live session.';

COMMIT;
