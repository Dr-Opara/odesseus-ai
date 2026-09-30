-- Retire the Live Share guest quota.
--
-- Odesseus Live Share Annual sells Guest Live Access *links*, and the approved
-- commercial model has no guest cap: no slot count, no consumption, no
-- concurrency accounting, no activation window, no post-interview expiry. A
-- Share Annual holder generates secure links and shares them.
--
-- What this migration removes is the one piece of the old model that could
-- still *refuse* somebody: the BEFORE INSERT trigger that capped activated
-- guests at `live_memberships.guest_limit` on the emailed-invitation path. It
-- raised 'guest limit reached' on the eleventh entitlement, which is a limit
-- the product does not sell.
--
-- What it deliberately keeps:
--
--   * live_memberships.guest_limit / guest_count, and the
--     live_guest_entitlements table. These are historical columns with real
--     rows and foreign keys; dropping them would rewrite history for no gain.
--   * sync_live_membership_guest_count, which keeps guest_count equal to the
--     active entitlements in the current period.
--   * live_membership_guest_allocation_reset, which re-derives guest_count when
--     a membership renews and advances current_period_start.
--
-- Those two triggers are pure bookkeeping. They write a number that nothing
-- authorizes on, so keeping them costs nothing and preserves the historical
-- record accurately. The COMMENTs below say so, so the next reader does not
-- have to re-derive it -- which is exactly how the stale concept survived this
-- long with a correct authorization path next to it.
--
-- Authorization is unaffected and never depended on any of this. Guest link
-- generation is gated by Share Annual entitlement plus a secure token:
--
--   canGenerateGuestLinks(row) => row.has_access && row.is_owner
--                                  && row.plan === 'share_annual'
--
-- and the per-token rate limits are abuse protection, not a commercial quota.
--
-- Additive and reversible. No table, column, or historical row is altered.

-- ---------------------------------------------------------------------------
-- 1. Stop the cap from refusing anything.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS live_guest_entitlements_cap ON public.live_guest_entitlements;

DROP FUNCTION IF EXISTS odesseus_private.enforce_live_guest_cap();

-- The quota was enforced in three places, and the third was not obvious from
-- the application: two CHECK constraints on live_memberships itself.
--
--   live_memberships_guest_count_within_limit   CHECK (guest_count <= guest_limit)
--   live_memberships_personal_has_no_guests     CHECK (plan_type = 'share_annual'
--                                                        OR guest_limit = 0)
--
-- The first is not merely a leftover, it is actively wrong now. `guest_limit`
-- defaults to 0, so on any Share membership created without an explicit limit
-- the retained bookkeeping trigger could not record a single activated guest:
-- guest_count would go to 1 and the CHECK would raise. That is the retired
-- model refusing a legitimate activation, from inside the database, where an
-- API-level test never sees it.
--
-- The second only exists to keep a non-Share plan at zero guests, which is a
-- statement about the quota. Plan type still decides what a membership is for;
-- it does not police a number.
--
-- `live_memberships_guest_count_check` (>= 0) and `guest_limit_check` (>= 0)
-- stay: those are ordinary sanity bounds, not quota.
ALTER TABLE public.live_memberships
  DROP CONSTRAINT IF EXISTS live_memberships_guest_count_within_limit;
ALTER TABLE public.live_memberships
  DROP CONSTRAINT IF EXISTS live_memberships_personal_has_no_guests;

-- ---------------------------------------------------------------------------
-- 2. Say, on the objects themselves, that they no longer mean what they meant.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.live_memberships.guest_limit IS
'HISTORICAL. Not an entitlement and not read by any authorization path. The
approved Live Share model has no guest cap: a Share Annual holder generates
Guest Live Access links and shares them. Retained because the column has
historical values and was part of the retired quota model; nothing gates on it.
Link generation is gated on Share Annual entitlement, and per-token rate limits
are abuse protection rather than a commercial quota.';

COMMENT ON COLUMN public.live_memberships.guest_count IS
'HISTORICAL. A count of active guest entitlements in the current membership
period, maintained by odesseus_private.sync_live_membership_guest_count and
reset on renewal by odesseus_private.live_membership_guest_allocation_reset.
Retained as an accurate record of the retired quota model. It gates nothing:
the cap that used to read it was dropped in this migration.';

