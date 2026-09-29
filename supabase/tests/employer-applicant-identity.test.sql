-- Employer-readable applicant identity + structured job fields (pgTAP).
-- Run with: npx supabase test db
--
-- ===========================================================================
-- A. APPLICANT IDENTITY
-- ===========================================================================
--
-- The employer portal was rendering a truncated user id because
-- `odesseus_get_employer_applicants` returns no `user_id` and nothing else
-- carried a name. This suite proves the replacement:
--
--   * an authorized employer sees the applicant's real display name and email
--   * an employer on a different org sees nothing at all, not a filtered list
--   * a member of the org who is not the owner still sees their own org only
--   * a candidate cannot read this by calling it for an org they are not in
--   * anonymous holds no execute privilege
--   * no user id, and no candidate-private column, comes back
--
-- The privacy properties that matter most are asserted structurally, not only
-- behaviourally: a function that returned a user id would still pass a
-- "cross-org is denied" test, so the column list itself is checked.
--
-- ===========================================================================
-- B. STRUCTURED JOB FIELDS
-- ===========================================================================
--
-- The four fields the approved job form collects had no column and were packed
-- into `description`. This proves the columns exist and are nullable (so the
-- migration is backwards compatible), that the employment-type vocabulary is
-- constrained rather than free text, and that the legacy backfill recovers a
-- value from a labelled description *without* altering the description.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- 47 assertions. `set_config` calls do not consume a plan slot.
SELECT plan(47);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- Two employers, one viewer-role member, and three candidates. Org A owns two
-- jobs; org B owns one. Candidate 3 has no profile row at all, which is a real
-- state: an account can apply before finishing onboarding.

SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    -- Org A owner, org B owner, a viewer in org A, a viewer in org B.
    ('a1a10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-owner-a@example.com', 'x', now(), now(), now()),
    ('a1a10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-owner-b@example.com', 'x', now(), now(), now()),
    ('a1a10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-viewer-a@example.com', 'x', now(), now(), now()),
    ('a1a10000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-viewer-b@example.com', 'x', now(), now(), now()),
    -- Candidates. A plain candidate account is an authenticated user with no
    -- employer membership, which is the realistic cross-boundary caller.
    ('c1c10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-cand-1@example.com', 'x', now(), now(), now()),
    ('c1c10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-cand-2@example.com', 'x', now(), now(), now()),
    ('c1c10000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'ident-cand-3@example.com', 'x', now(), now(), now())$$,
  'create two employer owners, two viewers, and three candidates');

SELECT lives_ok($$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES
    ('b1b10000-0000-4000-8000-000000000001', 'Acme Corp', 'a1a10000-0000-4000-8000-000000000001'),
    ('b1b10000-0000-4000-8000-000000000002', 'Globex Inc', 'a1a10000-0000-4000-8000-000000000002')$$,
  'create two employer organizations');

SELECT lives_ok($$INSERT INTO public.employer_members (org_id, user_id, role)
  VALUES
    ('b1b10000-0000-4000-8000-000000000001', 'a1a10000-0000-4000-8000-000000000003', 'viewer'),
    ('b1b10000-0000-4000-8000-000000000002', 'a1a10000-0000-4000-8000-000000000004', 'viewer')$$,
  'add a viewer to each organization');

-- Publishing an employer job consumes a job-post credit through a trigger, so
-- each org needs a grant before a job can be published. Granted directly
-- rather than through the subscription sync: this suite is about who may read
-- an applicant, and provisioning a real paid subscription would add a failure
-- mode that has nothing to do with the question.
SELECT lives_ok($$INSERT INTO public.employer_job_post_credits (org_id, total, used, expires_at)
  VALUES
    ('b1b10000-0000-4000-8000-000000000001', 10, 0, now() + interval '1 year'),
    ('b1b10000-0000-4000-8000-000000000002', 10, 0, now() + interval '1 year')$$,
  'grant job-post credits to each organization');

-- Org A: job 1 (candidates 1 and 2) and job 2. Org B: job 3.
SELECT lives_ok($$INSERT INTO public.employer_jobs (id, org_id, title, status, posted_at)
  VALUES
    ('d1d10000-0000-4000-8000-000000000001', 'b1b10000-0000-4000-8000-000000000001',
      'Acme Engineer', 'published', now()),
    ('d1d10000-0000-4000-8000-000000000002', 'b1b10000-0000-4000-8000-000000000001',
      'Acme Analyst', 'published', now()),
    ('d1d10000-0000-4000-8000-000000000003', 'b1b10000-0000-4000-8000-000000000002',
      'Globex Engineer', 'published', now())$$,
  'create two jobs for Acme and one for Globex');

