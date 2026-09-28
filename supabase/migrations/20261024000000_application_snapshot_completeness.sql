-- Immutable application snapshot, part two (Phase 2H). Additive; local
-- stack. Nothing historical is rewritten.
--
-- 20261022000000 already closed the two gaps that could only be reconstructed
-- by an indirect join (run_id, execution_mode, answers_snapshot). What it did
-- not close is the set of facts a later resume or job edit can invalidate, or
-- that currently live only on rows which stay mutable:
--
--   source resume          resume_snapshot records the SUBMITTED resume.
--                          resume_tailorings.source_resume_id records the
--                          resume the tailoring was derived from, but nothing
--                          on the application pinned it, so a later re-upload
--                          or re-tailor left no way to say what the candidate
--                          actually started from.
--   optimized version      the approved resume is one version of a tailoring
--                          series. The version number was not pinned, so
--                          "which optimized resume was submitted" was only
--                          answerable by inspecting a mutable tailoring row.
--   Application Agent      the decision that authorised an automatic apply is
--                          an append-only log keyed on job_id, not on the
--                          application. Nothing tied a specific submission
--                          back to the decision that produced it.
--   verification evidence  recorded on the run, which is mutable — a resume
--                          or a retry can rewrite submission_evidence. The
--                          application row itself must carry its own frozen
--                          copy, which is what
--                          applications.verification_evidence adds (column
--                          and write-once trigger in 20261023000000).
--
-- Two further changes make "exact submitted resume" verifiable rather than
-- merely recorded:
--
--   resumes.content_hash   a resume row stores a storage_path, not bytes. The
--                          path is written once (upsert: false, timestamped),
--                          so the file is not overwritten in practice — but
--                          nothing could *prove* the bytes behind a historical
--                          snapshot were the bytes that were submitted.
--   resume_snapshot gains  the hash is copied into the frozen snapshot by
--     content_hash         freeze_application_context, alongside
--                          size_bytes/mime_type, so a later integrity check
--                          can compare against the stored file.
--
-- Historical applications are NOT backfilled. For them the run linkage and
-- the tailoring were never captured, and guessing them would be worse than a
-- visible null.

-- ---------------------------------------------------------------------------
-- 1. resumes.content_hash
-- ---------------------------------------------------------------------------

ALTER TABLE public.resumes
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.resumes.content_hash IS
  'SHA-256 (hex) of the uploaded file bytes, computed at upload time. Null for rows uploaded before this column existed. Copied into applications.resume_snapshot at finalization so a historical submission can be verified against the stored file.';

-- ---------------------------------------------------------------------------
-- 2. The application-side snapshot columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS source_resume_id uuid REFERENCES public.resumes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tailoring_id uuid REFERENCES public.resume_tailorings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tailoring_version integer,
  ADD COLUMN IF NOT EXISTS agent_decision_id uuid REFERENCES public.application_agent_decisions(id) ON DELETE SET NULL;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_tailoring_version_check
  CHECK (tailoring_version IS NULL OR tailoring_version > 0);

COMMENT ON COLUMN public.applications.source_resume_id IS
  'The candidate''s own resume the submitted tailoring was derived from. Null for applications created before this column existed.';
COMMENT ON COLUMN public.applications.tailoring_id IS
  'The resume_tailorings row that produced the submitted resume. Null for applications created before this column existed.';
COMMENT ON COLUMN public.applications.tailoring_version IS
  'Version number of that tailoring at submission time, so the exact optimized resume version stays identifiable after later versions exist.';
COMMENT ON COLUMN public.applications.agent_decision_id IS
  'The Application Agent decision that authorised this submission, when the agent started the run. Null when a person started Apply directly, or for applications predating this column.';

CREATE INDEX IF NOT EXISTS applications_source_resume_id_idx
  ON public.applications (source_resume_id)
  WHERE source_resume_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. freeze_application_context: carry the content hash into the snapshot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION odesseus_private.freeze_application_context()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  job_row public.job_opportunities%rowtype;
  resume_row public.resumes%rowtype;