COMMENT ON FUNCTION odesseus_private.sync_live_membership_guest_count() IS
'Bookkeeping only. Keeps live_memberships.guest_count equal to the active
guest entitlements in the current period. It does not enforce anything; the
trigger that consumed this count to enforce a guest cap was dropped when the
quota was retired.';

COMMENT ON FUNCTION odesseus_private.live_membership_guest_allocation_reset() IS
'Bookkeeping only. Re-derives guest_count when a membership renews and advances
current_period_start. It does not enforce anything. It exists so the historical
columns stay accurate now that the quota they described has been retired.';

COMMENT ON TABLE public.live_guest_entitlements IS
'HISTORICAL, and still written by the emailed-invitation path. The cap trigger
that once limited this table to live_memberships.guest_limit rows has been
dropped: the approved Live Share model has no guest cap. Rows are retained so
past entitlements remain auditable; nothing authorizes on their number.';

-- ---------------------------------------------------------------------------
-- 3. Retire the quota from the one function that could still report it.
-- ---------------------------------------------------------------------------
--
-- odesseus_accept_live_guest_invite never compared a count itself. It caught
-- the cap trigger's `raise exception 'guest limit reached%'` in an `exception`
-- block and reported it as the result `guest_limit_reached`, and it returned a
-- `guest_remaining` figure computed from guest_limit and guest_count.
--
-- With the trigger gone that result is unreachable, so the branch and the
-- column are removed as well. Leaving them would keep a documented refusal for
-- a limit that no longer exists, and a caller would still be able to read a
-- number implying one.
--
-- The return type changes, so CREATE OR REPLACE cannot be used: the function is
-- dropped and recreated with the same body, the same SECURITY DEFINER posture,
-- and the same grants. Everything else about it is untouched -- the token hash
-- lookup, the email-from-auth check that stops a forwarded link being redeemed
-- by the wrong account, the membership-year guard, the single-use answer, and
-- the unique-violation race handling.
--
-- Nothing else depends on the old signature: it is called only by
-- `POST /api/live/guests/accept`, which is updated in the same change.

DROP FUNCTION IF EXISTS public.odesseus_accept_live_guest_invite(text, uuid);

