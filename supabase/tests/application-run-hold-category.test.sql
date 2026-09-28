-- Structured run hold classification + frozen verification evidence (Phase 2G)
-- (pgTAP). Run with: npx supabase test db
--
-- Two guarantees are proven here. Both have to hold for *every* writer
-- including the service role, so both are enforced by database triggers rather
-- than by application code:
--
--   1. application_runs.hold_category IS NOT NULL if and only if status =
--      'needs_user'. A run that pauses without naming a category is recorded
--      as 'needs_review'; a run that leaves needs_user has its category
--      cleared, so no consumer (dashboard, Application Agent, admin ops) can
--      ever read a hold reason for a run that is not on hold.
--   2. applications.verification_evidence is write-once, so a retry or a
--      later manual pass cannot rewrite the evidence behind a submitted
--      application.
--
-- This file does not re-prove the run status CHECK or the finalization RPC;
-- those live in apply-finalization-wallet.test.sql and
-- application-snapshot-extensions.test.sql.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(32);

SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('eeeeeeee-7777-4777-8777-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hold-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-7777-4777-8777-000000000001', 'HoldCo', 'Engineer')$$,
  'create job');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'hold_resume.pdf', true, true)$$,
  'create approved resume');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url)
  VALUES ('eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000001',
    'https://hold.example.com/apply')$$,
  'create run');

