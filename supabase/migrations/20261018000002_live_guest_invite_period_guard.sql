-- A Live Share invitation expires with the membership year it was issued in.
--
-- The gap
-- -------
-- odesseus_accept_live_guest_invite checks the *membership's* current period
-- before redeeming, and the invitation's own expires_at. It never checked
-- membership_period_end, the year the invitation was snapshotted against.
--
-- That matters after a renewal. A pending invitation issued in year 1 is still
-- redeemable in year 2, because the membership itself is active and the
-- invitation has not hit its own expiry. Redeeming it writes a
-- live_guest_entitlements row that:
--
--   * is not counted, because the maintained guest_count is scoped to
--     membership_period_start = the membership's *current* period and this row
--     carries last year's, so it consumes no slot and grants no access, and
--   * is nonetheless status 'active', so it shows the owner as a live guest who
--     has used none of a year they have not started.
--
-- It is not a cap bypass -- the row carries no access -- but it is a stale
-- active grant derived from a year that has closed, and the fix is to decline
-- the redemption instead of writing it.
--
-- The fix
-- -------
-- Decline a pending invitation whose snapshotted period has ended, reusing the
-- existing 'expired' result and its existing user-facing wording, which already
-- says "ask the owner for a new one" and is the correct advice.
--
-- Scoped to status = 'pending' on purpose. An invitation that was already
-- activated is not being redeemed, it is being retried, and a retried
-- acceptance must keep reporting already_active rather than start reporting
-- expired. Nothing else about the function changes.

BEGIN;

-- RETURNS TABLE, not OUT parameters: PostgreSQL treats the two as different
-- return types for CREATE OR REPLACE purposes, and the original definition
-- used RETURNS TABLE, so matching it is what makes this an in-place replacement.
CREATE OR REPLACE FUNCTION public.odesseus_accept_live_guest_invite(
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
SET search_path = public, pg_temp
AS $$
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

  -- An invitation belongs to the membership year it was issued in. Once that
  -- year is over, redeeming it would create an active grant carrying no access
  -- and no counted slot, so it is declined instead. Only pending invitations are
  -- affected: an already-activated one is a retry, not a redemption.
  if v_invite.status = 'pending'
     and v_invite.membership_period_end is not null
     and v_invite.membership_period_end <= now() then
    update public.live_guest_invites i
    set status = 'expired', updated_at = now()
    where i.id = v_invite.id and i.status = 'pending';
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
$$;

COMMENT ON FUNCTION public.odesseus_accept_live_guest_invite(text, uuid) IS
  'Redeem a Live Share invitation. Returns a result code rather than raising, '
  'so the API can answer the guest in their own words: activated, '
  'already_active, guest_limit_reached, expired, inactive, or invalid. A '
  'pending invitation is declined once the membership year it was issued in has '
  'ended; an already-activated one is answered as a retry.';

COMMIT;
