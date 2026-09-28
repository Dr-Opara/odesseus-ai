-- Correct employer application attribution (additive).
--
-- get_employer_metrics counted applicants with:
--
--   (SELECT count(*) FROM public.applications a
--    JOIN public.employer_jobs ej ON ej.id = a.job_id
--    WHERE ej.posted_at BETWEEN p_from AND p_to)
--
-- That join compares two unrelated id spaces. applications.job_id is a foreign
-- key to job_opportunities(id) (applications_job_id_fkey); employer_jobs.id is
-- the primary key of a completely separate table. The only table that has ever
-- referenced employer_jobs is featured_listings. There is no foreign key, no
-- column, and no trigger relating an application to an employer organization
-- anywhere in the schema.
--
-- Two consequences, in order of severity:
--
--   1. Silent zero. The join matches nothing, so applicants_per_job was
--      structurally always 0.00 for every employer, forever. A metric that can
--      only ever report zero is worse than no metric, because it reads as
--      "employers get no applicants" rather than "we are not counting".
--
--   2. Latent cross-tenant attribution. The join is not merely useless, it is
--      unsafe. It asserts that two ids drawn from different tables identify
--      the same thing. uuid collision between the two spaces is improbable by
--      chance, but these ids are also copied between environments, and the
--      moment one job id from the applications space equals an employer_jobs
--      id, an organization's applicants are counted as a different
--      organization's. That is precisely the leak the org boundary exists to
--      prevent, encoded as a query.
--
-- The fix is not to point the join at a different existing column, because no
-- such column exists. It is to add the one missing edge of the path and then
-- let the foreign keys carry the relationship:
--
--   employer_organizations
--     -> employer_jobs (org_id)
--       -> job_opportunities (employer_job_id, new)
--         -> applications (job_id, existing)
--
-- A candidate applies to a job_opportunities row. An employer posting that is
-- visible to candidates is mirrored as a job_opportunities row, and
-- employer_job_id is what records that provenance. The column is nullable and
-- defaults to null, because the large majority of job_opportunities rows are
-- discovered from public boards and belong to no employer account at all.
--
-- Historical rows are not backfilled: employer_job_id was never captured, and
-- guessing which employer owned which historical job is exactly the kind of
-- invented attribution this database is supposed to make impossible. Those
-- rows stay null and are correctly excluded from employer metrics.
--
-- This migration corrects the existing function rather than adding a second
-- one, so every existing caller keeps working against the same name and the
-- same eight-column shape.

-- ---------------------------------------------------------------------------
-- 1. The missing edge: job_opportunities -> employer_jobs
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_opportunities
  ADD COLUMN IF NOT EXISTS employer_job_id uuid REFERENCES public.employer_jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.job_opportunities.employer_job_id IS
  'The employer posting this opportunity was published from, when it belongs to an employer account. This is the only link from an application to an employer organization: applications.job_id -> job_opportunities.id -> here -> employer_jobs.org_id. Null for jobs discovered from public boards, which belong to no employer.';

-- Candidate match and Apply both filter a candidate''s own jobs by status and
-- recency; the employer-facing rollup filters by employer_job_id. The partial
-- index keeps the un-attributed majority (every discovered job) out of the
-- index entirely.
CREATE INDEX IF NOT EXISTS job_opportunities_employer_job_id_idx
  ON public.job_opportunities (employer_job_id)
  WHERE employer_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. get_employer_metrics: count only applications that are actually
--    attributable to an employer posting.
--
-- The numerator is now explicit about its own scope. An application to a
-- public job board is not an applicant to an employer and must not appear in
-- an employer funnel: mixing the two is how a marketplace metric turns into a
-- vanity number.
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
         JOIN public.job_opportunities jo ON jo.id = a.job_id
         JOIN public.employer_jobs ej ON ej.id = jo.employer_job_id
         WHERE ej.posted_at BETWEEN p_from AND p_to
           AND jo.employer_job_id IS NOT NULL)
        ::numeric / (SELECT count(*) FROM public.employer_jobs WHERE status = 'published' AND posted_at BETWEEN p_from AND p_to), 2)
      ELSE 0
    END AS applicants_per_job,
    (SELECT count(*) FROM public.featured_listings WHERE created_at BETWEEN p_from AND p_to) AS featured_job_usage,
    (SELECT count(*) FROM public.recruiter_seats WHERE updated_at BETWEEN p_from AND p_to AND count > 0) AS recruiter_seats,
    (SELECT count(*) FROM public.application_status_events WHERE event_type = 'status_change' AND occurred_at BETWEEN p_from AND p_to) AS applicant_review_activity;
