-- Teach the Live session lifecycle (Phase 7A's v2 pipeline — the one the
-- product actually calls) about Live memberships and guest entitlements.
-- Additive migration; local stack.
--
-- Split into its own file on purpose: a function body cannot reliably depend
-- on another function created earlier in the very same migration transaction
-- in every Postgres version, so the functions below (which call
-- odesseus_get_live_entitlement) run in a migration that applies strictly
-- after the one that (re)creates it.
--
-- odesseus_activate_live_session (no suffix, from the original baseline) is
-- deliberately left untouched here: nothing in src/ calls it any more —
-- src/app/api/interviews/[id]/live/activate/route.ts calls
-- odesseus_activate_live_session_v2 — so it is inert, not live, code. There
-- is nothing to teach it.
--
-- What changes in the v2 pipeline:
--
--   * odesseus_create_live_session and odesseus_activate_live_session_v2
--     each inlined their own copy of the entitlement-check logic (discrete
--     passes + legacy annual window), three times between them. All three
--     copies are replaced with a call to odesseus_get_live_entitlement,
--     which now also resolves memberships and guests — one authoritative
--     access decision instead of three duplicated, and now diverging,
--     ones.
--
--   * Guests gain access. Before this, a guest had no interview pass and no
--     live_unlimited_until, so activation fell through to the discrete-pass
--     branch and was rejected. Guests are now served by the owner's
--     membership fair-use window.
--
--   * The fair-use ceiling used during activation is no longer the literal
--     20-session check this pipeline previously hardcoded. It is whatever
--     odesseus_get_live_entitlement computed against the plan's own
--     fair_use_sessions / fair_use_window_days (copied from the catalog at
--     grant time for memberships; still 20/30 days for the legacy annual
--     window, exactly as before).
--
-- Invariants preserved from the existing v2 pipeline:
--   * Reconnecting to an already-active session is idempotent and returns
--     before any entitlement is re-examined.
--   * A session that lost its entitlement between "ready" and activation
--     (e.g. an annual window that expired, a membership that lapsed) is
--     moved to payment_required and the call raises.
--   * Time-boxed access (annual / membership / guest) does not spend a
--     discrete pass while its fair-use window has room; once that room is
--     gone, activation falls back to a discrete pass if one exists, or
--     fails closed if not.
--   * Pass consumption stays keyed on external_reference = 'live:'||session
--     id with ON CONFLICT DO NOTHING, so one session can never spend two
--     passes and a retried/duplicate activation call spends nothing further
--     (entitlement_consumed is reported false on that retry).

-- ---------------------------------------------------------------------------
-- 1. Session creation — reads entitlement, no longer inlines it
-- ---------------------------------------------------------------------------

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

  -- Check for an existing session for this interview (unique constraint on
  -- interview_id). v_session_exists is captured immediately: the entitlement
  -- lookup right after this also sets FOUND, which would otherwise clobber
  -- this check's result.
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
      v_ent.entitlement_type,
      v_ent.passes_remaining + case when v_session.status in ('active','completed') then 1 else 0 end,
      v_ent.passes_remaining,
      v_ent.unlimited_until;
    return;
  end if;

  if not v_ent.has_entitlement then
    -- No entitlement: create session in payment_required state.
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

  -- Has entitlement: create session in ready state.
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
    v_ent.entitlement_type,
    v_ent.passes_remaining,
    -- Creating a session never spends anything by itself — only activation
    -- does. Discrete passes show a predictive "after" of one fewer, matching
    -- the pre-membership behaviour; time-boxed access (annual / membership /
    -- guest) shows its fair-use headroom unchanged, since nothing is spent
    -- from a rolling window by merely reserving a session.
    case when v_ent.entitlement_type = 'passes' then v_ent.passes_remaining - 1 else v_ent.passes_remaining end,
    v_ent.unlimited_until;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Session activation — reads entitlement, no longer inlines it
-- ---------------------------------------------------------------------------

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
    -- Already active: idempotent return.
    select * into v_ent from public.odesseus_get_live_entitlement(p_user_id);
    return query select v_session, false, v_ent.entitlement_type, v_ent.passes_remaining;
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

  if not v_ent.has_entitlement then
    -- Lost entitlement since session creation (e.g. annual/membership expired).
    update public.live_interview_sessions
    set status = 'payment_required',
        error_message = 'Entitlement expired or exhausted',
        updated_at = v_now
    where id = p_session_id;

    raise exception 'no live entitlement available';
  end if;

  -- Transition to starting.
  update public.live_interview_sessions
  set status = 'starting',
      openai_session_id = p_openai_session_id,
      updated_at = v_now
  where id = p_session_id;

  -- Time-boxed access (annual / membership / guest) does not spend a
  -- discrete pass while the fair-use window still has room.
  -- passes_remaining here is the post-window headroom
  -- odesseus_get_live_entitlement already computed against the plan's own
  -- configured ceiling, so there is no second, possibly-inconsistent
  -- recompute of a hardcoded limit.
  if v_ent.entitlement_type in ('annual', 'membership', 'guest') and v_ent.passes_remaining > 0 then
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
    return query select v_session, false, v_ent.entitlement_type, v_ent.passes_remaining;
    return;
  end if;

  if v_ent.entitlement_type in ('annual', 'membership', 'guest') then
    -- Fair use exhausted: only a discrete pass can activate this session now.
    -- interview_passes is read independently here (not through
    -- odesseus_get_live_entitlement, which already committed to reporting
    -- the time-boxed entitlement as primary) so a member or guest who also
    -- holds a purchased pass is not incorrectly refused.
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

  -- Consume a discrete pass (entitlement_type = 'passes', or the fair-use
  -- fallback above).
  insert into public.credit_transactions (
    user_id,
    credit_type,
    delta,
    reason,
    external_reference,
    metadata
  )
  values (
    p_user_id,
    'interview',
    -1,
    'live_interview_started',
    'live:' || p_session_id::text,
    jsonb_build_object(
      'live_session_id', p_session_id,
      'interview_id', v_session.interview_id,
      'entitlement_type', v_ent.entitlement_type
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

  -- v_credit_txn_id is null exactly when the insert hit ON CONFLICT DO
  -- NOTHING — a duplicate/retried activation call that already spent its
  -- pass earlier. entitlement_consumed reports false so a caller (or a test)
  -- can tell "this call spent nothing" from "this call was the one that did".
  return query select v_session, (v_credit_txn_id is not null), v_ent.entitlement_type, v_ent.passes_remaining;
end;
$function$;
