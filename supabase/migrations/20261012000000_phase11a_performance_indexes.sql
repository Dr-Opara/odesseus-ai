-- Phase 11A: Query performance indexes and retry/recovery helpers
-- Additive migration; local stack.

-- ---------------------------------------------------------------------------
-- 1. Candidate query performance indexes
-- ---------------------------------------------------------------------------

-- Application history queries: user_id + created_at DESC (most recent first)
CREATE INDEX IF NOT EXISTS applications_user_created_idx
  ON public.applications (user_id, created_at DESC);

-- Application runs: user_id + created_at DESC + status
CREATE INDEX IF NOT EXISTS application_runs_user_created_status_idx
  ON public.application_runs (user_id, created_at DESC, status);

-- Wallet ledger: user_id + created_at DESC (pagination)
CREATE INDEX IF NOT EXISTS credit_transactions_user_created_idx
  ON public.credit_transactions (user_id, created_at DESC);

-- Job reports: user_id + created_at DESC
CREATE INDEX IF NOT EXISTS job_reports_user_created_idx
  ON public.job_reports (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Employer query performance indexes
-- ---------------------------------------------------------------------------

-- Employer applicants: currently applications table doesn't have org_id
-- This index will be created when org_id is added to applications in a future migration
-- CREATE INDEX IF NOT EXISTS applications_org_created_idx
--   ON public.applications (org_id, created_at DESC)
--   WHERE org_id IS NOT NULL;

-- Employer jobs: org_id + created_at DESC
CREATE INDEX IF NOT EXISTS employer_jobs_org_created_idx
  ON public.employer_jobs (org_id, created_at DESC);

-- Employer subscription sync: org_id + status
CREATE INDEX IF NOT EXISTS employer_subscriptions_org_status_idx
  ON public.employer_subscriptions (org_id, status);

-- Recruiter seat sync: org_id + updated_at
CREATE INDEX IF NOT EXISTS recruiter_seats_org_updated_idx
  ON public.recruiter_seats (org_id, updated_at DESC);

-- Featured listings: org_id + is_active + expires_at
CREATE INDEX IF NOT EXISTS featured_listings_org_active_expires_idx
  ON public.featured_listings (org_id, is_active, expires_at);

-- ---------------------------------------------------------------------------
-- 3. Admin query performance indexes
-- ---------------------------------------------------------------------------

-- Admin job reports queue: status + created_at (already exists from 20261007)
-- Admin wallet audit: subject_type + subject_id + created_at (already exists from 20261010)

-- ---------------------------------------------------------------------------
-- 4. Live session query performance
-- ---------------------------------------------------------------------------

-- Live session history: user_id + created_at DESC
CREATE INDEX IF NOT EXISTS live_interview_sessions_user_created_idx
  ON public.live_interview_sessions (user_id, created_at DESC);

-- Live session recover: user_id + status + activated_at
CREATE INDEX IF NOT EXISTS live_interview_sessions_user_status_activated_idx
  ON public.live_interview_sessions (user_id, status, activated_at DESC);

-- Live transcripts: session_id + occurred_at
CREATE INDEX IF NOT EXISTS live_transcript_items_session_occurred_idx
  ON public.live_transcript_items (session_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 5. Partner/Referral query performance
-- ---------------------------------------------------------------------------

-- Partner conversions: partner_id + qualified_at
CREATE INDEX IF NOT EXISTS partner_conversions_partner_qualified_idx
  ON public.partner_conversions (partner_id, qualified_at DESC);

-- Partner referrals: partner_id + created_at
CREATE INDEX IF NOT EXISTS partner_referrals_partner_created_idx
  ON public.partner_referrals (partner_id, created_at DESC);

-- Partner applications: status + created_at
CREATE INDEX IF NOT EXISTS partner_applications_status_created_idx
  ON public.partner_applications (status, created_at DESC);

-- Partner referrals: signup_user_id (for user->referral lookup)
CREATE INDEX IF NOT EXISTS partner_referrals_signup_user_idx
  ON public.partner_referrals (signup_user_id);

-- ---------------------------------------------------------------------------
-- 6. Webhook observability
-- ---------------------------------------------------------------------------

-- Webhook events: org_id + created_at
CREATE INDEX IF NOT EXISTS webhook_events_org_created_idx
  ON public.webhook_events (org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Additional query performance indexes (identified from code review)
-- ---------------------------------------------------------------------------

-- Application run events: run_id + event_type (for event sourcing queries)
CREATE INDEX IF NOT EXISTS application_run_events_run_type_idx
  ON public.application_run_events (run_id, event_type);

-- Application run questions: run_id + status (for fetching pending questions)
CREATE INDEX IF NOT EXISTS application_run_questions_run_status_idx
  ON public.application_run_questions (run_id, status);

-- Application answer vault: user_id + answer_key (for auto-fill lookups)
CREATE INDEX IF NOT EXISTS application_answer_vault_user_key_idx
  ON public.application_answer_vault (user_id, answer_key);

-- Interviews: user_id + status + created_at (for dashboard queries)
CREATE INDEX IF NOT EXISTS interviews_user_status_created_idx
  ON public.interviews (user_id, status, created_at DESC);

-- Interview readiness: interview_id + version_number (for latest briefing)
CREATE INDEX IF NOT EXISTS interview_readiness_interview_version_idx
  ON public.interview_readiness (interview_id, version_number DESC);

-- Interview round memory: application_id + round_number (for multi-round history)
CREATE INDEX IF NOT EXISTS interview_round_memory_app_round_idx
  ON public.interview_round_memory (application_id, round_number);

-- Post-interview analyses: interview_id + version_number (for versioning)
CREATE INDEX IF NOT EXISTS post_interview_analyses_interview_version_idx
  ON public.post_interview_analyses (interview_id, version_number);

-- Follow-up drafts: user_id + status + created_at (for draft management)
CREATE INDEX IF NOT EXISTS follow_up_drafts_user_status_created_idx
  ON public.follow_up_drafts (user_id, status, created_at DESC);

-- Notification preferences: user_id (for user preference lookups)
-- Already has primary key on user_id

-- Application status events: application_id + event_type (for status history)
CREATE INDEX IF NOT EXISTS application_status_events_app_type_idx
  ON public.application_status_events (application_id, event_type);

-- Billing events: user_id + sku + created_at (for purchase history)
CREATE INDEX IF NOT EXISTS billing_events_user_sku_created_idx
  ON public.billing_events (user_id, sku, created_at DESC);

-- Candidate job opportunities: status + created_at (for job discovery)
CREATE INDEX IF NOT EXISTS job_opportunities_status_created_idx
  ON public.job_opportunities (status, created_at DESC);

-- Partner campaigns: status + starts_at (for active campaign queries)
CREATE INDEX IF NOT EXISTS partner_campaigns_status_starts_idx
  ON public.partner_campaigns (status, starts_at);

-- Partner content: campaign_id + partner_id + status (for campaign management)
CREATE INDEX IF NOT EXISTS partner_content_campaign_partner_status_idx
  ON public.partner_content (campaign_id, partner_id, status);

-- Resume tailorings: user_id + job_id (for candidate history)
CREATE INDEX IF NOT EXISTS resume_tailorings_user_job_idx
  ON public.resume_tailorings (user_id, job_id);

-- Resumes: user_id + is_approved + created_at (for approved resume lookup)
CREATE INDEX IF NOT EXISTS resumes_user_approved_created_idx
  ON public.resumes (user_id, is_approved, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Retry/recovery: explicit idempotency keys for webhook processing
-- ---------------------------------------------------------------------------

-- The existing external_reference pattern on credit_transactions provides
-- idempotency for wallet operations. Add a similar pattern for webhook
-- processing where we don't already have one.

-- Add idempotency key to webhook_events for explicit deduplication
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_idempotency_key_idx
  ON public.webhook_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. Retry state tracking for background jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.retry_jobs (
  id                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  job_type            text                     NOT NULL,
  payload             jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key     text                     NOT NULL,
  status              text                     NOT NULL DEFAULT 'pending',
  attempts            smallint                 NOT NULL DEFAULT 0,
  max_attempts        smallint                 NOT NULL DEFAULT 3,
  last_error          text,
  next_retry_at       timestamp with time zone,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now(),
  completed_at        timestamp with time zone,
  CONSTRAINT retry_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT retry_jobs_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT retry_jobs_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead_letter')),
  CONSTRAINT retry_jobs_attempts_check CHECK (attempts >= 0 AND attempts <= max_attempts)
);

ALTER TABLE public.retry_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retry_jobs_deny_browser_access" ON public.retry_jobs
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.retry_jobs FROM anon, authenticated;
GRANT ALL ON TABLE public.retry_jobs TO postgres, service_role;

CREATE INDEX IF NOT EXISTS retry_jobs_status_next_retry_idx
  ON public.retry_jobs (status, next_retry_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS retry_jobs_job_type_status_idx
  ON public.retry_jobs (job_type, status);

COMMENT ON TABLE public.retry_jobs IS
  'Explicit retry queue for background jobs with idempotency keys. Ensures retries are idempotent and observable.';

-- ---------------------------------------------------------------------------
-- 9. Retry job processor RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_enqueue_retry_job (
  p_job_type        text,
  p_idempotency_key text,
  p_payload         jsonb DEFAULT '{}'::jsonb,
  p_max_attempts    smallint DEFAULT 3,
  p_delay_seconds   integer DEFAULT 60
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  insert into public.retry_jobs (job_type, payload, idempotency_key, max_attempts, next_retry_at)
  values (p_job_type, p_payload, p_idempotency_key, p_max_attempts, now() + (p_delay_seconds || ' seconds')::interval)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.retry_jobs where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_enqueue_retry_job(text, text, jsonb, smallint, integer) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 10. Retry job claim/process/complete RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_claim_retry_job (
  p_job_type text
)
  RETURNS SETOF public.retry_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  return query
  update public.retry_jobs
  set status = 'running',
      attempts = attempts + 1,
      updated_at = now()
  where id = (
    select id from public.retry_jobs
    where job_type = p_job_type
      and status = 'pending'
      and (next_retry_at is null or next_retry_at <= now())
      and attempts < max_attempts
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_claim_retry_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_claim_retry_job(text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_claim_retry_job(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_claim_retry_job(text) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.odesseus_complete_retry_job (
  p_job_id    uuid,
  p_outcome   text,
  p_error     text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
begin
  update public.retry_jobs
  set status = case
      when p_outcome = 'succeeded' then 'succeeded'
      when attempts >= max_attempts then 'dead_letter'
      else 'pending'
    end,
    last_error = case when p_error is not null then p_error else last_error end,
    next_retry_at = case
      when p_outcome = 'succeeded' then null
      when attempts >= max_attempts then null
      else now() + (least(attempts * 60, 3600) || ' seconds')::interval
    end,
    completed_at = case when p_outcome = 'succeeded' then now() else completed_at end,
    updated_at = now()
  where id = p_job_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.odesseus_complete_retry_job(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_complete_retry_job(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_complete_retry_job(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_complete_retry_job(uuid, text, text) TO postgres, service_role;