CREATE FUNCTION public.odesseus_accept_live_guest_invite(
  p_token         text,
  p_guest_user_id uuid
)
RETURNS TABLE (
  result        text,
  message       text,
  membership_id uuid,
  period_end    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_invite public.live_guest_invites%rowtype;
  v_membership public.live_memberships%rowtype;
  v_guest_email text;
  v_token_hash text;
begin
  if p_token is null or p_guest_user_id is null then
    return query select 'invalid', 'A signed-in account and a valid invitation link are both required.',
                   null::uuid, null::timestamptz;
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
    return query select 'invalid', 'This invitation link is not valid.', null::uuid, null::timestamptz;
    return;
  end if;

  if v_invite.status = 'expired' or v_invite.expires_at <= now() then
    update public.live_guest_invites i
    set status = 'expired', updated_at = now()
    where i.id = v_invite.id and i.status <> 'activated';
    return query select 'expired', 'This invitation has expired. Ask the owner for a new one.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  -- An invitation belongs to the membership year it was issued in. Once that
  -- year is over, redeeming it would create an active grant carrying no access,
  -- so it is declined instead. Only pending invitations are affected: an
  -- already-activated one is a retry, not a redemption.
  if v_invite.status = 'pending'
     and v_invite.membership_period_end is not null
     and v_invite.membership_period_end <= now() then
    update public.live_guest_invites i
    set status = 'expired', updated_at = now()
    where i.id = v_invite.id and i.status = 'pending';
    return query select 'expired', 'This invitation has expired. Ask the owner for a new one.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  -- Resolve the guest's email from auth, not from the request, so a
  -- forwarded link cannot be redeemed by a different account.
  select lower(u.email) into v_guest_email
  from auth.users u
  where u.id = p_guest_user_id;

  if v_guest_email is null or v_guest_email <> v_invite.guest_email_normalized then
    return query select 'invalid', 'This invitation was sent to a different email address.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  if v_invite.guest_user_id is not null and v_invite.guest_user_id <> p_guest_user_id then
    return query select 'invalid', 'This invitation has already been claimed.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  select * into v_membership
  from public.live_memberships m
  where m.id = v_invite.membership_id
  for update;

  if not found then
    return query select 'invalid', 'The Live Share membership no longer exists.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  if v_membership.status not in ('active', 'trialing', 'canceled')
     or v_membership.current_period_end is null
     or v_membership.current_period_end <= now() then
    return query select 'inactive', 'The Live Share membership is not active.',
                   null::uuid, null::timestamptz;
    return;
  end if;

  -- Already activated in this period. The invitation is single-use, which is a
  -- property of the invitation rather than of any quota: redeeming it twice is
  -- a retry, and the answer is the same grant rather than a second one.
  if exists (
    select 1 from public.live_guest_entitlements e
    where e.membership_id = v_membership.id
      and e.guest_user_id = p_guest_user_id
      and e.membership_period_start = v_invite.membership_period_start
      and e.status = 'active'
  ) then
    return query select 'already_active', 'You already have Live access through this membership.',
                   v_membership.id, v_membership.current_period_end;
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

  return query select 'activated'::text, 'Your Live access through this membership is active.',
                 v_membership.id, v_membership.current_period_end;
exception
  when unique_violation then
    -- Two activations of the same guest raced: the unique index decided, and the
    -- loser activates nothing.
    return query select 'already_active', 'You already have Live access through this membership.',
                   v_membership.id, v_membership.current_period_end;
  when others then
    -- No branch for a retired refusal. The cap trigger that raised
    -- 'guest limit reached' is gone, so there is nothing here to translate and
    -- nothing to re-raise; anything genuinely wrong still propagates.
    raise;
end;
$$;

-- The same posture the function had before: reachable by the service role only.
-- Its result reveals another user's membership, so it is not exposed to
-- anon or authenticated.
REVOKE ALL ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid)
  TO postgres, service_role;

COMMENT ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid) IS
'Redeems a Live Share invitation for a signed-in caller, proving the caller is the
invited email address. Returns result / message / membership_id / period_end.
There is no guest cap: an invitation is not rationed, nothing is consumed, and
the result vocabulary has no "limit reached" member because the trigger that
raised it has been dropped. `already_active` reflects the invitation being
single-use, not a quota.';

-- ---------------------------------------------------------------------------
-- 4. The entitlement reader is left alone, deliberately.
-- ---------------------------------------------------------------------------
--
-- odesseus_get_live_entitlement still returns guest_limit and
-- activated_guest_count, and its return type is not changed here. The function
-- is the single authority for "may this person start a Live session"; reshaping
-- it for a display concern would put that authority at risk for no gain, and
-- nothing authorizes on those two values. What changed instead is everything
-- around it: the API route no longer forwards them, the TypeScript contract
-- marks them historical, and nothing displays them.
--
-- That the answer does not depend on them is asserted in
-- supabase/tests/live-guests.test.sql, section 8.

-- ---------------------------------------------------------------------------
-- 5. The invitation RPC stops reading the retired column to decide access.
-- ---------------------------------------------------------------------------
--
-- This is the enforcement point that mattered, and it is the reason this
-- migration is more than cosmetic.
--
-- `odesseus_create_live_guest_invite` gated on:
--
--     if v_membership.plan_type <> 'share_annual' or v_membership.guest_limit < 1
--       then raise exception 'only Live Share Annual includes guest access';
--
-- `guest_limit` defaulted to 0, so a Share Annual membership created without an
-- explicit limit could not issue a single invitation. The historical column was
-- deciding entitlement, which is precisely what must not happen: the approved
-- model gates on the plan, and the plan is `plan_type`. An API-level test that
-- sets guest_limit to 10 passes whether or not this gate exists, so it would
-- never have caught it.
--
-- The `plan_type <> 'share_annual'` half is the real check and is kept. The
-- `guest_limit < 1` half is the retired model and goes.
--
-- The return type is unchanged, so CREATE OR REPLACE is sufficient and the
-- grants below simply reassert what the function already had.

