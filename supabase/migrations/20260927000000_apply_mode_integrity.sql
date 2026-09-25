-- Apply execution-mode integrity (M3). Additive migration; local stack.
--
-- Completes the run state machine hardening begun in Phase 3:
--   1. odesseus_finalize_application() now refuses to finalize a run with a
--      requested mode that contradicts the run's committed execution_mode.
--      The run's column is the single source of truth for the rate charged,
--      so a caller can never turn a standard (49¢) run into a smart (199¢)
--      charge or vice versa. Submitted runs keep their idempotent replay
--      behavior (already_finalized, no charge) regardless of the mode passed,
--      so retries after a lost response never fail.
--   2. application_runs gains a CHECK that any run in the terminal 'submitted'
--      state carries verification evidence: submission_confirmation,
--      submitted_at, and finished_at must all be present. Both finalization
--      RPCs set these together, so the invariant is enforced at the storage
--      layer rather than only by application code.
--
-- Invariants preserved: migrations additive-only; RLS untouched; wallet
-- mutations server-side only; verified-success charging only; the legacy
-- 4-arg RPC remains byte-for-byte unchanged; Live pricing unchanged.

-- 1. Mode/rate integrity in the atomic finalization RPC --------------------

CREATE OR REPLACE FUNCTION public.odesseus_finalize_application (
  p_run_id            uuid,
  p_user_id           uuid,
  p_mode              text,
  p_confirmation_text text,
  p_page_url          text DEFAULT NULL
)
  RETURNS TABLE (
    application_id       uuid,
    run_id               uuid,
    already_finalized    boolean,
    amount_debited_cents integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_run          public.application_runs%rowtype;
  v_job          public.job_opportunities%rowtype;
  v_application_id uuid;
  v_now          timestamptz := now();
  v_mode         text := lower(trim(p_mode));
  v_product_key  text;
  v_credit_type  text;
  v_rate_cents   integer;
begin
  if v_mode <> all (array['standard', 'smart']) then
    raise exception 'unknown execution mode: %', v_mode;
  end if;

  v_product_key := case v_mode
    when 'smart' then 'candidate_smart_apply'
    else 'candidate_standard_apply'
  end;
  v_credit_type := case v_mode
    when 'smart' then 'smart_apply'
    else 'standard_apply'
  end;

  select *
  into v_run
  from public.application_runs
  where id = p_run_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'application run not found';
  end if;

  -- Idempotent replay: a verified run is never charged twice. This comes
  -- before the mode-mismatch guard so retries of an already-finalized run
  -- keep returning already_finalized (no charge) no matter what mode is
  -- passed — the mode that mattered was the one used for the first charge.
  if v_run.status = 'submitted' then
    select id
    into v_application_id
    from public.applications
    where user_id = p_user_id
      and job_id = v_run.job_id
    limit 1;

    return query select v_application_id, v_run.id, true, 0;
    return;
  end if;

  -- The run's committed execution_mode decides the rate that may be charged.
  -- A requested mode that contradicts it is a caller error: fail closed
  -- rather than debit at a rate the candidate did not negotiate for.
  if v_mode <> v_run.execution_mode then
    raise exception 'execution mode mismatch: run is % but requested %',
      v_run.execution_mode, v_mode;
  end if;

  if v_run.status in ('failed', 'cancelled') then
    raise exception 'application run cannot be finalized from status %', v_run.status;
  end if;

  if p_confirmation_text is null or length(trim(p_confirmation_text)) = 0 then
    raise exception 'a confirmed submission message is required to finalize';
  end if;

  -- Rate from the negotiated reference price (single source of truth);
  -- fail closed when the price for this mode is not for sale.
  select pr.amount_minor
  into v_rate_cents
  from public.pricing_prices pr
  join public.pricing_products pp on pp.product_key = pr.product_key
  where pr.product_key = v_product_key
    and pr.market_key = 'USD_US'
    and pr.active
    and pp.active;

  if v_rate_cents is null or v_rate_cents <= 0 then
    raise exception 'apply rate not configured for mode %', v_mode;
  end if;

  select *
  into v_job
  from public.job_opportunities
  where id = v_run.job_id;

  select id
  into v_application_id
  from public.applications
  where user_id = p_user_id
    and job_id = v_run.job_id
  limit 1;

  if v_application_id is not null then
    update public.applications
    set tailored_resume_id = v_run.approved_resume_id,
        application_url = v_run.target_url,
        status = 'applied',
        submission_confirmation = p_confirmation_text,
        submitted_at = v_now,
        last_event_at = v_now,
        updated_at = v_now
    where id = v_application_id;
  else
    insert into public.applications (
      user_id, job_id, tailored_resume_id, company_name, role_title,
      application_url, status, submission_confirmation, submitted_at, last_event_at
    )
    values (
      p_user_id,
      v_run.job_id,
      v_run.approved_resume_id,
      coalesce(v_job.company_name, 'Company'),
      coalesce(v_job.role_title, 'Role'),
      v_run.target_url,
      'applied',
      p_confirmation_text,
      v_now,
      v_now
    )
    returning id into v_application_id;
  end if;

  -- Exactly one wallet debit per run, idempotent via the unique
  -- external_reference. An insufficient wallet balance raises here and rolls
  -- back the entire transaction above — the application row included — so
  -- nothing is recorded until the verified submission is actually charged.
  insert into public.credit_transactions (
    user_id, credit_type, delta, reason, amount_cents, external_reference, metadata
  )
  values (
    p_user_id,
    v_credit_type,
    -v_rate_cents,
    'successful_application',
    v_rate_cents,
    'application:' || p_run_id::text,
    jsonb_build_object(
      'application_run_id', p_run_id,
      'job_id', v_run.job_id,
      'execution_mode', v_mode,
      'rate_cents', v_rate_cents
    )
  )
  on conflict (external_reference) do nothing;

  update public.job_opportunities
  set status = 'applied',
      updated_at = v_now
  where id = v_run.job_id;

  update public.application_runs
  set status = 'submitted',
      stop_reason = null,
      submission_confirmation = p_confirmation_text,
      submission_evidence = jsonb_build_object(
        'after_url', p_page_url,
        'confirmation_detected', true,
        'confirmation_text', p_confirmation_text,
        'execution_mode', v_mode,
        'rate_cents', v_rate_cents
      ),
      current_url = coalesce(p_page_url, v_run.current_url),
      submitted_at = v_now,
      finished_at = v_now,
      resume_token = null,
      updated_at = v_now
  where id = p_run_id;

  return query select v_application_id, p_run_id, false, v_rate_cents;
end;
$function$;

-- Browser users cannot invoke this: it moves money. Only the server (apply
-- runner through the service role) and the database owner may call it.
REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) TO postgres, service_role;

-- 2. Verified-success evidence is a storage invariant -----------------------

-- A run may only reach the terminal 'submitted' state with captured
-- verification: the confirmation text the candidate saw, plus the moment it
-- was recorded. Both finalization RPCs write these together atomically, so
-- this CHECK documents and enforces the contract at the storage layer.
ALTER TABLE public.application_runs
  ADD CONSTRAINT application_runs_submitted_requires_evidence
  CHECK (
    status <> 'submitted'
    OR (
      submission_confirmation IS NOT NULL
      AND submitted_at IS NOT NULL
      AND finished_at IS NOT NULL
    )
  );

COMMENT ON CONSTRAINT application_runs_submitted_requires_evidence ON public.application_runs IS
  'A run may only be submitted with captured verification (confirmation text + timestamps).';