-- Public mirrors, which carry the only edge from a job to an application.
SELECT lives_ok($$INSERT INTO public.job_opportunities
  (id, user_id, company_name, role_title, employer_job_id)
  VALUES
    ('e1e10000-0000-4000-8000-000000000001', 'a1a10000-0000-4000-8000-000000000001',
      'Acme Corp', 'Acme Engineer', 'd1d10000-0000-4000-8000-000000000001'),
    ('e1e10000-0000-4000-8000-000000000002', 'a1a10000-0000-4000-8000-000000000001',
      'Acme Corp', 'Acme Analyst', 'd1d10000-0000-4000-8000-000000000002'),
    ('e1e10000-0000-4000-8000-000000000003', 'a1a10000-0000-4000-8000-000000000002',
      'Globex Inc', 'Globex Engineer', 'd1d10000-0000-4000-8000-000000000003')$$,
  'mirror each employer job to a public opportunity');

-- Candidate 3 gets no profile row on purpose.
SELECT lives_ok($$INSERT INTO public.profiles (id, full_name)
  VALUES
    ('c1c10000-0000-4000-8000-000000000001', 'Ada Lovelace'),
    ('c1c10000-0000-4000-8000-000000000002', 'Alan Turing')$$,
  'create profiles for two of the three candidates');

-- Applications. Candidate 2 also has a whitespace-only name, which is what a
-- candidate who cleared the field gets, and must not become a derived identity.
UPDATE public.profiles SET full_name = '   ' WHERE id = 'c1c10000-0000-4000-8000-000000000002';

SELECT lives_ok($$INSERT INTO public.applications
  (id, user_id, job_id, company_name, role_title, status, submitted_at)
  VALUES
    ('f1f10000-0000-4000-8000-000000000001', 'c1c10000-0000-4000-8000-000000000001',
      'e1e10000-0000-4000-8000-000000000001', 'Acme Corp', 'Acme Engineer', 'applied', now()),
    ('f1f10000-0000-4000-8000-000000000002', 'c1c10000-0000-4000-8000-000000000002',
      'e1e10000-0000-4000-8000-000000000001', 'Acme Corp', 'Acme Engineer', 'applied', now()),
    -- A candidate who applied to Acme job 1 and also to Globex job 3. The
    -- cross-org assertions below are the real point of this row: one
    -- applicant's presence in one org must not make them visible to the other.
    ('f1f10000-0000-4000-8000-000000000003', 'c1c10000-0000-4000-8000-000000000001',
      'e1e10000-0000-4000-8000-000000000003', 'Globex Inc', 'Globex Engineer', 'applied', now()),
    -- Candidate 3 has no profile; the employer must still see the application.
    ('f1f10000-0000-4000-8000-000000000004', 'c1c10000-0000-4000-8000-000000000003',
      'e1e10000-0000-4000-8000-000000000001', 'Acme Corp', 'Acme Engineer', 'applied', now())$$,
  'create four applications across both organizations');

-- ---------------------------------------------------------------------------
-- 1. Authorized employer sees applicant identity
-- ---------------------------------------------------------------------------

SELECT set_config('role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"a1a10000-0000-4000-8000-000000000001","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT candidate_name FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001')
     WHERE application_id = 'f1f10000-0000-4000-8000-000000000001' $$,
  $$ VALUES ('Ada Lovelace') $$,
  'the owning employer sees the applicant''s real display name'
);

SELECT results_eq(
  $$ SELECT candidate_email FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001')
     WHERE application_id = 'f1f10000-0000-4000-8000-000000000001' $$,
  $$ VALUES ('ident-cand-1@example.com') $$,
  'the owning employer sees the applicant''s contact address'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001') $$,
  $$ VALUES (3) $$,
  'every application on the org''s job is listed, including one with no profile'
);

-- A member who is not the owner still reads their own org. The function must
-- accept a membership row, not only the owner row, or a recruiter seat is
-- useless.
SELECT set_config('request.jwt.claims',
  '{"sub":"a1a10000-0000-4000-8000-000000000003","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', null) $$,
  $$ VALUES (3) $$,
  'a non-owner member reads their own organization without being the owner'
);

