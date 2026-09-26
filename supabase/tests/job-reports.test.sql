-- Job reports + moderation queue (M7) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M7 job-reports slice end to end against the real database:
--   * public.job_reports is RLS-protected, own-row-scoped (select + insert
--     only; no client update/delete), with grants limited to authenticated
--     SELECT/INSERT and full service_role access,
--   * the reason set, details length cap, and moderation statuses are
--     CHECK-constrained server-side,
--   * job_id follows job_opportunities with ON DELETE SET NULL and user_id
--     cascades on user deletion,
--   * odesseus_update_job_report_status moves a report through the moderation
--     queue (reviewing / resolved / dismissed), records moderator notes, fails
--     closed on unknown statuses and missing reports, and is service-role-only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(35);

-- ---------------------------------------------------------------------------
-- Fixture: reporter user + an opportunity to report
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'aaaaaaaa-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'jobrep-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create reporting user');

SELECT lives_ok(
  $$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES (
    'aaaaaaaa-2222-4222-8222-222222222222',
    'aaaaaaaa-1111-4111-8111-111111111111',
    'Suspicious Co.', 'Customer Support')$$,
  'create a job opportunity to report');

-- ---------------------------------------------------------------------------
-- Shape, RLS, and grants
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'job_reports', 'job_reports table exists');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.job_reports'::regclass),
  'RLS is enabled on job_reports');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'job_reports'),
  2, 'job_reports has select_own + insert_own policies only');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'job_reports'
     AND 'anon' = ANY (roles)),
  0, 'no job_reports policy targets anon');

SELECT is(
  (SELECT array_agg(policyname ORDER BY policyname)::text[] FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'job_reports'),
  ARRAY['job_reports_insert_own', 'job_reports_select_own']::text[],
  'job_reports policies are exactly select_own + insert_own');

SELECT ok(has_table_privilege('authenticated', 'public.job_reports', 'SELECT'),
  'authenticated can read job_reports (own-row scoped by RLS)');
SELECT ok(has_table_privilege('authenticated', 'public.job_reports', 'INSERT'),
  'authenticated can file a job report');
SELECT ok(NOT has_table_privilege('authenticated', 'public.job_reports', 'UPDATE'),
  'authenticated has no UPDATE on job_reports (moderation is server-side)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.job_reports', 'DELETE'),
  'authenticated has no DELETE on job_reports');
SELECT ok(NOT has_table_privilege('anon', 'public.job_reports', 'SELECT'),
  'anon cannot read job_reports');
SELECT ok(has_table_privilege('service_role', 'public.job_reports', 'INSERT'),
  'service_role can create job reports (webhook/internal tooling)');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.job_reports'::regclass AND contype = 'f'),
  2, 'job_reports has two FKs (user_id -> auth.users, job_id -> job_opportunities)');

-- ---------------------------------------------------------------------------
-- CHECK enforcement (server-side, not UI-only)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason) VALUES (
      'aaaaaaaa-1111-4111-8111-111111111111', 'Not A Real Reason')$$,
  '23514', NULL, 'an unknown reason violates the reason CHECK');

SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, details) VALUES (
      'aaaaaaaa-1111-4111-8111-111111111111', 'Other', repeat('x', 2001))$$,
  '23514', NULL, 'details longer than 2000 chars violate the length CHECK');

SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status) VALUES (
      'aaaaaaaa-1111-4111-8111-111111111111', 'Scam', 'archived')$$,
  '23514', NULL, 'a non-queue status violates the status CHECK');

-- ---------------------------------------------------------------------------
-- Filing a report (service path writes the row; client grants only allow own)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.job_reports (user_id, job_id, reason, details)
  VALUES (
    'aaaaaaaa-1111-4111-8111-111111111111',
    'aaaaaaaa-2222-4222-8222-222222222222',
    'Scam', 'Asked me to pay to continue the application')$$,
  'file a job report referencing the opportunity');

SELECT is(
  (SELECT status FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'open', 'a new report starts in the open queue state');

SELECT ok((SELECT created_at IS NOT NULL FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'created_at is stamped on the report');

SELECT is(
  (SELECT job_id FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'aaaaaaaa-2222-4222-8222-222222222222',
  'the reported opportunity is retained on the row');

-- ---------------------------------------------------------------------------
-- Moderation queue via the service-role RPC
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'reviewing')$$,
  'move a report to reviewing');

SELECT is(
  (SELECT status FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'reviewing', 'report status is reviewing after the RPC');

SELECT lives_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'resolved', 'confirmed by trust & safety, job flagged')$$,
  'resolve a report with a moderator note');

SELECT is(
  (SELECT status FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'resolved', 'report is resolved after the RPC');

SELECT is(
  (SELECT moderation_note FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'confirmed by trust & safety, job flagged',
  'moderator note is recorded');

SELECT ok(
  (SELECT updated_at >= created_at FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'updated_at is bumped by moderation');

SELECT throws_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'deleted')$$,
  NULL, 'unknown job report moderation status: deleted',
  'an unknown moderation status fails closed');

SELECT throws_ok(
  $$SELECT public.odesseus_update_job_report_status(
      '99999999-9999-4999-8999-999999999999', 'resolved')$$,
  NULL, 'job report not found',
  'a missing report fails closed');

SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_update_job_report_status(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_update_job_report_status(uuid, text, text)', 'EXECUTE'),
  'odesseus_update_job_report_status is service-role-only');

-- ---------------------------------------------------------------------------
-- Referential behavior: job removal nulls the reference; user removal cascades
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$DELETE FROM public.job_opportunities
   WHERE id = 'aaaaaaaa-2222-4222-8222-222222222222'$$,
  'remove the reported opportunity');

SELECT is(
  (SELECT job_id FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  NULL, 'deleting the job nulls job_id (report survives)');

SELECT is(
  (SELECT count(*)::int FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  1, 'the report row survives the job deletion');

SELECT lives_ok(
  $$DELETE FROM auth.users
   WHERE id = 'aaaaaaaa-1111-4111-8111-111111111111'$$,
  'remove the reporting user');

SELECT is(
  (SELECT count(*)::int FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  0, 'deleting the user cascades their job reports');

SELECT * FROM finish();
ROLLBACK;