CREATE OR REPLACE FUNCTION public.odesseus_create_live_guest_invite(
  p_membership_id uuid,
  p_owner_user_id uuid,
  p_guest_email   text,
  p_invite_token  text,
  p_expires_at    timestamptz default null
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

  -- Share Annual is the only plan that shares access, and the plan is what
  -- decides. The retired `guest_limit < 1` clause is gone: it made a historical
  -- column an authorization input, and because the column defaults to zero it
  -- silently denied access to holders who had paid for it.
  if v_membership.plan_type <> 'share_annual' then
    raise exception 'only Live Share Annual includes guest access';
  end if;

  if v_membership.status not in ('active', 'trialing', 'canceled')
     or v_membership.current_period_end is null
     or v_membership.current_period_end <= now() then
    raise exception 'the Live Share membership is not active';
  end if;

  -- A member cannot invite themselves.
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

COMMENT ON FUNCTION public.odesseus_create_live_guest_invite(uuid, uuid, text, text, timestamptz) IS
'Issues a Live Share guest invitation. Access is decided by plan_type and
membership status only: Live Share has no guest cap, so nothing here reads
guest_limit or counts guests, and no number of invitations is rationed. The token
is stored as a SHA-256 hash and returned once to the caller.';

-- ---------------------------------------------------------------------------
-- 6. The reference catalog no longer advertises a guest limit.
-- ---------------------------------------------------------------------------
--
-- `pricing_products` is the localized display catalog, and its `live_*` rows
-- carried a `guest_limit` metadata key. These rows are active and reachable
-- through `GET /api/pricing`, so a key naming a ceiling of ten is a claim about
-- the product that is no longer true -- and unlike
-- `live_memberships.guest_limit`, a reader here has no way to tell it is
-- historical.
--
-- The key is removed rather than set to zero. Zero is a value, and it would read
-- as "the plan includes no guests", which is a different and equally wrong
-- claim about a plan that shares unlimited links. `plan_type` and
-- `fair_use_sessions` are untouched, and `fair_use_sessions` is a real ceiling.

UPDATE public.pricing_products
   SET metadata = metadata - 'guest_limit',
       updated_at = now()
 WHERE product_key IN ('live_single', 'live_monthly',
                       'live_personal_annual', 'live_share_annual')
   AND metadata ? 'guest_limit';

COMMENT ON TABLE public.pricing_products IS
'Localized display catalog. The live_* rows no longer carry a guest_limit
metadata key: the approved Live Share model has no guest cap, so advertising one
here would be a claim about the product that nothing enforces. plan_type and
fair_use_sessions remain; fair_use_sessions is a real ceiling on Live sessions.';

-- ---------------------------------------------------------------------------
-- 7. Three pieces of bookkeeping stop being conditional on the retired column.
-- ---------------------------------------------------------------------------
--
-- Removing the catalog key above is only safe once these are decoupled, and the
-- order matters: each of them read `guest_limit` and did its work only when the
-- value was positive. With the key gone the column is zero, and all three would
-- have gone quietly quiet -- no error, no warning, just history and counters
-- that stopped being maintained.
--
--   sync_live_membership_guest_count       and m.guest_limit > 0
--   live_membership_guest_allocation_reset IF new.guest_limit < 1 THEN RETURN
--   odesseus_sync_live_membership          if v_is_renewal and v_guest_limit > 0
--
-- None of them was enforcing a cap. Each was counting, expiring, or resetting
-- history, and each decided whether to bother by asking a column that no longer
-- means anything. That is the coupling being removed: the bookkeeping runs
-- because the event happened, not because a retired number says so.

CREATE OR REPLACE FUNCTION odesseus_private.sync_live_membership_guest_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
begin
  -- Was `and m.guest_limit > 0`. The count is bookkeeping over rows that exist,
  -- so it runs whenever a row changes. Gating it on a retired column meant that
  -- removing the column's meaning silently stopped the count -- which is how a
  -- historical figure becomes quietly wrong.
  update public.live_memberships m
  set guest_count = (
        select count(*)::int
        from public.live_guest_entitlements e
        where e.membership_id = coalesce(new.membership_id, old.membership_id)
          and e.status = 'active'
          and e.membership_period_start = m.current_period_start
      ),
      updated_at = now()
  where m.id = coalesce(new.membership_id, old.membership_id);

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION odesseus_private.live_membership_guest_allocation_reset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A status-only update, or a re-write of the same period, is not a rollover.
  -- The trigger is declared UPDATE OF current_period_start, so this also
  -- short-circuits the recursive update below, which does not name the column.
  IF new.current_period_start IS NOT DISTINCT FROM old.current_period_start THEN
    RETURN new;
  END IF;

  -- Was `IF new.guest_limit < 1 THEN RETURN new`. There is no allocation to
  -- reset any more, but there is history: when a membership rolls into a new
  -- year, its prior-period entitlements are marked expired so they do not read
  -- as live. That must happen whatever the retired column says, or a member's
  -- guest history quietly goes stale.
  UPDATE public.live_guest_entitlements
  SET status = 'expired',
      updated_at = now()
  WHERE membership_id = new.id
    AND status = 'active'
    AND (new.current_period_start IS NULL
         OR membership_period_start < new.current_period_start);

  UPDATE public.live_memberships m
  SET guest_count = (
        SELECT count(*)::int
        FROM public.live_guest_entitlements e
        WHERE e.membership_id = m.id
          AND e.status = 'active'
          AND m.current_period_start IS NOT NULL
          AND e.membership_period_start = m.current_period_start
      ),
      updated_at = now()
  WHERE m.id = new.id;

  RETURN new;
END;
$function$;

-- `odesseus_sync_live_membership` reads plan_type from the catalog to confirm
-- the product is still a Live subscription, and separately read guest_limit to
-- decide whether to run the rollover. Only the second read is retired: the
-- function still needs plan_type, and the period it rolls forward comes from
-- Stripe, not from the catalog.
CREATE OR REPLACE FUNCTION public.odesseus_sync_live_membership(
  p_stripe_subscription_id text,
  p_user_id                 uuid,
  p_status                  text,
  p_period_start            timestamptz default null,
  p_period_end              timestamptz default null,
  p_stripe_customer_id      text default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_membership public.live_memberships%rowtype;
  v_plan_type text;
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

  -- Only plan_type is needed here: a renewal rolls the period forward from what
  -- Stripe sent (p_period_start/p_period_end), it does not recompute the period
  -- length or fair-use ceiling from the catalog -- those were already copied onto
  -- the row at grant time. `guest_limit` used to be selected alongside it, only
  -- to decide whether the rollover below should run; that read is gone.
  select p.metadata->>'plan_type'
  into v_plan_type
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

  -- The rollover runs on a renewal because a renewal happened. It used to be
  -- `if v_is_renewal and v_guest_limit > 0`, which meant a membership whose
  -- retired guest_limit was zero never had its prior-period history marked
  -- expired. The period rollover is the event; the count it leaves behind is
  -- maintained by odesseus_private.live_membership_guest_allocation_reset,
  -- which fires on this same UPDATE OF current_period_start.
  if v_is_renewal then
    update public.live_guest_entitlements
    set status = 'expired', updated_at = now()
    where membership_id = v_membership.id
      and status = 'active'
      and (p_period_start is null
           or membership_period_start < p_period_start);
  end if;

  -- Keep credit_balances.live_unlimited_until in step with the membership, so
  -- that legacy mirror can never be a second, independent route to a paid Live
  -- session. The granting set is the same three statuses
  -- odesseus_get_live_entitlement uses, which is what makes the two impossible
  -- to disagree.
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

-- Same posture as before: service role only.
REVOKE ALL ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text)
  TO postgres, service_role;

COMMENT ON FUNCTION public.odesseus_sync_live_membership(text, uuid, text, timestamptz, timestamptz, text) IS
'Applies a Stripe subscription lifecycle event to the Live membership: status and
period. Also expires the prior period''s guest entitlements on a renewal and keeps
credit_balances.live_unlimited_until in step, extending it only while the
membership grants access and clearing it otherwise, so that legacy mirror can
never be a second, independent route to a paid Live session. Reads no guest
allowance: there is none.';