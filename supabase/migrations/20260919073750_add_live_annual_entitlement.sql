-- Adds a genuine time-boxed entitlement for the Odysseus Live Annual plan
-- ($499/year, sku "interview_annual"), rather than approximating it with a
-- large finite credit grant. A user with an active entitlement activates
-- Live without consuming a discrete interview pass, subject to a fair-use
-- ceiling that bounds account sharing without blocking legitimate heavy use.
--
-- Design notes:
--   * billing_events.credit_type and credit_transactions.credit_type both
--     carry a CHECK constraint limited to ('application','interview'). To
--     avoid widening either constraint, the annual SKU keeps
--     credit_type = 'interview' (billingCatalog still needs a positive
--     creditDelta to satisfy billing_events_credit_delta_check, though that
--     delta is never applied to interview_passes for this SKU) and
--     fulfillment branches on sku = 'interview_annual' instead.
--   * Annual purchases do not insert a credit_transactions row, so they do
--     not appear in the user-facing "Recent activity" credit list (which
--     reads from credit_transactions only) — the permanent audit record is
--     the billing_events row itself (sku, amount_cents, created_at).
--   * Fair use: at most 20 Live activations per rolling 30-day window may
--     be covered by the unlimited entitlement. Beyond that ceiling in a
--     given window, activation falls back to consuming a normal interview
--     pass rather than being blocked outright.

ALTER TABLE public.credit_balances
  ADD COLUMN "live_unlimited_until" timestamptz;

CREATE OR REPLACE FUNCTION odysseus_private.fulfill_billing_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
begin
  if new.sku = 'interview_annual' then
    insert into public.credit_balances (user_id, application_credits, interview_passes, live_unlimited_until, updated_at)
    values (new.user_id, 0, 0, now() + interval '12 months', now())
    on conflict (user_id) do update
    set live_unlimited_until = greatest(coalesce(public.credit_balances.live_unlimited_until, now()), now()) + interval '12 months',
        updated_at = now();
  else
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

CREATE OR REPLACE FUNCTION public.odysseus_activate_live_session (
  p_session_id        uuid,
  p_user_id           uuid,
  p_openai_session_id text
)
  RETURNS public.live_interview_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odysseus_private', 'pg_temp'
  AS $function$
declare
  v_session public.live_interview_sessions%rowtype;
  v_now timestamptz := now();
  v_unlimited_until timestamptz;
  v_recent_activations integer;
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
    return v_session;
  end if;

  if v_session.status not in ('prepared','failed') then
    raise exception 'live session cannot be activated from status %', v_session.status;
  end if;

  select live_unlimited_until
  into v_unlimited_until
  from public.credit_balances
  where user_id = p_user_id;

  if v_unlimited_until is not null and v_unlimited_until > v_now then
    select count(*)
    into v_recent_activations
    from public.live_interview_sessions
    where user_id = p_user_id
      and activated_at >= v_now - interval '30 days';

    if v_recent_activations < 20 then
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
    end if;
  end if;

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
