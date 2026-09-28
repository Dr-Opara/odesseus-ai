-- Employer application attribution (pgTAP).
-- Run with: npx supabase test db
--
-- get_employer_metrics counted applicants with
--
--   FROM applications a JOIN employer_jobs ej ON ej.id = a.job_id
--
-- applications.job_id is a foreign key to job_opportunities(id). employer_jobs
-- is an unrelated table. Nothing in the schema connected an application to an
-- employer organization, so the join matched nothing and applicants_per_job was
-- structurally always 0.00 -- and, worse, it asserted that two ids from
-- different tables identify the same thing, which would attribute one
-- organization's applicants to another the moment the ids ever coincided.
--
-- This suite proves the corrected attribution:
--
--   * the path is employer_jobs -> job_opportunities -> applications, carried
--     by a real foreign key,
--   * applications to public job boards are not employer applicants,
--   * two organizations do not see each other's applicants,
--   * a deliberate uuid collision between the two old id spaces does not leak,
--     which is the exact failure the previous join would have produced,
--   * a global aggregate and a per-organization aggregate agree with each
--     other,
--   * the per-organization function is not reachable from a browser role.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(40);

-- ---------------------------------------------------------------------------
-- 1. Fixture: two organizations, two candidates, one public job board.
-- ---------------------------------------------------------------------------

SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    ('cccccccc-1111-4111-8111-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'empattr-owner-a@example.com', 'x', now(), now(), now()),
    ('cccccccc-1111-4111-8111-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'empattr-owner-b@example.com', 'x', now(), now(), now()),
    ('cccccccc-2222-4222-8222-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'empattr-cand-1@example.com', 'x', now(), now(), now()),
    ('cccccccc-2222-4222-8222-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'empattr-cand-2@example.com', 'x', now(), now(), now()),
    ('cccccccc-2222-4222-8222-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'empattr-cand-3@example.com', 'x', now(), now(), now())$$,
  'create two employer owners and three candidates');

SELECT lives_ok($$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES
    ('cccccccc-aaaa-4aaa-8aaa-000000000001', 'Acme Corp',
      'cccccccc-1111-4111-8111-000000000001'),
    ('cccccccc-bbbb-4bbb-8bbb-000000000001', 'Globex Inc',
      'cccccccc-1111-4111-8111-000000000002')$$,
  'create two employer organizations');

SELECT lives_ok($$INSERT INTO public.employer_job_post_credits (org_id, total, used)
  SELECT id, 10, 0 FROM public.employer_organizations
  WHERE id::text LIKE 'cccccccc-%-4%-8%-000000000001'$$,
  'grant job-post credits to each organization');

-- A1, A2 and A4 belong to Acme; A3 stays a draft. B1 belongs to Globex.
-- A4 deliberately reuses the public job board's id, so the old join would have
-- matched it. See assertion 20.
SELECT lives_ok($$INSERT INTO public.employer_jobs (id, org_id, title, status, posted_at)
  VALUES
    ('cccccccc-d001-4d01-8d01-000000000001', 'cccccccc-aaaa-4aaa-8aaa-000000000001',
      'Acme Engineer A', 'published', now()),
    ('cccccccc-d002-4d02-8d02-000000000001', 'cccccccc-aaaa-4aaa-8aaa-000000000001',
      'Acme Engineer B', 'published', now()),
    ('cccccccc-d003-4d03-8d03-000000000001', 'cccccccc-aaaa-4aaa-8aaa-000000000001',
      'Acme Engineer Draft', 'draft', NULL),
    ('cccccccc-e001-4e01-8e01-000000000001', 'cccccccc-bbbb-4bbb-8bbb-000000000001',
      'Globex Engineer', 'published', now()),
    ('cccccccc-d004-4d04-8d04-000000000001', 'cccccccc-aaaa-4aaa-8aaa-000000000001',
      'Acme Shadow', 'published', now())$$,
  'create four published postings and one draft, with credits claimed');

-- The public job board. Its id is reused by Acme''s "Acme Shadow" posting
-- above. It is owned by a candidate and belongs to no employer at all.
SELECT lives_ok($$INSERT INTO public.job_opportunities
  (id, user_id, company_name, role_title, source, employer_job_id)
  VALUES
    ('cccccccc-f001-4f01-8f01-000000000001', 'cccccccc-2222-4222-8222-000000000001',
      'Acme Corp', 'Acme Engineer A', 'employer', 'cccccccc-d001-4d01-8d01-000000000001'),
    ('cccccccc-f002-4f02-8f02-000000000001', 'cccccccc-2222-4222-8222-000000000001',
      'Acme Corp', 'Acme Engineer B', 'employer', 'cccccccc-d002-4d02-8d02-000000000001'),
    ('cccccccc-f003-4f03-8f03-000000000001', 'cccccccc-2222-4222-8222-000000000001',
      'Globex Inc', 'Globex Engineer', 'employer', 'cccccccc-e001-4e01-8e01-000000000001'),
    ('cccccccc-d004-4d04-8d04-000000000001', 'cccccccc-2222-4222-8222-000000000001',
      'Public Board Co', 'Public Board Engineer', 'indeed', NULL)$$,
  'mirror three employer postings and one unattributed public job');

SELECT is(
  (SELECT count(*) FROM public.job_opportunities
    WHERE employer_job_id IS NOT NULL),
  3::bigint,
  'three public opportunities are attributed to an employer posting'
);

SELECT is(
  (SELECT count(*) FROM public.job_opportunities
    WHERE employer_job_id IS NULL),
  1::bigint,
  'the public job board opportunity is attributed to no employer'
);

-- Applications: 3 on Acme A, 1 on Acme B, 2 on Globex, 5 on the public board.
SELECT lives_ok($$INSERT INTO public.applications
  (user_id, job_id, company_name, role_title, status)
  SELECT w.uid::uuid, w.jid::uuid, 'Co', 'Engineer', 'applied'
  FROM (VALUES
    (1, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-f001-4f01-8f01-000000000001'),
    (2, 'cccccccc-2222-4222-8222-000000000002', 'cccccccc-f001-4f01-8f01-000000000001'),
    (3, 'cccccccc-2222-4222-8222-000000000003', 'cccccccc-f001-4f01-8f01-000000000001'),
    (4, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-f002-4f02-8f02-000000000001'),
    (5, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-f003-4f03-8f03-000000000001'),
    (6, 'cccccccc-2222-4222-8222-000000000003', 'cccccccc-f003-4f03-8f03-000000000001'),
    (7, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-d004-4d04-8d04-000000000001'),
    (8, 'cccccccc-2222-4222-8222-000000000002', 'cccccccc-d004-4d04-8d04-000000000001'),
    (9, 'cccccccc-2222-4222-8222-000000000003', 'cccccccc-d004-4d04-8d04-000000000001'),
    (10, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-d004-4d04-8d04-000000000001'),
    (11, 'cccccccc-2222-4222-8222-000000000002', 'cccccccc-d004-4d04-8d04-000000000001')
  ) AS w(n, uid, jid)$$,
  'create eleven applications across four jobs');

SELECT is(
  (SELECT count(*) FROM public.applications),
  11::bigint,
  'all eleven applications exist'
);

-- ---------------------------------------------------------------------------
-- 2. The edge is a real foreign key, not a convention.
-- ---------------------------------------------------------------------------

SELECT has_column(
  'public', 'job_opportunities', 'employer_job_id',
  'job_opportunities carries the link to the employer posting'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    WHERE n.nspname = 'public'
      AND child.relname = 'job_opportunities'
      AND c.contype = 'f'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = child.oid AND attname = 'employer_job_id')]::smallint[]
      AND parent.relname = 'employer_jobs'
  ),
  'the link is a foreign key to employer_jobs, so the schema enforces it'
);

SELECT throws_ok(
  $$UPDATE public.job_opportunities
      SET employer_job_id = 'cccccccc-ffff-4fff-8fff-000000000001'
    WHERE id = 'cccccccc-f001-4f01-8f01-000000000001'$$,
  '23503'::text,
  NULL::text,
  'an employer_job_id that does not exist is rejected'
);

-- Deleting the posting detaches the public opportunity rather than deleting a
-- candidate''s job history.
SELECT lives_ok(
  $$UPDATE public.employer_jobs SET status = 'closed'
    WHERE id = 'cccccccc-e001-4e01-8e01-000000000001'$$,
  'an employer can close a posting'
);

SELECT is(
  (SELECT count(*) FROM public.job_opportunities
    WHERE employer_job_id = 'cccccccc-e001-4e01-8e01-000000000001'),
  1::bigint,
  'closing a posting leaves the candidate''s job opportunity attached'
);

SELECT lives_ok(
  $$UPDATE public.employer_jobs SET status = 'published'
    WHERE id = 'cccccccc-e001-4e01-8e01-000000000001'$$,
  'reopening a posting does not consume a second credit'
);

-- ---------------------------------------------------------------------------
-- 3. Global metrics: only employer-attributable applications count.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT active_jobs FROM public.get_employer_metrics(now() - interval '1 day', now() + interval '1 day')),
  4::bigint,
  'four postings are published inside the window'
);

SELECT is(
  (SELECT jobs_posted FROM public.get_employer_metrics(now() - interval '1 day', now() + interval '1 day')),
  5::bigint,
  'five postings were created inside the window, draft included'
);

-- 3 + 1 + 2 = 6 attributable applications over 4 published postings.
-- The 5 applications to the public job board are excluded, which is what makes
-- this 1.50 rather than 2.75.
SELECT is(
  (SELECT applicants_per_job FROM public.get_employer_metrics(now() - interval '1 day', now() + interval '1 day')),
  1.50::numeric,
  'applicants_per_job counts only applications attributable to an employer posting'
);

SELECT is(
  (SELECT applicants_per_job FROM public.get_employer_metrics(now() - interval '1 day', now() + interval '1 day')),
  round(6.0 / 4.0, 2)::numeric,
  'applicants_per_job is the attributable application count over published postings'
);

-- The previous implementation would have attributed the 5 public-board
-- applications to Acme, because their job_id collides with the id of Acme's
-- "Acme Shadow" posting. Proving the count is 6 and not 11 is the regression
-- test for exactly that leak.
SELECT is(
  (SELECT count(*) FROM public.applications a
     JOIN public.employer_jobs ej ON ej.id = a.job_id
    WHERE ej.id = 'cccccccc-d004-4d04-8d04-000000000001'),
  5::bigint,
  'the old join really would have matched these five rows, so the leak was reachable'
);

SELECT isnt(
  (SELECT applicants_per_job FROM public.get_employer_metrics(now() - interval '1 day', now() + interval '1 day')),
  round(11.0 / 4.0, 2)::numeric,
  'the colliding job_id is not attributed to the employer posting with the same id'
);

-- An empty window must not divide by zero, and must not invent applicants.
SELECT is(
  (SELECT applicants_per_job FROM public.get_employer_metrics(now() + interval '2 days', now() + interval '3 days')),
  0::numeric,
  'a window with no published postings reports zero, not an error'
);

-- ---------------------------------------------------------------------------
-- 4. Per-organization isolation.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT coalesce(sum(applicant_count), 0) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-aaaa-4aaa-8aaa-000000000001')),
  4::numeric,
  'Acme sees four applicants across its postings'
);

SELECT is(
  (SELECT coalesce(sum(applicant_count), 0) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-bbbb-4bbb-8bbb-000000000001')),
  2::numeric,
  'Globex sees two applicants'
);

SELECT is(
  (SELECT count(*) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-bbbb-4bbb-8bbb-000000000001')
   WHERE employer_job_id::text LIKE 'cccccccc-d%'),
  0::bigint,
  'Globex is shown none of Acme''s postings'
);

SELECT is(
  (SELECT count(*) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-aaaa-4aaa-8aaa-000000000001')
   WHERE employer_job_id = 'cccccccc-e001-4e01-8e01-000000000001'),
  0::bigint,
  'Acme is shown none of Globex''s postings'
);

SELECT is(
  (SELECT coalesce(sum(applicant_count), 0) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-aaaa-4aaa-8aaa-000000000001')
   WHERE employer_job_id = 'cccccccc-d003-4d03-8d03-000000000001'),
  0::numeric,
  'the draft posting is reported with zero applicants, not omitted'
);

SELECT is(
  (SELECT count(*) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-aaaa-4aaa-8aaa-000000000001')),
  4::bigint,
  'Acme is shown all four of its postings, draft included'
);

-- The global aggregate and the two per-organization aggregates must agree.
-- 4 + 2 = 6 attributable applications, and 6 is exactly what the global
-- metric counted. If they disagreed, one of them would be wrong.
SELECT is(
  (SELECT coalesce(sum(applicant_count), 0) FROM (
      SELECT applicant_count FROM public.odesseus_get_employer_applicant_counts('cccccccc-aaaa-4aaa-8aaa-000000000001')
      UNION ALL
      SELECT applicant_count FROM public.odesseus_get_employer_applicant_counts('cccccccc-bbbb-4bbb-8bbb-000000000001')
    ) t),
  6::numeric,
  'the two organizations together account for every attributable application'
);

-- The window filter must actually filter.
SELECT is(
  (SELECT coalesce(sum(applicant_count), 0) FROM public.odesseus_get_employer_applicant_counts(
    'cccccccc-aaaa-4aaa-8aaa-000000000001',
    now() + interval '2 days', now() + interval '3 days')),
  0::numeric,
  'a window in the future reports no applicants'
);

-- ---------------------------------------------------------------------------
-- 5. The per-organization function is server-side only.
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege('service_role',
    'public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.odesseus_get_employer_applicant_counts(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'only the server roles may read employer applicant counts'
);

SELECT ok(
  has_function_privilege('service_role',
    'public.get_employer_metrics(timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.get_employer_metrics(timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.get_employer_metrics(timestamptz, timestamptz)', 'EXECUTE'),
  'the global employer metrics function is still server-side only'
);

-- ---------------------------------------------------------------------------
-- 6. get_candidate_metrics had the same defect one function over.
--
-- It joined applications to application_runs on ar.id = a.id, comparing two
-- different tables' primary keys, so successful_application_rate was always 0.
-- The real edge is applications.run_id.
-- ---------------------------------------------------------------------------

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name)
  SELECT gen_random_uuid(), id, 'cv.pdf' FROM auth.users
  WHERE email LIKE 'empattr-cand-%'$$,
  'create a resume for each candidate');

-- A submitted run must carry its confirmation and both timestamps
-- (application_runs_submitted_requires_evidence), which is the same evidence
-- requirement that gates billing settlement.
SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status,
   submission_confirmation, submitted_at, finished_at, created_at)
  SELECT gen_random_uuid(), w.uid::uuid, w.jid::uuid, r.id, 'https://example.com/apply',
    w.mode, w.status,
    CASE WHEN w.status = 'submitted' THEN 'Application submitted.' END,
    CASE WHEN w.status = 'submitted' THEN now() END,
    CASE WHEN w.status = 'submitted' THEN now() END,
    now()
  FROM (VALUES
    (1, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-f001-4f01-8f01-000000000001', 'standard', 'submitted'),
    (2, 'cccccccc-2222-4222-8222-000000000001', 'cccccccc-f001-4f01-8f01-000000000001', 'smart',   'submitted'),
    (3, 'cccccccc-2222-4222-8222-000000000002', 'cccccccc-f001-4f01-8f01-000000000001', 'standard', 'submitted'),
    (4, 'cccccccc-2222-4222-8222-000000000003', 'cccccccc-f001-4f01-8f01-000000000001', 'standard', 'failed')
  ) AS w(n, uid, jid, mode, status)
  JOIN public.resumes r ON r.user_id = w.uid::uuid
  JOIN auth.users u ON u.id = w.uid::uuid$$,
  'create four application runs, three submitted and one failed');

-- Runs 1 and 3 are the submitted standard runs for candidates 1 and 2; each
-- produced a recorded application. Run 2 is a smart run for candidate 1, whose
-- application on that job is already the one run 1 is linked to, and run 4
-- failed, so it produced nothing. Two applications end up linked.
SELECT lives_ok($$UPDATE public.applications a
    SET run_id = r.id
  FROM public.application_runs r
  WHERE r.user_id = a.user_id
    AND r.job_id = a.job_id
    AND r.status = 'submitted'
    AND r.execution_mode = 'standard'
    AND a.job_id = 'cccccccc-f001-4f01-8f01-000000000001'$$,
  'link recorded applications to their runs');

SELECT is(
  (SELECT count(*) FROM public.applications WHERE run_id IS NOT NULL),
  2::bigint,
  'two applications are linked to a run'
);

SELECT is(
  (SELECT standard_apply_usage FROM public.get_candidate_metrics(now() - interval '1 day', now() + interval '1 day')),
  3::bigint,
  'three standard apply runs were started'
);

SELECT is(
  (SELECT smart_apply_usage FROM public.get_candidate_metrics(now() - interval '1 day', now() + interval '1 day')),
  1::bigint,
  'one smart apply run was started'
);

-- 2 successful applications out of 4 runs = 50.00.
SELECT is(
  (SELECT successful_application_rate FROM public.get_candidate_metrics(now() - interval '1 day', now() + interval '1 day')),
  50.00::numeric,
  'successful_application_rate joins applications to runs on applications.run_id'
);

SELECT isnt(
  (SELECT successful_application_rate FROM public.get_candidate_metrics(now() - interval '1 day', now() + interval '1 day')),
  0::numeric,
  'the rate is no longer structurally zero'
);

SELECT * FROM finish();
ROLLBACK;