begin
  if new.job_id is not null then
    select * into job_row
    from public.job_opportunities
    where id = new.job_id;

    if found then
      if new.match_score_snapshot is null then
        new.match_score_snapshot := job_row.match_score;
      end if;

      if new.job_snapshot = '{}'::jsonb then
        new.job_snapshot := jsonb_build_object(
          'company_name', job_row.company_name,
          'role_title', job_row.role_title,
          'location', job_row.location,
          'work_arrangement', job_row.work_arrangement,
          'employment_type', job_row.employment_type,
          'salary_text', job_row.salary_text,
          'description', job_row.description,
          'match_score', job_row.match_score,
          'match_breakdown', job_row.match_breakdown,
          'source', job_row.source,
          'source_url', job_row.source_url,
          'external_id', job_row.external_id
        );
      end if;
    end if;
  end if;

  if new.tailored_resume_id is not null and new.resume_snapshot = '{}'::jsonb then
    select * into resume_row
    from public.resumes
    where id = new.tailored_resume_id;

    if found then
      new.resume_snapshot := jsonb_build_object(
        'resume_id', resume_row.id,
        'file_name', resume_row.file_name,
        'storage_path', resume_row.storage_path,
        'mime_type', resume_row.mime_type,
        'size_bytes', resume_row.size_bytes,
        'content_hash', resume_row.content_hash,
        'is_master', resume_row.is_master,
        'parsed_data', resume_row.parsed_data,
        'approved', resume_row.is_approved
      );
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. odesseus_finalize_application: pin the remaining facts at the instant the
--    application is created or re-finalized.
--
--    Same signature and same money-moving logic as 20261022000000. The rate is
--    still read from pricing_prices, the debit is still exactly one row keyed
--    on external_reference = 'application:' || run_id, and the 'submitted'
--    short-circuit still returns already_finalized with a 0 debit before any
--    other check — so a replay can never double-charge. What is new is that
--    the snapshot is complete and that the evidence bundle is copied onto the
--    immutable application row rather than left only on the run.
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
  v_tailoring       public.resume_tailorings%rowtype;
  v_agent_decision  uuid;
  v_evidence        jsonb;
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

  -- A run that has already ended for any reason other than success can never
  -- be settled. Charging a cancelled or failed run would be charging for an
  -- application the candidate stopped or that never verified.
  if v_run.status in ('failed', 'cancelled') then
    raise exception 'application run cannot be finalized from status %', v_run.status;
  end if;

  -- Every remaining status is one a live run can legitimately be paused in:
  -- queued/preflight (resumed mid-flight), running (a multi-page form mid
  -- pass), ready_to_submit (the approved submit), submitting (the click
  -- landed and we are reading the result), and needs_user (a pause the
  -- candidate has since resolved in the live browser and resumed). Anything
  -- outside that set is a caller bug, and a charge is refused rather than
  -- attempted.
  if v_run.status not in (
       'queued', 'preflight', 'running', 'needs_user', 'ready_to_submit', 'submitting'
     ) then
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

  -- The approved resume is one version of a tailoring series. Resolving the
  -- tailoring from the resume (rather than the reverse) keeps working even if
  -- the tailoring row is later re-pointed at a newer approved resume. The
  -- uuid is pattern-guarded because parsed_data is applicant-influenced JSON:
  -- a malformed tailoring_id must not be able to abort a settlement.
  select t.*
  into v_tailoring
  from public.resume_tailorings t
  where t.approved_resume_id = v_run.approved_resume_id
     or t.id in (
       select case
                when r.parsed_data ->> 'tailoring_id'
                     ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then (r.parsed_data ->> 'tailoring_id')::uuid
              end
       from public.resumes r
       where r.id = v_run.approved_resume_id
     )
  order by (t.approved_resume_id = v_run.approved_resume_id) desc nulls last,
           t.version_number desc
  limit 1;

  -- The most recent agent decision for this job that actually authorised an
  -- apply. Only decisions that could have started a run qualify, so a
  -- RULE_MISMATCH or AGENT_PAUSED log entry is never pinned as the
  -- authorisation for a submission it did not produce.
  select d.id
  into v_agent_decision
  from public.application_agent_decisions d
  where d.user_id = p_user_id
    and d.job_id = v_run.job_id
    and d.decision = 'AUTO_APPLY'
    and d.created_at <= v_now
  order by d.created_at desc
  limit 1;

  v_evidence := jsonb_build_object(
    'run_id', p_run_id,
    'confirmation_detected', true,
    'confirmation_text', p_confirmation_text,
    'after_url', p_page_url,
    'before_url', v_run.submission_evidence ->> 'before_url',
    'execution_mode', v_mode,
    'rate_cents', v_rate_cents,
    'verified_at', v_now
  );

  select id
  into v_application_id
  from public.applications
  where user_id = p_user_id
    and job_id = v_run.job_id
  limit 1;

  if v_application_id is not null then
    update public.applications
    set tailored_resume_id = v_run.approved_resume_id,
        source_resume_id = v_tailoring.source_resume_id,
        tailoring_id = v_tailoring.id,
        tailoring_version = v_tailoring.version_number,
        agent_decision_id = coalesce(v_agent_decision, agent_decision_id),
        application_url = v_run.target_url,
        status = 'applied',
        submission_confirmation = p_confirmation_text,
        submitted_at = v_now,
        last_event_at = v_now,
        updated_at = v_now,
        run_id = p_run_id,
        execution_mode = v_mode,
        answers_snapshot = v_answers_snapshot,
        verification_evidence = v_evidence
    where id = v_application_id;
  else
    insert into public.applications (
      user_id, job_id, tailored_resume_id, source_resume_id, tailoring_id,
      tailoring_version, agent_decision_id, company_name, role_title,
      application_url, status, submission_confirmation, submitted_at,
      last_event_at, run_id, execution_mode, answers_snapshot, verification_evidence
    )
    values (
      p_user_id,
      v_run.job_id,
      v_run.approved_resume_id,
      v_tailoring.source_resume_id,
      v_tailoring.id,
      v_tailoring.version_number,
      v_agent_decision,
      coalesce(v_job.company_name, 'Company'),
      coalesce(v_job.role_title, 'Role'),
      v_run.target_url,
      'applied',
      p_confirmation_text,
      v_now,
      v_now,
      p_run_id,
      v_mode,
      v_answers_snapshot,
      v_evidence
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
      'application_id', v_application_id,
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
      hold_category = null,
      submission_confirmation = p_confirmation_text,
      submission_evidence = v_evidence,
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