-- ---------------------------------------------------------------------------
-- 2. Unrelated employer cannot
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims',
  '{"sub":"a1a10000-0000-4000-8000-000000000002","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', null) $$,
  '42501', NULL,
  'Globex''s owner is refused Acme''s applicant identities outright'
);

-- Refused for a foreign org even when the job id is one of the caller''s own.
-- The org check runs before the job filter, so passing a job you own cannot
-- buy you a different org''s applicants.
SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000003') $$,
  '42501', NULL,
  'a job the caller does own does not unlock a foreign org'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000002', null) $$,
  $$ VALUES (1) $$,
  'Globex sees only the single application on its own job'
);

-- The shared applicant is the interesting case: Ada applied to both orgs, so a
-- leak would be visible as Acme's applicant appearing in Globex's read.
SELECT results_eq(
  $$ SELECT count(*)::int FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000002', null)
     WHERE application_id = 'f1f10000-0000-4000-8000-000000000001' $$,
  $$ VALUES (0) $$,
  'an application on another org''s job is not returned to this org'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a1a10000-0000-4000-8000-000000000004","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', null) $$,
  '42501', NULL,
  'a viewer of one org cannot read another org''s applicants'
);

-- ---------------------------------------------------------------------------
-- 3. A candidate is not an employer
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claims',
  '{"sub":"c1c10000-0000-4000-8000-000000000001","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', null) $$,
  '42501', NULL,
  'a candidate with no employer membership cannot enumerate any org''s applicants'
);

-- The sharpest version of the same probe: a candidate naming their own
-- application must not be able to read identity back out through the org view.
SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001',
       'd1d10000-0000-4000-8000-000000000001') $$,
  '42501', NULL,
  'a candidate cannot use their own application id as an org key'
);

-- ---------------------------------------------------------------------------
-- 4. Anonymous cannot
-- ---------------------------------------------------------------------------

SELECT set_config('role', 'anon', true);
SELECT set_config('request.jwt.claims', '{}', true);

SELECT throws_ok(
  $$ SELECT * FROM public.odesseus_get_employer_applicant_identities(
       'b1b10000-0000-4000-8000-000000000001', null) $$,
  '42501', NULL,
  'anon has no execute privilege on the identity accessor'
);

SELECT is_empty(
  $$ SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'auth' AND table_name = 'users' AND grantee = 'anon' $$,
  'anon holds no privileges on auth.users'
);

-- ---------------------------------------------------------------------------
-- 5. What the projection must not contain
--
-- A cross-org denial test passes just as well against a function that leaked
-- a user id, because the leak would only surface in a pivot nobody attempted
-- here. So the column list itself is asserted, and so is the absence of the
-- candidate-private tables from the function body.
-- ---------------------------------------------------------------------------

-- Asserted as a count rather than by returning `proname`. A `name` value cast
-- to `text` carries no collation, and pgTAP compares sets through a cursor
-- where a collation-less text column raises "could not determine which
-- collation to use" before the assertion runs. Same reason the signature below
-- is checked in its own single-column result rather than concatenated.
SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities' $$,
  $$ VALUES (1) $$,
  'the identity accessor exists exactly once in public'
);

SELECT results_eq(
  $$ SELECT pg_get_function_identity_arguments(p.oid)
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities' $$,
  $$ VALUES ('p_org_id uuid, p_job_id uuid') $$,
  'the identity accessor takes an org id plus an optional job id'
);

SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND pg_get_function_result(p.oid) =
            'TABLE(application_id uuid, candidate_name text, candidate_email text)' $$,
  $$ VALUES (1) $$,
  'the accessor returns exactly three columns: application id, name, email'
);

-- The load-bearing privacy property, stated precisely. `user_id` does appear
-- in the body -- twice, as the join key from applications to profiles and to
-- auth.users. That is legitimate: it is what makes the identity lookup possible.
-- What must never happen is it reaching the caller, because a user id would let
-- any employer who reads this join an application to a candidate's Live
-- transcripts, mock feedback, wallet, or resume with one more call.
--
-- So the assertion is on the return type, not on the absence of the word: the
-- accessor returns no user id, and the two joins are the only places it appears.
SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND pg_get_function_result(p.oid) ~ 'user_id' $$,
  $$ VALUES (0) $$,
  'the identity accessor returns no user id'
);

