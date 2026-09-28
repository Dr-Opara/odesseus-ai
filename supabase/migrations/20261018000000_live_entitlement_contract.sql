-- One authoritative Live entitlement contract.
-- Additive migration; local stack.
--
-- The problem this fixes
-- ---------------------
-- odesseus_get_live_entitlement is THE access decision for Odesseus Live. Its
-- resolution order is membership -> guest -> discrete pass -> legacy annual
-- window, and two downstream functions (odesseus_create_live_session and
-- odesseus_activate_live_session_v2) call it rather than re-deriving anything.
-- That part was already right.
--
-- What was wrong is the shape it returned. It answered with the superseded
-- Phase 7A names -- has_entitlement, entitlement_type, passes_remaining,
-- unlimited_until, fair_use_count, fair_use_reset -- which is twelve columns
-- describing a fair-use mechanism that no longer exists:
--
--   * fair_use_count / fair_use_reset described a rolling 30-day window
--     hardcoded in this function. The new architecture keeps the ceiling in
--     live_memberships.fair_use_sessions, copied from the catalog at grant time.
--     Those two columns were already stale relative to the number actually used
--     to compute passes_remaining three lines above them.
--   * unlimited_until conflated two different things: a membership's
--     current_period_end and the legacy credit_balances.live_unlimited_until.
--   * entitlement_type said WHAT KIND of access, which the callers then had to
--     map again onto a plan name. `source` plus `plan` is the same information
--     without the remapping.
--
-- The naming was not the only problem. The function was declared in
-- src/types/database.ts as `Record<string, unknown>`, so its shape was invisible
-- to the compiler, and each of the three callers re-declared the shape locally.
-- That is three declarations of one contract, which is precisely the drift this
-- contract exists to prevent. The generated type is now the whole declaration
-- and the local copies are gone.
--
-- The new contract, exactly ten columns:
--   has_access             boolean   -- may start a Live session now
--   source                 text      -- 'membership' | 'guest' | 'passes'
--                                       | 'annual' | 'none'
--   plan                   text      -- 'monthly' | 'personal_annual'
--                                       | 'share_annual' when source is
--                                       'membership'; 'guest' when the caller
--                                       is an activated guest; null otherwise
--   sessions_remaining     integer   -- uniformly meaningful: passes left, or
--                                       fair-use headroom for a time-boxed plan
--   period_end             timestamptz -- when time-boxed access runs out; null
--                                       for discrete passes
--   is_owner / is_guest    boolean
--   membership_id          uuid
--   guest_limit            integer
--   activated_guest_count  integer
--
-- Resolution order, `sessions_remaining` semantics, and the cancelled-but-in-
-- period rule are all unchanged from 20261016000000. This migration renames and
-- re-frames; it does not re-decide. Every behavioural test in
-- supabase/tests/live-guests.test.sql exercises the new shape.
--
-- Why DROP rather than CREATE OR REPLACE
-- --------------------------------------
-- PostgreSQL refuses to rename an OUT parameter on CREATE OR REPLACE
-- ("cannot change name of input parameter"). The function is only reached
-- through service_role, its whole body is restated below, and the two callers
-- are replaced in the same transaction, so there is no window in which anything
-- observes the intermediate state.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The fair-use ceiling, read from the catalog rather than a literal
-- ---------------------------------------------------------------------------
--
-- Every Live plan carries fair_use_sessions / fair_use_window_days in
-- pricing_products.metadata, and a membership copies them onto its own row at
-- grant time. The legacy annual window has no membership row, so it needs its
-- own read of the catalog.
--
-- The retired live product is given the same two keys here. That is additive: it
-- is a jsonb || concat, so nothing about the product's price, activation, or
-- entitlement wording changes. It exists so the fallback below never has to
-- carry a policy of its own.
--
-- The only literal left anywhere is the 30-day window length, and it is not a
-- grant: sessions is the number that decides whether anybody gets a session, and
-- it falls back to 0. A missing ceiling therefore fails closed, which is the
-- right direction for a paid session. The window only has to be *some* recent
-- slice for that 0 to be computed against.

UPDATE public.pricing_products
SET metadata = metadata || jsonb_build_object(
      'fair_use_sessions', 20,
      'fair_use_window_days', 30
    ),
    updated_at = now()
WHERE product_key = 'candidate_live_annual'
  AND NOT (metadata ? 'fair_use_sessions');