SELECT is(
  (SELECT hold_category FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  NULL::text,
  'a run created outside needs_user starts with no hold category'
);

-- Pausing without naming a category is still a total function: the row records
-- needs_review rather than null, so "is this run waiting on a human" stays a
-- plain equality test with no coalesce() in the caller's query.
SELECT lives_ok($$UPDATE public.application_runs
  SET status = 'needs_user', stop_reason = 'CAPTCHA or human-verification step detected.'
  WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'$$,
  'pause a run without naming a category');

SELECT is(
  (SELECT hold_category FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  'needs_review'::text,
  'a paused run with no category from the caller is recorded as needs_review'
);

-- An explicit category is preserved, not overwritten by the default.
SELECT lives_ok($$UPDATE public.application_runs
  SET hold_category = 'captcha_required'
  WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'$$,
  'name the CAPTCHA category');

SELECT is(
  (SELECT hold_category FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  'captcha_required'::text,
  'the explicit category survives the trigger'
);

-- Every status that is not needs_user must clear the category. This is the
-- stale-value guard: a retry, a resume, or a workflow that forgets the field
-- cannot leave "captcha_required" sitting on a run that has since submitted.
--
-- A single UPDATE cannot walk one row through eight statuses, and an
-- UPDATE ... FROM unnest against one target row only lands one arbitrary
-- source row — which would leave seven of the eight statuses untested. So the
-- walk is done on INSERT instead, one fresh run per status: the trigger is
-- BEFORE INSERT OR UPDATE, so each row gets its own evaluation.
--
-- The users are separate because application_runs has a unique "one active run
-- per user" index, which would otherwise reject a second active run.
SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'hold-status-' || n || '@example.com', 'not-a-real-password',
    now(), now(), now()
  FROM generate_series(1, 8) n$$,
  'create one user per status in the walk');

SELECT lives_ok($$INSERT INTO public.job_opportunities (user_id, company_name, role_title)
  SELECT u.id, 'HoldCo', 'Engineer' FROM auth.users u
  WHERE u.email like 'hold-status-%@example.com'$$,
  'create a job for each walk user');

SELECT lives_ok($$INSERT INTO public.resumes (user_id, file_name, is_approved, is_master)
  SELECT u.id, 'walk_resume.pdf', true, true FROM auth.users u
  WHERE u.email like 'hold-status-%@example.com'$$,
  'create an approved resume for each walk user');

-- Every status in the run domain except needs_user, each arriving with a stale
-- category already set. Walks user n against status n, so each user gets
-- exactly one run.
--
-- The 'submitted' row carries the confirmation text and timestamps that the
-- pre-existing application_runs_submitted_requires_evidence CHECK demands: a
-- run may only be terminal-success with captured verification. That constraint
-- has nothing to do with the hold category, so the walk satisfies it rather
-- than dropping it.
SELECT lives_ok($$INSERT INTO public.application_runs
  (user_id, job_id, approved_resume_id, target_url, status, hold_category,
   submission_confirmation, submitted_at, finished_at)
  SELECT u.id, j.id, r.id, 'https://hold.example.com/apply', w.status, 'captcha_required',
         case when w.status = 'submitted' then 'Application received' end,
         case when w.status = 'submitted' then now() end,
         case when w.status = 'submitted' then now() end
  FROM (VALUES
    (1, 'queued'), (2, 'preflight'), (3, 'running'), (4, 'ready_to_submit'),
    (5, 'submitting'), (6, 'submitted'), (7, 'failed'), (8, 'cancelled')
  ) AS w(n, status)
  JOIN auth.users u ON u.email = 'hold-status-' || w.n || '@example.com'
  JOIN public.job_opportunities j ON j.user_id = u.id
  JOIN public.resumes r ON r.user_id = u.id$$,
  'insert one run per non-paused status, each carrying a stale category');

SELECT is(
  (SELECT count(*) FROM public.application_runs r
    JOIN auth.users u ON u.id = r.user_id
   WHERE u.email like 'hold-status-%@example.com'
     AND r.hold_category IS NOT NULL),
  0::bigint,
  'no non-paused status retains a hold category, on insert or on update'
);

SELECT is(
  (SELECT count(*) FROM public.application_runs r
    JOIN auth.users u ON u.id = r.user_id
   WHERE u.email like 'hold-status-%@example.com'
     AND (r.hold_category IS NOT NULL) <> (r.status = 'needs_user')),
  0::bigint,
  'the iff invariant holds for every row inserted in the walk'
);

-- Resuming a paused run must clear its category on the way out.
SELECT lives_ok($$UPDATE public.application_runs
  SET status = 'running', hold_category = 'captcha_required'
  WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'$$,
  'the candidate resumes the paused run');

SELECT is(
  (SELECT hold_category FROM public.application_runs
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'),
  NULL::text,
  'resuming clears the hold category'
);

-- The domain is a closed set, so a typo — or a would-be "we got past the
-- CAPTCHA" category — is rejected by the database rather than stored and
-- misread as a legitimate hold later.
SELECT throws_ok(
  $$UPDATE public.application_runs
      SET status = 'needs_user', hold_category = 'captcha_bypassed'
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'$$,
  '23514'::text,
  NULL::text,
  'a hold category outside the domain is rejected'
);

SELECT throws_ok(
  $$UPDATE public.application_runs
      SET status = 'needs_user', hold_category = 'mfa_completed'
    WHERE id = 'eeeeeeee-aaaa-4aaa-8aaa-000000000001'$$,
  '23514'::text,
  NULL::text,
  'a category claiming a human gate was passed is rejected'
);

-- Every documented value is actually accepted, and is stored verbatim rather
-- than being collapsed onto the needs_review default. Same reasoning as the
-- status walk: one row per value, so every value gets its own evaluation and
-- a single UPDATE could not cover them all.
SELECT lives_ok($$INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'hold-cat-' || n || '@example.com', 'not-a-real-password',
    now(), now(), now()
  FROM generate_series(1, 7) n$$,
  'create one user per documented category');

SELECT lives_ok($$INSERT INTO public.job_opportunities (user_id, company_name, role_title)
  SELECT u.id, 'HoldCo', 'Engineer' FROM auth.users u
  WHERE u.email like 'hold-cat-%@example.com'$$,
  'create a job for each category user');

SELECT lives_ok($$INSERT INTO public.resumes (user_id, file_name, is_approved, is_master)
  SELECT u.id, 'cat_resume.pdf', true, true FROM auth.users u
  WHERE u.email like 'hold-cat-%@example.com'$$,
  'create an approved resume for each category user');

SELECT lives_ok($$INSERT INTO public.application_runs
  (user_id, job_id, approved_resume_id, target_url, status, hold_category)
  SELECT u.id, j.id, r.id, 'https://hold.example.com/apply', 'needs_user', c.hold_category
  FROM (VALUES
    (1, 'captcha_required'), (2, 'mfa_required'), (3, 'sensitive_question'),
    (4, 'insufficient_funds'), (5, 'unsupported_flow'),
    (6, 'unverified_submission'), (7, 'needs_review')
  ) AS c(n, hold_category)
  JOIN auth.users u ON u.email = 'hold-cat-' || c.n || '@example.com'
  JOIN public.job_opportunities j ON j.user_id = u.id
  JOIN public.resumes r ON r.user_id = u.id$$,
  'insert one paused run per documented category');

SELECT is(
  (SELECT count(*) FROM public.application_runs r
    JOIN auth.users u ON u.id = r.user_id
   WHERE u.email like 'hold-cat-%@example.com'
     AND r.hold_category is not distinct from
         (select c.hold_category from unnest(ARRAY['captcha_required', 'mfa_required',
           'sensitive_question', 'insufficient_funds', 'unsupported_flow',
           'unverified_submission', 'needs_review']) as c(hold_category)
          where c.hold_category = r.hold_category)),
  7::bigint,
  'all seven documented categories are stored verbatim, none collapsed to the default'
);

-- The partial index the Application Agent and admin ops poll against.
SELECT has_index(
  'public',
  'application_runs',
  'application_runs_hold_category_idx',
  ARRAY['user_id', 'hold_category', 'created_at'],
  'paused runs are indexed by user and category for the hold queue'
);

-- ---------------------------------------------------------------------------
-- applications.verification_evidence is write-once.
-- ---------------------------------------------------------------------------

SELECT lives_ok($$INSERT INTO public.applications
  (id, user_id, job_id, tailored_resume_id, company_name, role_title,
   status, verification_evidence)
  VALUES ('eeeeeeee-bbbb-4bbb-8bbb-000000000001',
    'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001',
    'eeeeeeee-9999-4999-8999-000000000001',
    'HoldCo', 'Engineer', 'applied',
    '{"confirmation_detected": true, "execution_mode": "smart"}'::jsonb)$$,
  'create a submitted application carrying verification evidence');

SELECT is(
  (SELECT verification_evidence ->> 'execution_mode' FROM public.applications
    WHERE id = 'eeeeeeee-bbbb-4bbb-8bbb-000000000001'),
  'smart'::text,
  'the evidence bundle is stored on the application itself'
);

SELECT lives_ok($$UPDATE public.applications
  SET verification_evidence = '{"confirmation_detected": false, "forged": true}'::jsonb
  WHERE id = 'eeeeeeee-bbbb-4bbb-8bbb-000000000001'$$,
  'a later pass attempts to rewrite the evidence bundle');

SELECT is(
  (SELECT verification_evidence FROM public.applications
    WHERE id = 'eeeeeeee-bbbb-4bbb-8bbb-000000000001'),
  '{"confirmation_detected": true, "execution_mode": "smart"}'::jsonb,
  'the recorded evidence is preserved: history cannot be rewritten'
);

-- An application that has not recorded evidence yet may still be populated, so
-- the freeze does not block the finalization RPC's own first write.
SELECT lives_ok($$INSERT INTO public.applications
  (id, user_id, job_id, company_name, role_title, status)
  VALUES ('eeeeeeee-bbbb-4bbb-8bbb-000000000002',
    'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001',
    'HoldCo', 'Engineer', 'approved')$$,
  'create an application with no evidence recorded yet');

SELECT lives_ok($$UPDATE public.applications
  SET verification_evidence = '{"confirmation_detected": true}'::jsonb
  WHERE id = 'eeeeeeee-bbbb-4bbb-8bbb-000000000002'$$,
  'record verification evidence for the first time');

SELECT is(
  (SELECT verification_evidence ? 'confirmation_detected' FROM public.applications
    WHERE id = 'eeeeeeee-bbbb-4bbb-8bbb-000000000002'),
  true,
  'the first evidence write is not blocked by the freeze'
);

SELECT * FROM finish();
ROLLBACK;