-- Every mention of user_id in the body is a join predicate, never a projected
-- value. Checked per join: `count(*)` over a regex predicate counts matching
-- *rows*, not occurrences, so one predicate per assertion is the honest form.
SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND p.prosrc ~ 'profiles p on p\.id = a\.user_id' $$,
  $$ VALUES (1) $$,
  'user_id reaches profiles only as a join key'
);

SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND p.prosrc ~ 'auth\.users u\s+on u\.id = a\.user_id' $$,
  $$ VALUES (1) $$,
  'user_id reaches auth.users only as a join key'
);

-- And the projected column list is exactly the three declared ones, so a
-- future column addition is a visible change to the return type above.
SELECT is_empty(
  $$ SELECT 1
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND p.prosrc ~ 'select[\s\S]{0,200}a\.user_id\s*(,|$)' $$,
  'a user id is never projected into the result'
);

-- Structural, and therefore the check that actually holds: none of the
-- candidate-private tables may appear in the function body at all.
SELECT is_empty(
  $$ SELECT 1
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND p.prosrc ~* '(live_transcript|live_guidance|post_interview_analyses|mock_interview|interview_round_memory|credit_balances|credit_transactions|resumes|resume_tailorings|application_answer_vault)' $$,
  'the identity accessor references no candidate-private table'
);

-- Only full_name is read from profiles. headline, location, skills,
-- certifications, candidate_facts and the social links are not selected.
SELECT is_empty(
  $$ SELECT 1
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'odesseus_get_employer_applicant_identities'
        AND p.prosrc ~* '(headline|candidate_facts|linkedin_url|github_url|portfolio_url|\.skills|\.certifications)' $$,
  'only full_name is read from public.profiles'
);

-- The applicant accessor that predates this change must not have been widened
-- to carry identity instead. Identity is its own surface, not a column on
-- someone else's payload reader.
SELECT results_eq(
  $$ SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'odesseus_get_employer_applicants'
        AND pg_get_function_result(p.oid) ~
            '(application_id|employer_job_id|job_title).*full_name' $$,
  $$ VALUES (0) $$,
  'the pre-existing applicant accessor was not widened with a name column'
);

-- ---------------------------------------------------------------------------
-- 6. A name is never invented
--
-- A candidate with no profile row, or one whose name is whitespace, yields
-- NULL. Deriving a display name from an email local-part would be a guess about
-- a person, which is the same rule that forbids inventing qualifications.
-- ---------------------------------------------------------------------------

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', '{}', true);

-- A candidate who has not finished onboarding has no profile row, so there is
-- no display name to show. The application must still be listed, and the email
-- is still known from the auth record. The employer sees "this applicant, at
-- this address, with no name on file" rather than a row that silently vanished
-- from their pipeline.
SELECT results_eq(
  $$ SELECT candidate_name IS NULL, candidate_email
       FROM public.odesseus_get_employer_applicant_identities(
         'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001')
     WHERE application_id = 'f1f10000-0000-4000-8000-000000000004' $$,
  $$ VALUES (true, 'ident-cand-3@example.com') $$,
  'an applicant with no profile row is listed with a null name, not dropped'
);

SELECT results_eq(
  $$ SELECT candidate_name IS NULL
       FROM public.odesseus_get_employer_applicant_identities(
         'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001')
     WHERE application_id = 'f1f10000-0000-4000-8000-000000000002' $$,
  $$ VALUES (true) $$,
  'a whitespace-only name is reported as absent rather than as a blank identity'
);

-- ---------------------------------------------------------------------------
-- 7. Structured job fields
-- ---------------------------------------------------------------------------

SELECT results_eq(
  $$ SELECT count(*)::int FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employer_jobs'
        AND column_name in ('department', 'employment_type', 'compensation_text',
                            'responsibilities_text') $$,
  $$ VALUES (4) $$,
  'employer_jobs carries the four structured job-form columns'
);

-- Backwards compatibility, stated as data: every one of the four is nullable,
-- so a job written before this migration is still valid.
SELECT results_eq(
  $$ SELECT count(*)::int FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employer_jobs'
        AND column_name in ('department', 'employment_type', 'compensation_text',
                            'responsibilities_text')
        AND is_nullable = 'YES' $$,
  $$ VALUES (4) $$,
  'all four columns are nullable, so existing jobs are unaffected'
);

