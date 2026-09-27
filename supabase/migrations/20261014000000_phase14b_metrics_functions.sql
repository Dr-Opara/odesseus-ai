-- Phase 14B: Growth Backend Metrics Functions
-- Separate migration to ensure all tables exist before function creation.

-- ---------------------------------------------------------------------------
-- 1. Candidate Metrics
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

-- ---------------------------------------------------------------------------
-- 2. Employer Metrics
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3. Growth Metrics
-- ---------------------------------------------------------------------------

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