$function$;

COMMENT ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) IS
  'Growth/ops aggregate for employer-side activity. applicants_per_job counts only applications whose job is attributable to an employer posting (job_opportunities.employer_job_id), so applications to public job boards are excluded and one org''s applicants can never be attributed to another.';

REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_metrics(timestamptz, timestamptz) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-organization applicant counts.
--
-- get_employer_metrics is a global aggregate with no org parameter, so it
-- cannot answer "how many applicants does this organization have" and cannot
-- be used to prove that one organization's applicants stay out of another's.
-- This is the org-scoped accessor, scoped by the caller-supplied org id and
-- returning a row per posting.
--
-- SECURITY DEFINER with a pinned search_path, and the org is taken from the
-- argument rather than from anything the caller can set on a session, so the
-- org boundary is a parameter of the query rather than a side effect. It
-- returns counts and ids only, never candidate profile data: an employer sees
-- how many people applied, and Phase 2Q decides what, if anything, they are
-- allowed to see about them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.odesseus_get_employer_applicant_counts (
  p_org_id uuid,
  p_from    timestamptz DEFAULT NULL,
  p_to      timestamptz DEFAULT NULL
)
  RETURNS TABLE (
    employer_job_id  uuid,
    job_opportunity_id uuid,
    job_title        text,
    job_status       text,
    applicant_count  bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'odesseus_private', 'pg_temp'
  AS $function$
  SELECT
    ej.id,
    jo.id,
    ej.title,
    ej.status,
    count(a.id)
  FROM public.employer_jobs ej
  LEFT JOIN public.job_opportunities jo
    ON jo.employer_job_id = ej.id
  LEFT JOIN public.applications a
    ON a.job_id = jo.id
   AND (p_from IS NULL OR a.created_at >= p_from)
   AND (p_to   IS NULL OR a.created_at <  p_to)
  WHERE ej.org_id = p_org_id
  GROUP BY ej.id, jo.id, ej.title, ej.status
  ORDER BY ej.created_at DESC;
$function$;

COMMENT ON FUNCTION public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz) IS
  'Per-posting applicant counts for one employer organization, including postings with no public opportunity mirror yet (applicant_count 0). Returns counts only, never candidate profile data. Grants read access to the aggregate, not to candidates.';

REVOKE ALL ON FUNCTION public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4. get_candidate_metrics had the same class of bug, one function over.
--
--   (SELECT count(*) FROM public.applications a
--    JOIN public.application_runs ar ON ar.id = a.id
--    ...)
--
-- applications.id is the application's own primary key; application_runs.id is
-- a different table's primary key. The correct edge is applications.run_id ->
-- application_runs.id, added in 20261022000000. Joining ar.id = a.id matches
-- nothing, so successful_application_rate was always 0.
--
-- applications.run_id is null for applications that predate run linkage, which
-- is correct: those rows have no run to be measured against, and are excluded
-- by the join rather than counted as failures.
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
                 JOIN public.application_runs ar ON ar.id = a.run_id
                 WHERE ar.created_at BETWEEN p_from AND p_to
                 AND a.status = 'applied')
        ::numeric / (SELECT count(*) FROM public.application_runs WHERE created_at BETWEEN p_from AND p_to), 2)
      ELSE 0
    END AS successful_application_rate,
    (SELECT count(*) FROM public.interviews WHERE created_at BETWEEN p_from AND p_to) AS interview_progression,
    (SELECT count(*) FROM public.live_interview_sessions WHERE status = 'completed' AND created_at BETWEEN p_from AND p_to) AS live_usage;
$function$;

COMMENT ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) IS
  'Growth/ops aggregate for candidate-side activity. successful_application_rate joins applications to application_runs on applications.run_id; rows predating run linkage carry a null run_id and are excluded rather than counted as failures.';

REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_candidate_metrics(timestamptz, timestamptz) TO postgres, service_role;