SELECT results_eq(
  $$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'public.employer_jobs'::regclass
        AND conname = 'employer_jobs_employment_type_check' $$,
  $$ VALUES (
    'CHECK (((employment_type IS NULL) OR (employment_type = ANY (ARRAY[''full_time''::text, ''part_time''::text, ''contract''::text, ''temporary''::text, ''internship''::text, ''volunteer''::text, ''other''::text]))))'
  ) $$,
  'employment type is constrained to the stated vocabulary rather than free text'
);

-- A posting whose type is outside the vocabulary is refused, so the filter
-- dimension cannot quietly become unfilterable.
SELECT throws_ok(
  $$ INSERT INTO public.employer_jobs
       (org_id, title, employment_type)
     VALUES ('b1b10000-0000-4000-8000-000000000001', 'Bad Type', 'full time') $$,
  '23514', NULL,
  'an unstated employment-type spelling is rejected by the vocabulary'
);

-- A stated type is accepted, including one the form offers and one a discovery
-- provider normalises to, so a mirrored posting is never refused.
SELECT lives_ok(
  $$ INSERT INTO public.employer_jobs (org_id, title, employment_type, department, compensation_text, responsibilities_text)
     VALUES ('b1b10000-0000-4000-8000-000000000001', 'Struct Fields Job',
             'full_time', 'Engineering', '$180K-$220K', E'Threat modelling\nSecure code review') $$,
  'a job may carry all four structured fields'
);

SELECT results_eq(
  $$ SELECT department, employment_type, compensation_text,
            array_length(string_to_array(responsibilities_text, E'\n'), 1)
       FROM public.employer_jobs
      WHERE title = 'Struct Fields Job' $$,
  $$ VALUES ('Engineering', 'full_time', '$180K-$220K', 2) $$,
  'the four structured fields read back as entered'
);

-- Compensation is text, not integer cents, and is null rather than defaulted
-- when the employer stated nothing. A defaulted salary would be invented money
-- on a public page.
SELECT results_eq(
  $$ SELECT compensation_text IS NULL FROM public.employer_jobs
      WHERE title = 'Acme Analyst' $$,
  $$ VALUES (true) $$,
  'a job with no stated compensation stores null rather than a default'
);

-- ---------------------------------------------------------------------------
-- 8. The legacy backfill recovers the labelled description without altering it
-- ---------------------------------------------------------------------------

-- The form writes each field as its own block, separated by a blank line, with
-- responsibilities last. Built with chr(10) so the newlines are real: a literal
-- backslash-n here would test a description the form never produces, and would
-- pass or fail for the wrong reason.
UPDATE public.employer_jobs
   SET description =
         'Own application security.'            || chr(10) || chr(10) ||
         'Department: Engineering'               || chr(10) || chr(10) ||
         'Employment type: Full-time'            || chr(10) || chr(10) ||
         'Compensation: $180K-$220K'              || chr(10) || chr(10) ||
         'Responsibilities:'                      || chr(10) ||
         'Threat modelling'                       || chr(10) ||
         'Secure code review'
 WHERE title = 'Acme Engineer';

-- Captured after the description is in its legacy form, so the comparison below
-- asks the right question: did the backfill alter the text it read?
CREATE TEMP TABLE legacy_before AS
  SELECT description FROM public.employer_jobs WHERE title = 'Acme Engineer';

-- Re-run the migration's backfill statements verbatim.
UPDATE public.employer_jobs ej
set department = b.department
from (
  select id, (regexp_match(description, '(?m)^Department:[ \t]*(.+)$'))[1] as department
  from public.employer_jobs
  where description ~ '(?m)^Department:[ \t]*[^ \t\n]'
) b
where ej.id = b.id and ej.department is null and b.department is not null;

UPDATE public.employer_jobs ej
set employment_type = b.normalized
from (
  select
    id,
    nullif(btrim(regexp_replace(lower(raw), '[^a-z]+', '_', 'g'), '_'), '') as normalized
  from (
    select id,
           trim((regexp_match(description, '(?m)^Employment type:[ \t]*(.+)$'))[1]) as raw
    from public.employer_jobs
    where description ~ '(?m)^Employment type:[ \t]*[^ \t\n]'
  ) raw_rows
) b
where ej.id = b.id and ej.employment_type is null
  and b.normalized in ('full_time', 'part_time', 'contract', 'temporary',
                       'internship', 'volunteer', 'other');

