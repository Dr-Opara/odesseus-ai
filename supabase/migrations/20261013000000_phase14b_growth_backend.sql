-- Phase 14B: Growth Backend — Careers, Partners, Referrals, Analytics, Campaigns, Metrics
-- Additive migration; local stack.

-- ---------------------------------------------------------------------------
-- 1. Careers: Job Openings & Applications
-- ---------------------------------------------------------------------------

CREATE TABLE public.career_job_openings (
  id                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  title                text                     NOT NULL,
  department           text                     NOT NULL,
  location             text                     NOT NULL,
  work_type            text                     NOT NULL DEFAULT 'hybrid' CHECK (work_type IN ('remote', 'hybrid', 'onsite')),
  description_md       text                     NOT NULL,
  requirements_md      text,
  salary_min_cents     integer,
  salary_max_cents     integer,
  currency             text                     NOT NULL DEFAULT 'USD',
  status               text                     NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  posted_at            timestamptz,
  closed_at            timestamptz,
  created_by           uuid                     NOT NULL REFERENCES auth.users(id),
  created_at           timestamptz              NOT NULL DEFAULT now(),
  updated_at           timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT career_job_openings_pkey PRIMARY KEY (id)
);

ALTER TABLE public.career_job_openings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_job_openings_public_read" ON public.career_job_openings
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "career_job_openings_admin_write" ON public.career_job_openings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

CREATE INDEX career_job_openings_status_created_idx
  ON public.career_job_openings (status, created_at DESC);

CREATE TABLE public.career_applications (
  id                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  job_opening_id       uuid                     NOT NULL REFERENCES public.career_job_openings(id) ON DELETE CASCADE,
  full_name            text                     NOT NULL,
  email                text                     NOT NULL,
  phone                text,
  location             text,
  work_authorization   text,
  linkedin_url         text,
  github_url           text,
  portfolio_url        text,
  resume_url           text                     NOT NULL,
  cover_letter         text,
  status               text                     NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewing', 'interview', 'rejected', 'hired', 'withdrawn')),
  applied_at           timestamptz              NOT NULL DEFAULT now(),
  reviewed_at          timestamptz,
  reviewed_by          uuid REFERENCES auth.users(id),
  created_at           timestamptz              NOT NULL DEFAULT now(),
  updated_at           timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT career_applications_pkey PRIMARY KEY (id)
);

ALTER TABLE public.career_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_applications_insert_anon" ON public.career_applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "career_applications_own_read" ON public.career_applications
  FOR SELECT TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "career_applications_admin_all" ON public.career_applications
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

CREATE INDEX career_applications_job_status_idx
  ON public.career_applications (job_opening_id, status);

CREATE INDEX career_applications_email_idx
  ON public.career_applications (email);

-- ---------------------------------------------------------------------------
-- 2. Partner/Affiliate: Complete Partner Backend
-- ---------------------------------------------------------------------------

-- Partner applications already exist. Add referral_code generation on approval
-- and admin management APIs will reference this.

-- Add referral_code and approval tracking to partners table
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);

-- Partner referral codes are already in the table (referral_code column)

-- Partner conversions already track attribution. Add campaign_id if not present.
-- (campaign_id already exists in partner_conversions)

-- Partner earnings and payouts already exist.

-- ---------------------------------------------------------------------------
-- 3. Referral Attribution: Complete Attribution Logic
-- ---------------------------------------------------------------------------

-- The partner_referrals table tracks visitor_id and signup_user_id.
-- Add conversion tracking columns.
ALTER TABLE public.partner_referrals
  ADD COLUMN IF NOT EXISTS first_conversion_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_type text CHECK (conversion_type IN ('signup', 'wallet_topup', 'standard_apply', 'smart_apply', 'live_pass', 'employer_plan')),
  ADD COLUMN IF NOT EXISTS conversion_amount_cents integer;

-- Add unique constraint to prevent duplicate attribution per user per conversion type
CREATE UNIQUE INDEX IF NOT EXISTS partner_referrals_user_conversion_unique
  ON public.partner_referrals (signup_user_id, conversion_type)
  WHERE signup_user_id IS NOT NULL AND conversion_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Analytics/Conversion Events
-- ---------------------------------------------------------------------------

