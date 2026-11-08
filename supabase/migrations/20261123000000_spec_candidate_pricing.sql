-- Spec candidate pricing: application credits and Live passes.
--
-- Contract (supersedes docs/product/pricing-contract.md candidate section):
--   * $0.99 USD per verified successful application — 1 application credit.
--   * Credit packs: 25 = $20, 50 = $35, 100 = $59.
--   * Odesseus Live: $24.99 per interview, 3 passes = $59.99, Annual = $499
--     (12 months, fair use). No required subscription.
--   * Failed, unsupported, cancelled, closed-role or unconfirmed applications
--     consume nothing; a Live pass is consumed only on successful activation.
--
-- Every product and price used here already exists (seeded by
-- 20260923000000_localized_pricing_engine.sql with exactly these amounts and
-- deactivated by 20260924000000). Fulfillment needs no change:
--   * app_* SKUs   -> credit_type 'application', delta = pack size
--   * interview_1 / interview_3 -> credit_type 'interview', delta 1 / 3
--   * interview_annual -> the existing 12-month live_unlimited_until branch
-- all through odesseus_private.fulfill_billing_event's generic path.
--
-- Wallet: no longer sold. Existing balances stay spendable — finalization
-- spends an application credit first and falls back to a $0.99 wallet debit.
-- Legacy Live subscriptions (monthly / personal annual / share annual) are no
-- longer sold; existing members keep renewing and keep access.
--
-- Additive: nothing is deleted; no RLS changes.

-- 1. Catalog: reactivate the application-credit and candidate_live_* products
--    (deactivated by 20260924000000 / 20261016000000); retire wallet, apply-rate
--    and Live-subscription products from sale.
UPDATE public.pricing_products
SET active = true, updated_at = now()
WHERE product_key IN (
  'candidate_application_single',
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'candidate_live_single',
  'candidate_live_pack_3',
  'candidate_live_annual'
);
UPDATE public.pricing_prices
SET active = true, updated_at = now()
WHERE product_key IN (
  'candidate_application_single',
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'candidate_live_single',
  'candidate_live_pack_3',
  'candidate_live_annual'
);

UPDATE public.pricing_products
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_standard_apply',
  'candidate_smart_apply',
  'wallet_topup_10',
  'wallet_topup_20',
  'wallet_topup_50',
  'live_single',
  'live_monthly',
  'live_personal_annual',
  'live_share_annual'
);
UPDATE public.pricing_prices
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_standard_apply',
  'candidate_smart_apply',
  'wallet_topup_10',
  'wallet_topup_20',
  'wallet_topup_50',
  'live_single',
  'live_monthly',
  'live_personal_annual',
  'live_share_annual'
);

-- Pin the spec amounts (they already hold these values; this makes the
-- migration self-evidently correct and repairs any manual drift).
UPDATE public.pricing_prices AS p
SET amount_minor = v.amount_minor, updated_at = now()
FROM (VALUES
  ('candidate_application_single',     99),
  ('candidate_application_pack_25',  2000),
  ('candidate_application_pack_50',  3500),
  ('candidate_application_pack_100', 5900),
  ('candidate_live_single',          2499),
  ('candidate_live_pack_3',          5999),
  ('candidate_live_annual',         49900)
) AS v(product_key, amount_minor)
WHERE p.product_key = v.product_key
  AND p.market_key = 'USD_US';

-- 2. Finalization: spend 1 application credit per verified submission.
-- Signature and return shape are unchanged, so CREATE OR REPLACE is safe and
-- the existing grants carry over.
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
  v_credits         integer;
  v_charge          text;
begin
  if v_mode <> all (array['standard', 'smart']) then
    raise exception 'unknown execution mode: %', v_mode;
  end if;

  -- One price for every verified submission, whatever the mode: the single
  -- application credit ($0.99 USD reference). Apply and Smart Apply differ in
  -- automation depth, not in price.
  v_product_key := 'candidate_application_single';
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

  -- Per-application price from the reference catalog (single source of
  -- truth); fail closed when it is not for sale.
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

  -- Prepaid application credits are spent first: 1 credit = 1 verified
  -- submission. A candidate with no credits but a legacy wallet balance is
  -- debited the single-credit price from the wallet instead, so balances
  -- bought under the earlier wallet contract stay spendable.
  select coalesce(cb.application_credits, 0)
  into v_credits
  from public.credit_balances cb
  where cb.user_id = p_user_id
  for update;

  v_charge := case when coalesce(v_credits, 0) >= 1 then 'application_credit' else 'wallet' end;

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
    'charge', v_charge,
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

  -- Exactly one charge per run, idempotent via the unique external_reference.
  -- An insufficient balance raises in apply_credit_transaction and rolls back
  -- the entire transaction above — the application row included — so nothing
  -- is recorded until the verified submission is actually paid for.
  if v_charge = 'application_credit' then
    insert into public.credit_transactions (
      user_id, credit_type, delta, reason, amount_cents, external_reference, metadata
    )
    values (
      p_user_id,
      'application',
      -1,
      'successful_application',
      null,
      'application:' || p_run_id::text,
      jsonb_build_object(
        'application_run_id', p_run_id,
        'application_id', v_application_id,
        'job_id', v_run.job_id,
        'execution_mode', v_mode,
        'charge', v_charge
      )
    )
    on conflict (external_reference) do nothing;
  else
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
        'rate_cents', v_rate_cents,
        'charge', v_charge
      )
    )
    on conflict (external_reference) do nothing;
  end if;

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

  -- amount_debited_cents is the wallet money moved: 0 when a prepaid credit
  -- paid for the submission.
  return query select v_application_id, p_run_id, false,
    case when v_charge = 'wallet' then v_rate_cents else 0 end;
end;
$function$;
