-- Teach the Live activation path about Live memberships and guest
-- entitlements. Additive migration; local stack.
--
-- Split into its own file on purpose: a function body cannot call another
-- function created in the same migration transaction, so the replacement of
-- odesseus_activate_live_session below has to run after — and separately
-- from — the migration that creates odesseus_get_live_entitlement.
--
-- What changes:
--
--   * The single authoritative access decision moves into
--     odesseus_get_live_entitlement (previous migration). This function no
--     longer re-derives entitlement rules of its own; it asks one question
--     and acts on the answer. Monthly, Personal Annual, Share Annual owners
--     and activated guests are all covered by that one check.
--
--   * Guests gain access. Before this, a guest had no interview pass and no
--     live_unlimited_until, so activation fell through to the discrete-pass
--     branch and was rejected by the credit guard. Guests are now served by
--     the owner's membership fair-use window.
--
--   * The fair-use ceiling is no longer a literal. It is read from
--     live_memberships.fair_use_sessions / fair_use_window_days, which are
--     copied from the catalog at grant time, so the ceiling is configured in
--     pricing_products.metadata rather than hardcoded here.
--
-- Invariants preserved — these are why the function is safe to re-run and why
-- a reconnect never double-charges:
--   * Reconnect is idempotent: an already-active session returns unchanged
--     before any entitlement is examined.
--   * Pass consumption stays keyed on external_reference = 'live:'||session
--     id with ON CONFLICT DO NOTHING, so one session can never spend two
--     passes and a retried activation spends nothing further.
--   * A Live pass is consumed only when a session actually starts, never at
--     preparation and never on a failed attempt that never activated.

CREATE OR REPLACE FUNCTION public.odesseus_activate_live_session (
  p_session_id        uuid,
  p_user_id           uuid,
  p_openai_session_id text
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
  v_entitlement record;
  v_consume_pass boolean := false;
begin
  select * into v_session
  from public.live_interview_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'live session not found';
  end if;

  -- Reconnect to a session that is already live. Returning here, before any
  -- entitlement is examined, is what makes reconnects free and idempotent.
  if v_session.status = 'active' then
    return v_session;
  end if;

  if v_session.status not in ('prepared', 'failed') then
    raise exception 'live session cannot be activated from status %', v_session.status;
  end if;

  -- One authoritative access check for every plan, pass and guest.
  select * into v_entitlement
  from public.odesseus_get_live_entitlement(p_user_id) e;

  if not found or not coalesce(v_entitlement.has_access, false) then
    raise exception 'insufficient live entitlement: no active Odesseus Live pass or membership';
  end if;

  -- Time-boxed access (membership, guest, legacy annual) does not spend a
  -- discrete pass while the fair-use window still has room. sessions_remaining
  -- is the post-window headroom, so 0 means the ceiling is reached.
  if v_entitlement.source = 'single_purchase' then
    v_consume_pass := true;
  elsif coalesce(v_entitlement.sessions_remaining, 0) <= 0 then
    raise exception 'insufficient live entitlement: the fair-use ceiling for this plan is reached';
  end if;

  if v_consume_pass then
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
        'interview_id', v_session.interview_id
      )
    )
    on conflict (external_reference) do nothing;
  end if;

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
  where id = v_session.interview_id
    and user_id = p_user_id;

  return v_session;
end;
$function$;

-- Guest sessions are attributed to the guest's own interview, application and
-- transcript rows, which are already auth.uid()-scoped. Nothing here widens
-- those policies, so a guest can never read the owner's workspace.
COMMENT ON FUNCTION public.odesseus_activate_live_session(uuid, uuid, text) IS
  'Activates a Live session for a user holding a current entitlement. Consumes at most one discrete interview pass, keyed on the session id so retries and reconnects never charge twice. Time-boxed memberships and guest entitlements are bounded by the fair-use ceiling stored on live_memberships.';