UPDATE public.employer_jobs ej
set compensation_text = b.compensation
from (
  select id, trim((regexp_match(description, '(?m)^Compensation:[ \t]*(.+)$'))[1]) as compensation
  from public.employer_jobs
  where description ~ '(?m)^Compensation:[ \t]*[^ \t\n]'
) b
where ej.id = b.id and ej.compensation_text is null and b.compensation is not null;

UPDATE public.employer_jobs ej
set responsibilities_text = nullif(trim(b.block), '')
from (
  select
    src.id,
    trim(split_part(
      substring(src.description from pos.label_at + length('Responsibilities:') + 1),
      chr(10) || chr(10),
      1
    )) as block
  from public.employer_jobs src
  cross join lateral (
    select strpos(src.description, 'Responsibilities:' || chr(10)) as label_at
  ) pos
  where src.description ~ ('(?m)^Responsibilities:[ \t]*' || chr(10))
    and pos.label_at > 0
) b
where ej.id = b.id and ej.responsibilities_text is null and nullif(trim(b.block), '') is not null;

SELECT results_eq(
  $$ SELECT department FROM public.employer_jobs WHERE title = 'Acme Engineer' $$,
  $$ VALUES ('Engineering') $$,
  'the backfill recovers department from a labelled description'
);

SELECT results_eq(
  $$ SELECT employment_type FROM public.employer_jobs WHERE title = 'Acme Engineer' $$,
  $$ VALUES ('full_time') $$,
  'the backfill normalises a form label into the stored vocabulary'
);

SELECT results_eq(
  $$ SELECT compensation_text FROM public.employer_jobs WHERE title = 'Acme Engineer' $$,
  $$ VALUES ('$180K-$220K') $$,
  'the backfill recovers compensation from a labelled description'
);

SELECT results_eq(
  $$ SELECT responsibilities_text FROM public.employer_jobs WHERE title = 'Acme Engineer' $$,
  $$ VALUES ('Threat modelling' || chr(10) || 'Secure code review') $$,
  'the backfill recovers the whole multi-line responsibilities block'
);

-- The property that makes the backfill safe: it only ever adds. Compared
-- through md5 because a text-to-text equality has no resolvable collation in
-- this database's default configuration.
SELECT ok(
  (SELECT md5(description) FROM public.employer_jobs WHERE title = 'Acme Engineer')
  = (SELECT md5(description) FROM legacy_before LIMIT 1),
  'the backfill does not rewrite the description it read'
);

-- Re-running must not clobber a corrected value.
UPDATE public.employer_jobs SET department = 'Security' WHERE title = 'Acme Engineer';

UPDATE public.employer_jobs ej
set department = b.department
from (
  select id, (regexp_match(description, '(?m)^Department:[ \t]*(.+)$'))[1] as department
  from public.employer_jobs
  where description ~ '(?m)^Department:[ \t]*[^ \t\n]'
) b
where ej.id = b.id and ej.department is null and b.department is not null;

SELECT is(
  (SELECT department FROM public.employer_jobs WHERE title = 'Acme Engineer'),
  'Security',
  'a re-run of the backfill does not overwrite a value the employer corrected'
);

-- An employer whose prose happens to contain the word mid-sentence is not
-- mistaken for a labelled field.
UPDATE public.employer_jobs
   SET description = 'Ask about Compensation: it is negotiable for the right candidate.'
 WHERE title = 'Globex Engineer';

UPDATE public.employer_jobs ej
set compensation_text = b.compensation
from (
  select id, trim((regexp_match(description, '(?m)^Compensation:[ \t]*(.+)$'))[1]) as compensation
  from public.employer_jobs
  where description ~ '(?m)^Compensation:[ \t]*[^ \t\n]'
) b
where ej.id = b.id and ej.compensation_text is null and b.compensation is not null;

SELECT is(
  (SELECT compensation_text FROM public.employer_jobs WHERE title = 'Globex Engineer'),
  NULL,
  'a mid-sentence mention of Compensation is not parsed as a compensation field'
);

SELECT * FROM finish();
ROLLBACK;
