-- Live session lifecycle functions (Phase 7A). Additive migration.
--
-- Depends on: 20261011000000_live_entitlement_helper.sql
--
-- This migration creates all session lifecycle functions with inlined
-- entitlement logic (to avoid cross-function dependency issues in the
-- same transaction).

-- ---------------------------------------------------------------------------
-- 1. Atomic session creation with entitlement check
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
  v_balances public.credit_balances%rowtype;
  v_fair_use_count integer;
  v_fair_use_reset timestamptz;
  v_has_entitlement boolean;
  v_entitlement_type text;
  v_passes_remaining integer;
  v_unlimited_until timestamptz;
begin
  -- Verify interview exists and belongs to user
  select *
  into v_interview
  from public.interviews
  where id = p_interview_id
    and user_id = p_user_id;

  if not found then
    raise exception 'interview not found';
  end if;

  v_application_id := v_interview.application_id;

  -- Check for existing session for this interview (unique constraint on interview_id)
  select *
  into v_session
  from public.live_interview_sessions
  where interview_id = p_interview_id
    and user_id = p_user_id;

  if found then
    -- Session already exists, return it with current entitlement
    -- Inline entitlement check
    select *
    into v_balances
    from public.credit_balances
    where user_id = p_user_id;

    if not found then
      v_has_entitlement := false;
      v_entitlement_type := 'none';
      v_passes_remaining := 0;
      v_unlimited_until := null;
      v_fair_use_count := 0;
      v_fair_use_reset := v_now;
    else
      v_fair_use_reset := v_now - interval '30 days';

      select count(*)
      into v_fair_use_count
      from public.live_interview_sessions lis
      where lis.user_id = p_user_id
        and lis.activated_at >= v_fair_use_reset
        and lis.status in ('active', 'completed');

      if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
        v_has_entitlement := true;
        v_entitlement_type := 'annual';
        v_passes_remaining := 0;
        v_unlimited_until := v_balances.live_unlimited_until;
      elsif v_balances.interview_passes > 0 then
        v_has_entitlement := true;
        v_entitlement_type := 'passes';
        v_passes_remaining := v_balances.interview_passes;
        v_unlimited_until := null;
      else
        v_has_entitlement := false;
        v_entitlement_type := 'none';
        v_passes_remaining := 0;
        v_unlimited_until := null;
      end if;
    end if;

    return query select
      v_session.id,
      v_session.status,
      v_entitlement_type,
      v_passes_remaining + case when v_session.status in ('active','completed') then 1 else 0 end,
      v_passes_remaining,
      v_unlimited_until;
    return;
  end if;

  -- Get current entitlement (inlined)
  select *
  into v_balances
  from public.credit_balances
  where user_id = p_user_id;

  if not found then
    v_has_entitlement := false;
    v_entitlement_type := 'none';
    v_passes_remaining := 0;
    v_unlimited_until := null;
    v_fair_use_count := 0;
    v_fair_use_reset := v_now;
  else
    v_fair_use_reset := v_now - interval '30 days';

    select count(*)
    into v_fair_use_count
    from public.live_interview_sessions lis
    where lis.user_id = p_user_id
      and lis.activated_at >= v_fair_use_reset
      and lis.status in ('active', 'completed');

    if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
      v_has_entitlement := true;
      v_entitlement_type := 'annual';
      v_passes_remaining := 0;
      v_unlimited_until := v_balances.live_unlimited_until;
    elsif v_balances.interview_passes > 0 then
      v_has_entitlement := true;
      v_entitlement_type := 'passes';
      v_passes_remaining := v_balances.interview_passes;
      v_unlimited_until := null;
    else
      v_has_entitlement := false;
      v_entitlement_type := 'none';
      v_passes_remaining := 0;
      v_unlimited_until := null;
    end if;
  end if;

  if not v_has_entitlement then
    -- No entitlement: create session in payment_required state
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

  -- Has entitlement: create session in ready state
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
    v_entitlement_type,
    v_passes_remaining,
    case when v_entitlement_type = 'passes' then v_passes_remaining - 1 else 0 end,
    v_unlimited_until;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_create_live_session(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_create_live_session(uuid, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_create_live_session(uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_create_live_session(uuid, uuid, text, jsonb) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Atomic session activation with entitlement consumption
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
  v_recent_activations integer;
  v_fair_use_reset timestamptz;
  v_fair_use_count integer;
  v_credit_txn_id uuid;
  v_balances public.credit_balances%rowtype;
  v_has_entitlement boolean;
  v_entitlement_type text;
  v_passes_remaining integer;
  v_unlimited_until timestamptz;
begin
  -- Lock the session row
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
    -- Already active: idempotent return
    select *
    into v_balances
    from public.credit_balances
    where user_id = p_user_id;

    if not found then
      v_has_entitlement := false;
      v_entitlement_type := 'none';
      v_passes_remaining := 0;
    else
      v_fair_use_reset := v_now - interval '30 days';

      select count(*)
      into v_fair_use_count
      from public.live_interview_sessions lis
      where lis.user_id = p_user_id
        and lis.activated_at >= v_fair_use_reset
        and lis.status in ('active', 'completed');

      if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
        v_has_entitlement := true;
        v_entitlement_type := 'annual';
        v_passes_remaining := 0;
      elsif v_balances.interview_passes > 0 then
        v_has_entitlement := true;
        v_entitlement_type := 'passes';
        v_passes_remaining := v_balances.interview_passes;
      else
        v_has_entitlement := false;
        v_entitlement_type := 'none';
        v_passes_remaining := 0;
      end if;
    end if;

    return query select
      v_session,
      false,
      v_entitlement_type,
      v_passes_remaining;
    return;
  end if;

  if v_session.status not in ('ready', 'failed', 'recovering') then
    raise exception 'live session cannot be activated from status %', v_session.status;
  end if;

  -- Get interview
  select *
  into v_interview
  from public.interviews
  where id = v_session.interview_id
    and user_id = p_user_id;

  if not found then
    raise exception 'interview not found';
  end if;

  -- Get current entitlement (inlined)
  select *
  into v_balances
  from public.credit_balances
  where user_id = p_user_id;

  if not found then
    v_has_entitlement := false;
    v_entitlement_type := 'none';
    v_passes_remaining := 0;
    v_unlimited_until := null;
  else
    v_fair_use_reset := v_now - interval '30 days';

    select count(*)
    into v_fair_use_count
    from public.live_interview_sessions lis
    where lis.user_id = p_user_id
      and lis.activated_at >= v_fair_use_reset
      and lis.status in ('active', 'completed');

    if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
      v_has_entitlement := true;
      v_entitlement_type := 'annual';
      v_passes_remaining := 0;
      v_unlimited_until := v_balances.live_unlimited_until;
    elsif v_balances.interview_passes > 0 then
      v_has_entitlement := true;
      v_entitlement_type := 'passes';
      v_passes_remaining := v_balances.interview_passes;
      v_unlimited_until := null;
    else
      v_has_entitlement := false;
      v_entitlement_type := 'none';
      v_passes_remaining := 0;
      v_unlimited_until := null;
    end if;
  end if;

  if not v_has_entitlement then
    -- Lost entitlement since session creation (e.g., annual expired)
    update public.live_interview_sessions
    set status = 'payment_required',
        error_message = 'Entitlement expired or exhausted',
        updated_at = v_now
    where id = p_session_id;

    raise exception 'no live entitlement available';
  end if;

  -- Transition to starting
  update public.live_interview_sessions
  set status = 'starting',
      openai_session_id = p_openai_session_id,
      updated_at = v_now
  where id = p_session_id;

  -- Consume entitlement based on type
  if v_entitlement_type = 'annual' then
    -- Check fair use
    v_fair_use_reset := v_now - interval '30 days';

    select count(*)
    into v_recent_activations
    from public.live_interview_sessions lis
    where lis.user_id = p_user_id
      and lis.activated_at >= v_fair_use_reset
      and lis.status in ('active', 'completed');

    if v_recent_activations >= 20 then
      -- Fair use exceeded: fall back to passes
      if v_passes_remaining > 0 then
        -- Will consume a pass below
      else
        -- No passes either: fail
        update public.live_interview_sessions
        set status = 'failed',
            error_message = 'Fair use limit reached and no interview passes available',
            updated_at = v_now
        where id = p_session_id;

        raise exception 'fair use limit reached and no interview passes available';
      end if;
    else
      -- Within fair use: mark as active without consuming a pass
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

      select *
      into v_balances
      from public.credit_balances
      where user_id = p_user_id;

      if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
        v_entitlement_type := 'annual';
        v_passes_remaining := 0;
      elsif v_balances.interview_passes > 0 then
        v_entitlement_type := 'passes';
        v_passes_remaining := v_balances.interview_passes;
      else
        v_entitlement_type := 'none';
        v_passes_remaining := 0;
      end if;

      return query select
        v_session,
        false, -- no discrete entitlement consumed
        v_entitlement_type,
        v_passes_remaining;
      return;
    end if;
  end if;

  -- Consume discrete pass (either from passes or annual fair-use fallback)
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
      'entitlement_type', v_entitlement_type
    )
  )
  on conflict (external_reference) do nothing
  returning id into v_credit_txn_id;

  if v_credit_txn_id is null then
    -- Already consumed (duplicate launch): this is idempotent
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

    select *
    into v_balances
    from public.credit_balances
    where user_id = p_user_id;

    if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
      v_entitlement_type := 'annual';
      v_passes_remaining := 0;
    elsif v_balances.interview_passes > 0 then
      v_entitlement_type := 'passes';
      v_passes_remaining := v_balances.interview_passes;
    else
      v_entitlement_type := 'none';
      v_passes_remaining := 0;
    end if;

    return query select
      v_session,
      false, -- was already consumed
      v_entitlement_type,
      v_passes_remaining;
    return;
  end if;

  -- Successfully consumed: activate session
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

  select *
  into v_balances
  from public.credit_balances
  where user_id = p_user_id;

  if v_balances.live_unlimited_until is not null and v_balances.live_unlimited_until > v_now then
    v_entitlement_type := 'annual';
    v_passes_remaining := 0;
  elsif v_balances.interview_passes > 0 then
    v_entitlement_type := 'passes';
    v_passes_remaining := v_balances.interview_passes;
  else
    v_entitlement_type := 'none';
    v_passes_remaining := 0;
  end if;

  return query select
    v_session,
    true,
    v_entitlement_type,
    v_passes_remaining;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_activate_live_session_v2(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_activate_live_session_v2(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_activate_live_session_v2(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_activate_live_session_v2(uuid, uuid, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Session recovery (reconnect after disconnect)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_recover_live_session (
  p_session_id        uuid,
  p_user_id           uuid,
  p_openai_session_id text
)
  RETURNS TABLE (
    session public.live_interview_sessions,
    recovered boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
begin
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
    return query select v_session, false;
    return;
  end if;

  if v_session.status not in ('recovering', 'failed') then
    raise exception 'live session cannot be recovered from status %', v_session.status;
  end if;

  -- Verify the session was previously active (has activated_at)
  if v_session.activated_at is null then
    raise exception 'cannot recover a session that was never activated';
  end if;

  update public.live_interview_sessions
  set status = 'active',
      openai_session_id = p_openai_session_id,
      error_message = null,
      updated_at = v_now
  where id = p_session_id
  returning * into v_session;

  update public.interviews
  set status = 'live',
      updated_at = v_now
  where id = v_session.interview_id
    and user_id = p_user_id;

  return query select v_session, true;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_recover_live_session(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_recover_live_session(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_recover_live_session(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_recover_live_session(uuid, uuid, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. Session completion (normal end)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_complete_live_session (
  p_session_id uuid,
  p_user_id    uuid
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_session
  from public.live_interview_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'live session not found';
  end if;

  if v_session.status = 'completed' then
    return v_session;
  end if;

  if v_session.status not in ('active', 'recovering') then
    raise exception 'live session cannot be completed from status %', v_session.status;
  end if;

  update public.live_interview_sessions
  set status = 'completed',
      ended_at = coalesce(ended_at, v_now),
      updated_at = v_now
  where id = p_session_id
  returning * into v_session;

  update public.interviews
  set status = 'completed',
      ended_at = coalesce(ended_at, v_now),
      updated_at = v_now
  where id = v_session.interview_id
    and user_id = p_user_id
    and status in ('live', 'ready', 'scheduled', 'invited');

  return v_session;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_complete_live_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_complete_live_session(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_complete_live_session(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_complete_live_session(uuid, uuid) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 5. Session failure (error during startup or runtime)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_fail_live_session (
  p_session_id    uuid,
  p_user_id       uuid,
  p_error_message text
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
  v_was_active boolean;
begin
  select *
  into v_session
  from public.live_interview_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'live session not found';
  end if;

  if v_session.status in ('completed', 'failed', 'expired') then
    return v_session;
  end if;

  v_was_active := (v_session.status = 'active' or v_session.status = 'recovering');

  update public.live_interview_sessions
  set status = 'failed',
      error_message = p_error_message,
      updated_at = v_now
  where id = p_session_id
  returning * into v_session;

  if v_was_active then
    update public.interviews
    set status = 'completed',
        ended_at = coalesce(ended_at, v_now),
        updated_at = v_now
    where id = v_session.interview_id
      and user_id = p_user_id
      and status in ('live', 'ready', 'scheduled', 'invited');
  else
    -- Was never activated: reset interview to ready/scheduled
    update public.interviews
    set status = 'ready',
        live_pass_status = 'available',
        updated_at = v_now
    where id = v_session.interview_id
      and user_id = p_user_id
      and status in ('live', 'ready', 'scheduled', 'invited');
  end if;

  return v_session;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_fail_live_session(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_fail_live_session(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_fail_live_session(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_fail_live_session(uuid, uuid, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 6. Session expiration (timeout before activation)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_expire_live_session (
  p_session_id uuid,
  p_user_id    uuid
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_session
  from public.live_interview_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'live session not found';
  end if;

  if v_session.status in ('completed', 'failed', 'expired') then
    return v_session;
  end if;

  if v_session.status in ('active', 'recovering') then
    raise exception 'cannot expire an active or recovering session';
  end if;

  update public.live_interview_sessions
  set status = 'expired',
      ended_at = v_now,
      updated_at = v_now
  where id = p_session_id
  returning * into v_session;

  update public.interviews
  set status = 'ready',
      live_pass_status = 'available',
      updated_at = v_now
  where id = v_session.interview_id
    and user_id = p_user_id
    and status in ('ready', 'scheduled', 'invited');

  return v_session;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_expire_live_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_expire_live_session(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_expire_live_session(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_expire_live_session(uuid, uuid) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 7. Audit trail for session state changes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_record_live_session_audit (
  p_session_id      uuid,
  p_user_id         uuid,
  p_from_status     text,
  p_to_status       text,
  p_entitlement_type text,
  p_passes_remaining integer,
  p_error_message   text DEFAULT NULL,
  p_details         jsonb DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  insert into public.admin_audit_log (
    actor_user_id, actor_email, actor_role,
    action, subject_type, subject_id, details
  )
  values (
    p_user_id, null, 'candidate',
    'live_session.' || p_to_status, 'live_session', p_session_id::text,
    jsonb_build_object(
      'from_status', p_from_status,
      'to_status', p_to_status,
      'entitlement_type', p_entitlement_type,
      'passes_remaining', p_passes_remaining,
      'error_message', p_error_message,
      'details', p_details
    )
  )
  returning id into v_id;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_record_live_session_audit(uuid, uuid, text, text, text, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_record_live_session_audit(uuid, uuid, text, text, text, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_record_live_session_audit(uuid, uuid, text, text, text, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_record_live_session_audit(uuid, uuid, text, text, text, integer, text, jsonb) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 8. Rate limiting: check if user has hit Live session limits
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_check_live_rate_limit (
  p_user_id uuid,
  p_window_minutes integer DEFAULT 60,
  p_max_sessions integer DEFAULT 3
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_count integer;
  v_cutoff timestamptz := now() - (p_window_minutes || ' minutes')::interval;
begin
  select count(*)
  into v_count
  from public.live_interview_sessions
  where user_id = p_user_id
    and created_at >= v_cutoff
    and status in ('active', 'completed', 'recovering');

  if v_count >= p_max_sessions then
    return false;
  end if;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_check_live_rate_limit(uuid, integer, integer) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 9. Cleanup old prepared/expired sessions (cron job)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_cleanup_stale_live_sessions (
  p_max_age_hours integer DEFAULT 24
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_cutoff timestamptz := now() - (p_max_age_hours || ' hours')::interval;
  v_updated integer;
begin
  update public.live_interview_sessions
  set status = 'expired',
      ended_at = now(),
      updated_at = now()
  where status in ('ready', 'starting', 'payment_required')
    and created_at < v_cutoff
    and (activated_at is null or activated_at < v_cutoff);

  get diagnostics v_updated = row_count;

  return v_updated;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_cleanup_stale_live_sessions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_cleanup_stale_live_sessions(integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_cleanup_stale_live_sessions(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_cleanup_stale_live_sessions(integer) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS policies for live tables (ensure applicant-only access)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "live_interview_sessions_own_select" ON public.live_interview_sessions;
CREATE POLICY "live_interview_sessions_own_select" ON public.live_interview_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "live_interview_sessions_own_insert" ON public.live_interview_sessions;
CREATE POLICY "live_interview_sessions_own_insert" ON public.live_interview_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "live_interview_sessions_own_update" ON public.live_interview_sessions;
CREATE POLICY "live_interview_sessions_own_update" ON public.live_interview_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "live_transcript_items_own_select" ON public.live_transcript_items;
CREATE POLICY "live_transcript_items_own_select" ON public.live_transcript_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "live_transcript_items_own_insert" ON public.live_transcript_items;
CREATE POLICY "live_transcript_items_own_insert" ON public.live_transcript_items
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "live_guidance_own_select" ON public.live_guidance;
CREATE POLICY "live_guidance_own_select" ON public.live_guidance
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 11. Index for common queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS live_interview_sessions_user_status_created_idx
  ON public.live_interview_sessions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS live_interview_sessions_interview_id_idx
  ON public.live_interview_sessions (interview_id);

CREATE INDEX IF NOT EXISTS live_transcript_items_session_occurred_idx
  ON public.live_transcript_items (session_id, occurred_at);