CREATE TABLE public.analytics_events (
  id                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  event_name           text                     NOT NULL,
  event_category       text                     NOT NULL CHECK (event_category IN ('public', 'candidate', 'employer', 'growth', 'partner')),
  user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id               uuid,
  session_id           uuid,
  anonymous_id         uuid,
  properties           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  source               text,
  campaign             text,
  referral_code        text,
  occurred_at          timestamptz              NOT NULL DEFAULT now(),
  received_at          timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_pkey PRIMARY KEY (id)
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_events_insert" ON public.analytics_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "analytics_events_admin_read" ON public.analytics_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

CREATE INDEX analytics_events_name_occurred_idx
  ON public.analytics_events (event_name, occurred_at DESC);

CREATE INDEX analytics_events_user_occurred_idx
  ON public.analytics_events (user_id, occurred_at DESC);

CREATE INDEX analytics_events_session_occurred_idx
  ON public.analytics_events (session_id, occurred_at DESC);

CREATE INDEX analytics_events_category_occurred_idx
  ON public.analytics_events (event_category, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5. First 100 Campaign
-- ---------------------------------------------------------------------------

CREATE TABLE public.first100_campaign (
  id                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  name                 text                     NOT NULL,
  description          text,
  max_enrollment       integer                  NOT NULL DEFAULT 100,
  current_enrollment   integer                  NOT NULL DEFAULT 0,
  starts_at            timestamptz              NOT NULL DEFAULT now(),
  ends_at              timestamptz,
  is_active            boolean                  NOT NULL DEFAULT true,
  benefit_description  text,
  created_at           timestamptz              NOT NULL DEFAULT now(),
  updated_at           timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT first100_campaign_pkey PRIMARY KEY (id)
);

ALTER TABLE public.first100_campaign ENABLE ROW LEVEL SECURITY;

CREATE POLICY "first100_campaign_public_read" ON public.first100_campaign
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "first100_campaign_admin_write" ON public.first100_campaign
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

CREATE TABLE public.first100_enrollments (
  id                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  campaign_id          uuid                     NOT NULL REFERENCES public.first100_campaign(id) ON DELETE CASCADE,
  user_id              uuid                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code        text,
  enrolled_at          timestamptz              NOT NULL DEFAULT now(),
  status               text                     NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT first100_enrollments_pkey PRIMARY KEY (id),
  CONSTRAINT first100_enrollments_user_campaign_unique UNIQUE (campaign_id, user_id)
);

ALTER TABLE public.first100_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "first100_enrollments_insert_own" ON public.first100_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "first100_enrollments_own_read" ON public.first100_enrollments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "first100_enrollments_admin_all" ON public.first100_enrollments
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. Employer Acquisition / Candidate Conversion Metrics (Aggregation Views)
-- ---------------------------------------------------------------------------

-- These are materialized views refreshed on schedule, or we use aggregation functions.
-- For now, create helper functions for metrics queries.

-- ---------------------------------------------------------------------------
-- 7. Indexes for new tables
-- ---------------------------------------------------------------------------

CREATE INDEX career_job_openings_department_idx
  ON public.career_job_openings (department);

CREATE INDEX career_applications_created_idx
  ON public.career_applications (created_at DESC);

CREATE INDEX first100_enrollments_campaign_status_idx
  ON public.first100_enrollments (campaign_id, status);

-- ---------------------------------------------------------------------------
-- 8. Revoke default grants on new tables (M9 hardening pattern)
-- ---------------------------------------------------------------------------
-- The new tables must not inherit the default anon/authenticated grants that
-- Supabase applies to fresh tables. We explicitly revoke all privileges from
-- browser roles; the RLS policies define the actual access.

REVOKE ALL PRIVILEGES ON TABLE public.career_job_openings FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.career_applications FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.analytics_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.first100_campaign FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.first100_enrollments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.retry_jobs FROM anon, authenticated;

-- The RLS policies on these tables define the precise access:
--   career_job_openings: public SELECT for published, admin ALL
--   career_applications: anon INSERT, own SELECT, admin ALL
--   analytics_events: anon INSERT, admin SELECT
--   first100_campaign: public SELECT for active, admin ALL
--   first100_enrollments: own INSERT/SELECT, admin ALL
--   retry_jobs: deny all browser access

-- ---------------------------------------------------------------------------
-- 8. Helper Functions for Metrics
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_candidate_metrics (
  p_from timestamptz,
  p_to   timestamptz
)
  RETURNS TABLE (
    signup_count              bigint,
    onboarding_completion     bigint,
    wallet_funding_conversion bigint,
    standard_apply_usage      bigint,
    smart_apply_usage         bigint,
    successful_application_rate numeric,
    interview_progression     bigint,
    live_usage                bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  SELECT
    (SELECT count(*) FROM auth.users WHERE created_at BETWEEN p_from AND p_to) AS signup_count,
    (SELECT count(*) FROM public.profiles WHERE onboarding_completed = true AND updated_at BETWEEN p_from AND p_to) AS onboarding_completion,
    (SELECT count(DISTINCT user_id) FROM public.credit_transactions WHERE credit_type = 'wallet_topup' AND created_at BETWEEN p_from AND p_to) AS wallet_funding_conversion,
    (SELECT count(*) FROM public.application_runs WHERE execution_mode = 'standard' AND created_at BETWEEN p_from AND p_to) AS standard_apply_usage,
    (SELECT count(*) FROM public.application_runs WHERE execution_mode = 'smart' AND created_at BETWEEN p_from AND p_to) AS smart_apply_usage,
    CASE
      WHEN (SELECT count(*) FROM public.application_runs WHERE created_at BETWEEN p_from AND p_to) > 0
      THEN round(
        100.0 * (SELECT count(*) FROM public.applications a
                 JOIN public.application_runs ar ON ar.id = a.id
                 WHERE ar.created_at BETWEEN p_from AND p_to
                 AND a.status = 'applied')
        ::numeric / (SELECT count(*) FROM public.application_runs WHERE created_at BETWEEN p_from AND p_to), 2)
      ELSE 0
    END AS successful_application_rate,
    (SELECT count(*) FROM public.interviews WHERE created_at BETWEEN p_from AND p_to) AS interview_progression,
    (SELECT count(*) FROM public.live_interview_sessions WHERE status = 'completed' AND created_at BETWEEN p_from AND p_to) AS live_usage;
$function$;

REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.get_employer_metrics (
  p_from timestamptz,
  p_to   timestamptz
)
  RETURNS TABLE (
    employer_registrations      bigint,
    paid_plan_conversion        numeric,
    jobs_posted                 bigint,
    active_jobs                 bigint,
    applicants_per_job          numeric,
    featured_job_usage          bigint,
    recruiter_seats             bigint,
    applicant_review_activity   bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  SELECT
    (SELECT count(*) FROM public.employer_organizations WHERE created_at BETWEEN p_from AND p_to) AS employer_registrations,
    CASE
      WHEN (SELECT count(*) FROM public.employer_organizations WHERE created_at BETWEEN p_from AND p_to) > 0
      THEN round(
        100.0 * (SELECT count(*) FROM public.employer_subscriptions
                 WHERE status = 'active' AND created_at BETWEEN p_from AND p_to)
        ::numeric / (SELECT count(*) FROM public.employer_organizations WHERE created_at BETWEEN p_from AND p_to), 2)
      ELSE 0
    END AS paid_plan_conversion,
    (SELECT count(*) FROM public.employer_jobs WHERE created_at BETWEEN p_from AND p_to) AS jobs_posted,
    (SELECT count(*) FROM public.employer_jobs WHERE status = 'published' AND posted_at BETWEEN p_from AND p_to) AS active_jobs,
    CASE
      WHEN (SELECT count(*) FROM public.employer_jobs WHERE status = 'published' AND posted_at BETWEEN p_from AND p_to) > 0
      THEN round(
        (SELECT count(*) FROM public.applications a
         JOIN public.employer_jobs ej ON ej.id = a.job_id
         WHERE ej.posted_at BETWEEN p_from AND p_to)
        ::numeric / (SELECT count(*) FROM public.employer_jobs WHERE status = 'published' AND posted_at BETWEEN p_from AND p_to), 2)
      ELSE 0
    END AS applicants_per_job,
    (SELECT count(*) FROM public.featured_listings WHERE created_at BETWEEN p_from AND p_to) AS featured_job_usage,
    (SELECT count(*) FROM public.recruiter_seats WHERE updated_at BETWEEN p_from AND p_to AND count > 0) AS recruiter_seats,
    (SELECT count(*) FROM public.application_status_events WHERE event_type = 'status_change' AND occurred_at BETWEEN p_from AND p_to) AS applicant_review_activity;
$function$;

REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.get_growth_metrics (
  p_from timestamptz,
  p_to   timestamptz
)
  RETURNS TABLE (
    careers_applications      bigint,
    partner_applications      bigint,
    referrals                 bigint,
    referral_conversions      bigint,
    first100_signups          bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  SELECT
    (SELECT count(*) FROM public.career_applications WHERE created_at BETWEEN p_from AND p_to) AS careers_applications,
    (SELECT count(*) FROM public.partner_applications WHERE created_at BETWEEN p_from AND p_to) AS partner_applications,
    (SELECT count(*) FROM public.partner_referrals WHERE created_at BETWEEN p_from AND p_to) AS referrals,
    (SELECT count(*) FROM public.partner_referrals
     WHERE first_conversion_at BETWEEN p_from AND p_to) AS referral_conversions,
    (SELECT count(*) FROM public.first100_enrollments WHERE enrolled_at BETWEEN p_from AND p_to) AS first100_signups;
$function$;

REVOKE ALL ON FUNCTION public.get_growth_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_growth_metrics(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_growth_metrics(timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_growth_metrics(timestamptz, timestamptz) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 9. Analytics Event Logging RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_analytics_event (
  p_event_name       text,
  p_event_category   text,
  p_user_id          uuid DEFAULT NULL,
  p_org_id           uuid DEFAULT NULL,
  p_session_id       uuid DEFAULT NULL,
  p_anonymous_id     uuid DEFAULT NULL,
  p_properties       jsonb DEFAULT '{}'::jsonb,
  p_source           text DEFAULT NULL,
  p_campaign         text DEFAULT NULL,
  p_referral_code    text DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_id uuid;
begin
  insert into public.analytics_events (
    event_name, event_category, user_id, org_id, session_id, anonymous_id,
    properties, source, campaign, referral_code
  )
  values (
    p_event_name, p_event_category, p_user_id, p_org_id, p_session_id, p_anonymous_id,
    p_properties, p_source, p_campaign, p_referral_code
  )
  returning id into v_id;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.log_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.log_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_analytics_event(text, text, uuid, uuid, uuid, uuid, jsonb, text, text, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 10. First 100 Enrollment RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enroll_first100 (
  p_user_id       uuid,
  p_campaign_id   uuid,
  p_referral_code text DEFAULT NULL
)
  RETURNS TABLE (
    enrolled             boolean,
    enrollment_id        uuid,
    enrollment_position  integer,
    message              text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
declare
  v_campaign public.first100_campaign%rowtype;
  v_existing public.first100_enrollments%rowtype;
  v_count integer;
  v_enrollment public.first100_enrollments%rowtype;
begin
  select *
  into v_campaign
  from public.first100_campaign
  where id = p_campaign_id
    and is_active = true
    and (ends_at is null or ends_at > now());

  if not found then
    return query select false, null::uuid, 0, 'Campaign not found or not active';
    return;
  end if;

  -- Check for existing enrollment
  select *
  into v_existing
  from public.first100_enrollments
  where campaign_id = p_campaign_id and user_id = p_user_id;

  if found then
    return query select true, v_existing.id,
      (select count(*) from public.first100_enrollments where campaign_id = p_campaign_id and enrolled_at <= v_existing.enrolled_at)::int,
      'Already enrolled';
    return;
  end if;

  -- Check capacity
  select count(*) into v_count
  from public.first100_enrollments
  where campaign_id = p_campaign_id and status = 'active';

  if v_count >= v_campaign.max_enrollment then
    return query select false, null::uuid, (v_count + 1)::int, 'Campaign is full';
    return;
  end if;

  insert into public.first100_enrollments (campaign_id, user_id, referral_code, status)
  values (p_campaign_id, p_user_id, p_referral_code, 'active')
  returning * into v_enrollment;

  return query select true, v_enrollment.id, (v_count + 1)::int, 'Enrolled successfully';
end;
$function$;

REVOKE ALL ON FUNCTION public.enroll_first100(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_first100(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.enroll_first100(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_first100(uuid, uuid, text) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 10. Complete Referral Attribution in Webhook
-- ---------------------------------------------------------------------------
-- The webhook fulfillment path (20260925000000_apply_wallet_finalization.sql)
-- already has partner attribution. We need to ensure referral attribution
-- is also recorded for direct referrals (not just partner referrals).
-- This is handled in the webhook fulfillment path by checking partner_referrals.