CREATE OR REPLACE FUNCTION odesseus_private.live_fair_use_config ()
RETURNS TABLE (sessions integer, window_days integer)
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
  select
    coalesce(
      (select (p.metadata->>'fair_use_sessions')::int
         from public.pricing_products p
        where p.metadata ? 'fair_use_sessions'
        order by (p.product_key = 'candidate_live_annual') desc
        limit 1),
      0),
    coalesce(
      (select (p.metadata->>'fair_use_window_days')::int
         from public.pricing_products p
        where p.metadata ? 'fair_use_window_days'
        order by (p.product_key = 'candidate_live_annual') desc
        limit 1),
      30);
$function$;

-- ---------------------------------------------------------------------------
-- 2. The entitlement contract
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.odesseus_get_live_entitlement(uuid);

CREATE FUNCTION public.odesseus_get_live_entitlement (
  p_user_id uuid,
  OUT has_access boolean,
  OUT source text,
  OUT plan text,
  OUT sessions_remaining integer,
  OUT period_end timestamptz,
  OUT is_owner boolean,
  OUT is_guest boolean,
  OUT membership_id uuid,
  OUT guest_limit integer,
  OUT activated_guest_count integer
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
AS $function$
declare
  v_balances public.credit_balances%rowtype;
  v_now timestamptz := now();
  v_membership public.live_memberships%rowtype;
  v_guest public.live_guest_entitlements%rowtype;
  v_owner_membership public.live_memberships%rowtype;
  -- Plain scalars rather than `live_fair_use_config%rowtype`: naming a
  -- function's return type with %rowtype registers a hard dependency on it, and
  -- this function would then be undroppable for as long as the config helper
  -- exists.
  v_fair_sessions integer;
  v_fair_window_days integer;
  v_recent integer;
begin
  is_owner := false;
  is_guest := false;
  membership_id := null;
  guest_limit := 0;
  activated_guest_count := 0;
  plan := null;

  -- 1. Owner membership (monthly / personal annual / share annual).
  --
  -- 'canceled' still grants while current_period_end is in the future: a
  -- customer who cancels at period end has paid through that date, and losing
  -- access the moment they click cancel would be taking a paid period back.
  -- unpaid / incomplete / paused and any lapsed period grant nothing.
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

    has_access := true;
    source := 'membership';
    plan := v_membership.plan_type;
    -- The ceiling is the plan's own configured fair_use_sessions, not a literal
    -- 20. That is the whole point of copying it onto the row at grant time.
    sessions_remaining := greatest(v_membership.fair_use_sessions - v_recent, 0);
    period_end := v_membership.current_period_end;
    is_owner := (v_membership.plan_type = 'share_annual');
    membership_id := v_membership.id;
    guest_limit := v_membership.guest_limit;
    activated_guest_count := v_membership.guest_count;
    return;
  end if;

  -- 2. Guest access. Resolved against the OWNER's membership so the guest
  -- inherits the owner's fair-use window. The guest never reads the owner's row
  -- directly -- this function is the only thing that crosses that boundary.
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
      -- The guest draws on the OWNER's fair-use window, so the ceiling is the
      -- owner's own configured one. The catalog helper is only the fallback for
      -- a membership row whose metadata was never copied, which is a state the
      -- grant path cannot produce -- so this is a safety net, not a policy.
      select f.sessions, f.window_days
      into v_fair_sessions, v_fair_window_days
      from odesseus_private.live_fair_use_config() f;

      select count(*)::int into v_recent
      from public.live_interview_sessions s
      where s.user_id = p_user_id
        and s.activated_at is not null
        and s.activated_at >= v_now
              - make_interval(days => coalesce(v_owner_membership.fair_use_window_days, v_fair_window_days));

      has_access := true;
      source := 'guest';
      plan := 'guest';
      sessions_remaining := greatest(
        coalesce(v_owner_membership.fair_use_sessions, v_fair_sessions) - v_recent, 0);
      -- The guest's own snapshotted period, not the owner's current one, so a
      -- renewal does not cut off a guest whose own entitlement has not ended.
      period_end := v_guest.membership_period_end;
      is_guest := true;
      membership_id := v_guest.membership_id;
      return;
    end if;
  end if;

  -- 3. The legacy annual window, then discrete passes, then nothing.
  select * into v_balances from public.credit_balances where user_id = p_user_id;

  if not found then
    has_access := false;
    source := 'none';
    sessions_remaining := 0;
    return;
  end if;

  if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
    -- The legacy window is time-boxed but still metered: 20 activations per
    -- rolling 30 days, the policy this product has always had. That ceiling now
    -- comes from the catalog rather than a literal in the activation function.
    select f.sessions, f.window_days
    into v_fair_sessions, v_fair_window_days
    from odesseus_private.live_fair_use_config() f;

    select count(*)::int into v_recent
    from public.live_interview_sessions s
    where s.user_id = p_user_id
      and s.activated_at is not null
      and s.activated_at >= v_now - make_interval(days => v_fair_window_days);

    has_access := true;
    source := 'annual';
    -- Reported as the headroom the configured ceiling still allows, exactly as
    -- the membership branch does. This is a behavioural fix, not only a rename:
    -- the superseded contract reported 0 here, and
    -- odesseus_activate_live_session_v2 gates time-boxed access on
    -- `source in ('annual','membership','guest') and sessions_remaining > 0`,
    -- so a 0 refused every legacy annual holder outright with
    -- "fair use limit reached and no interview passes available" no matter how
    -- little they had used. An exhausted window still reports 0, which sends
    -- activation to the discrete-pass fallback exactly as intended.
    sessions_remaining := greatest(v_fair_sessions - v_recent, 0);
    period_end := v_balances.live_unlimited_until;
    return;
  end if;

  if v_balances.interview_passes > 0 then
    has_access := true;
    source := 'passes';
    sessions_remaining := v_balances.interview_passes;
    period_end := null;
    return;
  end if;

  has_access := false;
  source := 'none';
  sessions_remaining := 0;
  period_end := null;
end;
$function$;

-- Service role only. Revoked from PUBLIC as well as the browser roles, because
-- the result reveals another user's membership and guest relationships, and
-- this is the only function that can read across that boundary.
REVOKE ALL ON FUNCTION public.odesseus_get_live_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_get_live_entitlement(uuid) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Its two callers, reading the new names
-- ---------------------------------------------------------------------------
--
-- Only the record field references change. The return shape of these two
-- functions is a different contract -- it is what
-- src/app/api/interviews/[id]/live/activate/route.ts reads -- and is left
-- exactly as it was, so no route or frontend contract moves.

CREATE OR REPLACE FUNCTION public.odesseus_create_live_session (
  p_user_id        uuid,
  p_interview_id   uuid,
  p_capture_mode   text DEFAULT 'shared_audio',
  p_context_snapshot jsonb DEFAULT '{}'::jsonb
)
  RETURNS TABLE (
    session_id uuid,
    status text,
    entitlement_type text,
    passes_before integer,
    passes_after integer,
    unlimited_until timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_interview public.interviews%rowtype;
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
  v_application_id uuid;
  v_session_exists boolean;
  v_ent record;
begin
  select *
  into v_interview
  from public.interviews
  where id = p_interview_id
    and user_id = p_user_id;

  if not found then
    raise exception 'interview not found';
  end if;

  v_application_id := v_interview.application_id;

  -- v_session_exists is captured immediately: the entitlement lookup right
  -- after this also sets FOUND, which would otherwise clobber this check.
  select *
  into v_session
  from public.live_interview_sessions
  where interview_id = p_interview_id
    and user_id = p_user_id;
  v_session_exists := found;

  select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);

  if v_session_exists then
    return query select
      v_session.id,
      v_session.status,
      v_ent.source,
      v_ent.sessions_remaining + case when v_session.status in ('active','completed') then 1 else 0 end,
      v_ent.sessions_remaining,
      v_ent.period_end;
    return;
  end if;

  if not v_ent.has_access then
    insert into public.live_interview_sessions (
      interview_id, application_id, user_id,
      status, capture_mode, context_snapshot, created_at, updated_at
    )
    values (
      p_interview_id, v_application_id, p_user_id,
      'payment_required', p_capture_mode, p_context_snapshot, v_now, v_now
    )
    returning * into v_session;

    return query select
      v_session.id,
      v_session.status,
      'none',
      0,
      0,
      null::timestamptz;
    return;
  end if;

  insert into public.live_interview_sessions (
    interview_id, application_id, user_id,
    status, capture_mode, context_snapshot, created_at, updated_at
  )
  values (
    p_interview_id, v_application_id, p_user_id,
    'ready', p_capture_mode, p_context_snapshot, v_now, v_now
  )
  returning * into v_session;

  return query select
    v_session.id,
    v_session.status,
    v_ent.source,
    v_ent.sessions_remaining,
    -- Creating a session never spends anything by itself -- only activation
    -- does. Discrete passes show a predictive "after" of one fewer, matching
    -- the pre-membership behaviour; time-boxed access shows its fair-use
    -- headroom unchanged, since nothing is spent from a rolling window by
    -- merely reserving a session.
    case when v_ent.source = 'passes' then v_ent.sessions_remaining - 1
         else v_ent.sessions_remaining end,
    v_ent.period_end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.odesseus_activate_live_session_v2 (
  p_session_id        uuid,
  p_user_id           uuid,
  p_openai_session_id text
)
  RETURNS TABLE (
    session public.live_interview_sessions,
    entitlement_consumed boolean,
    entitlement_type text,
    passes_remaining integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_interview public.interviews%rowtype;
  v_now timestamptz := now();
  v_credit_txn_id uuid;
  v_ent record;
  v_discrete_passes integer;
begin
  -- Lock the session row.
  select *
  into v_session
  from public.live_interview_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'live session not found';
  end if;

  if v_session.status = 'active' then
    -- Already active: idempotent return, before any entitlement is re-examined.
    select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);
    return query select v_session, false, v_ent.source, v_ent.sessions_remaining;
    return;
  end if;

  if v_session.status not in ('ready', 'failed', 'recovering') then
    raise exception 'live session cannot be activated from status %', v_session.status;
  end if;

  select *
  into v_interview
  from public.interviews
  where id = v_session.interview_id
    and user_id = p_user_id;

  if not found then
    raise exception 'interview not found';
  end if;

  select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);

  if not v_ent.has_access then
    -- Lost entitlement since session creation (e.g. annual/membership expired).
    update public.live_interview_sessions
    set status = 'payment_required',
        error_message = 'Entitlement expired or exhausted',
        updated_at = v_now
    where id = p_session_id;

    raise exception 'no live entitlement available';
  end if;

  update public.live_interview_sessions
  set status = 'starting',
      openai_session_id = p_openai_session_id,
      updated_at = v_now
  where id = p_session_id;

  -- Time-boxed access does not spend a discrete pass while its fair-use window
  -- still has room. sessions_remaining here is the headroom
  -- odesseus_get_live_entitlement already computed against the plan's own
  -- configured ceiling, so there is no second, possibly-inconsistent recompute
  -- of a hardcoded limit.
  if v_ent.source in ('annual', 'membership', 'guest') and v_ent.sessions_remaining > 0 then
    update public.live_interview_sessions
    set status = 'active',
        activated_at = coalesce(activated_at, v_now),
        error_message = null,
        updated_at = v_now
    where id = p_session_id
    returning * into v_session;

    update public.interviews
    set status = 'live',
        live_pass_status = 'consumed',
        started_at = coalesce(started_at, v_now),
        updated_at = v_now
    where id = v_interview.id
      and user_id = p_user_id;

    select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);
    return query select v_session, false, v_ent.source, v_ent.sessions_remaining;
    return;
  end if;

  if v_ent.source in ('annual', 'membership', 'guest') then
    -- Fair use exhausted: only a discrete pass can activate this session now.
    -- interview_passes is read independently here (not through
    -- odesseus_get_live_entitlement, which already committed to reporting the
    -- time-boxed entitlement as primary) so a member or guest who also holds a
    -- purchased pass is not incorrectly refused.
    select coalesce(interview_passes, 0) into v_discrete_passes
    from public.credit_balances
    where user_id = p_user_id;

    if coalesce(v_discrete_passes, 0) <= 0 then
      update public.live_interview_sessions
      set status = 'failed',
          error_message = 'Fair use limit reached and no interview passes available',
          updated_at = v_now
      where id = p_session_id;

      raise exception 'fair use limit reached and no interview passes available';
    end if;
    -- Falls through to discrete-pass consumption below.
  end if;

  -- Consume a discrete pass (source = 'passes', or the fair-use fallback above).
  insert into public.credit_transactions (
    user_id, credit_type, delta, reason, external_reference, metadata
  )
  values (
    p_user_id, 'interview', -1, 'live_interview_started',
    'live:' || p_session_id::text,
    jsonb_build_object(
      'live_session_id', p_session_id,
      'interview_id', v_session.interview_id,
      'entitlement_type', v_ent.source
    )
  )
  on conflict (external_reference) do nothing
  returning id into v_credit_txn_id;

  update public.live_interview_sessions
  set status = 'active',
      openai_session_id = p_openai_session_id,
      activated_at = coalesce(activated_at, v_now),
      error_message = null,
      updated_at = v_now
  where id = p_session_id
  returning * into v_session;

  update public.interviews
  set status = 'live',
      live_pass_status = 'consumed',
      started_at = coalesce(started_at, v_now),
      updated_at = v_now
  where id = v_interview.id
    and user_id = p_user_id;

  select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);

  -- v_credit_txn_id is null exactly when the insert hit ON CONFLICT DO NOTHING:
  -- a duplicate/retried activation call that already spent its pass earlier.
  -- entitlement_consumed reports false so a caller can tell "this call spent
  -- nothing" from "this call was the one that did".
  return query select v_session, (v_credit_txn_id is not null), v_ent.source, v_ent.sessions_remaining;
end;
$function$;

COMMIT;
