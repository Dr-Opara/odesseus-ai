-- Immutable application snapshot completeness (Phase 2H). Additive
-- migration; local stack. Nothing historical is rewritten.
--
-- applications already snapshotted the job and resume at submission time
-- (freeze_application_context, baseline) and the Match Score
-- (match_score_snapshot). Two facts the spec requires were not yet stored on
-- the row itself, only reconstructable by an indirect join:
--
--   * Apply vs Smart Apply. The run's execution_mode decided the rate
--     charged (see odesseus_finalize_application), but nothing on the
--     applications row remembered which mode was actually used.
--   * The exact answers submitted. application_run_questions already holds
--     these permanently, but nothing tied a specific applications row back
--     to its run to find them.
--
-- Both are closed by widening odesseus_finalize_application (CREATE OR
-- REPLACE, same signature, same money-moving logic byte-for-byte) to also
-- stamp run_id, execution_mode, and a frozen answers_snapshot at the moment
-- an application is created or re-finalized. Historical applications rows
-- keep run_id/execution_mode/answers_snapshot null/empty — they are not
-- backfilled, because the run linkage for them was never captured and must
-- not be guessed.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.application_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_mode text,
  ADD COLUMN IF NOT EXISTS answers_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_execution_mode_check
  CHECK (execution_mode IS NULL OR execution_mode IN ('standard', 'smart'));

COMMENT ON COLUMN public.applications.execution_mode IS
  'Apply (standard) or Smart Apply (smart), frozen at submission time by odesseus_finalize_application. Null for applications created before this column existed.';
COMMENT ON COLUMN public.applications.answers_snapshot IS
  'The exact application_run_questions answers submitted with this application, frozen at finalization time. {} for applications created before this column existed.';

CREATE INDEX IF NOT EXISTS applications_run_id_idx ON public.applications (run_id) WHERE run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- odesseus_finalize_application: same signature, same idempotency/locking/
-- charging logic as 20260927000000_apply_mode_integrity.sql, with run_id,
-- execution_mode, and answers_snapshot now populated on both the insert and
-- the update path.
-- ---------------------------------------------------------------------------

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
  v_run             public.application_runs%rowtype;
  v_job             public.job_opportunities%rowtype;
  v_application_id  uuid;
  v_now             timestamptz := now();
  v_mode            text := lower(trim(p_mode));
  v_product_key     text;
  v_credit_type     text;
  v_rate_cents      integer;
  v_answers_snapshot jsonb;
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

  -- Frozen at finalization time: whatever the applicant actually answered
  -- for this run, permanently, regardless of later vault edits.
  select coalesce(jsonb_agg(jsonb_build_object(
           'field_key', q.field_key,
           'question_text', q.question_text,
           'category', q.category,
           'answer_text', q.answer_text,
           'answer_source', q.answer_source
         ) ORDER BY q.resolved_at NULLS LAST, q.created_at), '[]'::jsonb)
  into v_answers_snapshot
  from public.application_run_questions q
  where q.run_id = p_run_id;

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
        updated_at = v_now,
        run_id = p_run_id,
        execution_mode = v_mode,
        answers_snapshot = v_answers_snapshot
    where id = v_application_id;
  else
    insert into public.applications (
      user_id, job_id, tailored_resume_id, company_name, role_title,
      application_url, status, submission_confirmation, submitted_at, last_event_at,
      run_id, execution_mode, answers_snapshot
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
      v_now,
      p_run_id,
      v_mode,
      v_answers_snapshot
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

REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.odesseus_finalize_application(uuid, uuid, text, text, text) TO postgres, service_role;
