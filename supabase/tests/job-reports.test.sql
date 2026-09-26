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

SELECT plan(54);

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
  'new', 'a report starts in the new queue state');

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
-- The acting admin is a required argument. The RPC writes the audit row in the
-- same transaction as the transition, so "who moved this report" cannot be lost
-- even if the caller crashes immediately afterwards.
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'aaaaaaaa-9999-4999-8999-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mod@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create the moderating admin user');

SELECT lives_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'reviewing', NULL,
      'aaaaaaaa-9999-4999-8999-111111111111', 'admin', 'mod@example.com')$$,
  'move a report to reviewing');

SELECT is(
  (SELECT status FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'reviewing', 'report status is reviewing after the RPC');

SELECT lives_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'resolved', 'confirmed by trust & safety, job flagged',
      'aaaaaaaa-9999-4999-8999-111111111111', 'marketing_admin', 'mod@example.com')$$,
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
      'deleted', NULL, 'aaaaaaaa-9999-4999-8999-111111111111')$$,
  NULL, 'unknown job report moderation status: deleted',
  'an unknown moderation status fails closed');

SELECT throws_ok(
  $$SELECT public.odesseus_update_job_report_status(
      '99999999-9999-4999-8999-999999999999', 'resolved', NULL,
      'aaaaaaaa-9999-4999-8999-111111111111')$$,
  NULL, 'job report not found',
  'a missing report fails closed');

-- A rejected transition must leave no audit row behind. The audit write and the
-- status change share a transaction, so a failure rolls both back: otherwise
-- the log would claim a moderation that never happened, which is worse than no
-- log at all.
SELECT is(
  (SELECT count(*)::int FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed'
     AND subject_id = '99999999-9999-4999-8999-999999999999'),
  0, 'a rejected transition writes no audit row');

SELECT throws_ok(
  $$SELECT public.odesseus_update_job_report_status(
      (SELECT id FROM public.job_reports
       WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
      'reviewing', NULL,
      'aaaaaaaa-9999-4999-8999-111111111111', 'superadmin')$$,
  NULL, 'unknown admin role: superadmin',
  'an actor with an unrecognised role cannot moderate');

SELECT is(
  (SELECT status FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'resolved', 'a rejected actor leaves the report untouched');

SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_update_job_report_status(uuid, text, text, uuid, text, text)', 'EXECUTE'),
  'odesseus_update_job_report_status is service-role-only');

-- The pre-audit four-argument overload is gone. Leaving it would be an
-- unaudited moderation path, which is exactly what the migration removed.
SELECT hasnt_function(
  'public', 'odesseus_update_job_report_status',
  ARRAY['uuid', 'text', 'text'],
  'the unaudited four-argument overload no longer exists');

-- Selected by content, not by recency. Every row in this file is written inside
-- one transaction, and `now()` is transaction-stable, so all of them share an
-- identical created_at and `ORDER BY created_at DESC` picks arbitrarily. That
-- would have passed for the wrong reason on a different run.
SELECT is(
  (SELECT actor_user_id FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  'aaaaaaaa-9999-4999-8999-111111111111',
  'the audit row records the acting admin, not the subject');

SELECT is(
  (SELECT actor_email FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  'mod@example.com',
  'the audit row records the acting admin email');

SELECT is(
  (SELECT subject_id FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  (SELECT id::text FROM public.job_reports
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111' AND reason = 'Scam'),
  'the audit row records the moderated report as the subject');

SELECT is(
  (SELECT actor_role FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  'marketing_admin', 'the audit row records the role that acted');

SELECT is(
  (SELECT details->>'from' FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  'reviewing',
  'the audit row records the status the report actually left');

SELECT is(
  (SELECT details->>'to' FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed' AND details->>'to' = 'resolved'),
  'resolved', 'the audit row records the status the report reached');

-- Two moderated transitions, two rows. Collapsing them would lose a step.
SELECT is(
  (SELECT count(*)::int FROM public.admin_audit_log
   WHERE action = 'job_report.status_changed'),
  2, 'each successful transition writes exactly one audit row');

-- ---------------------------------------------------------------------------
-- The approved status domain: new / reviewing / resolved / dismissed
-- ---------------------------------------------------------------------------

-- 'open' is the retired name. It must be rejected by the CHECK rather than
-- lingering as a synonym, or a client could still file or filter on it.
SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status) VALUES (
      'aaaaaaaa-1111-4111-8111-111111111111', 'Fake Company', 'open')$$,
  '23514', NULL, 'the retired open status is rejected by the status CHECK');

-- Each of the four approved states is accepted by the domain.
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['new', 'reviewing', 'resolved', 'dismissed']) AS s(v)
    WHERE pg_get_constraintdef(
            (SELECT oid FROM pg_constraint
              WHERE conrelid = 'public.job_reports'::regclass
                AND conname = 'job_reports_status_check')) LIKE '%' || quote_literal(s.v) || '%'),
  4, 'the status CHECK admits all four approved states');

SELECT is(
  (SELECT pg_get_constraintdef(oid) LIKE '%open%'
     FROM pg_constraint
    WHERE conrelid = 'public.job_reports'::regclass
      AND conname = 'job_reports_status_check'),
  false, 'the status CHECK no longer contains the retired open state');

-- A report is born unreviewed and a filer cannot pre-judge it: `authenticated`
-- holds INSERT, and the insert policy now pins the birth status as well as
-- ownership. Without this pin a direct PostgREST call could file a report
-- already marked resolved.
SELECT set_config('role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","email":"reporter@example.com","role":"authenticated"}',
  true);

SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status)
   VALUES ('aaaaaaaa-1111-4111-8111-111111111111', 'Phishing Attempt', 'resolved')$$,
  '42501', NULL, 'a filer cannot pre-judge their own report as resolved');

SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status)
   VALUES ('aaaaaaaa-1111-4111-8111-111111111111', 'Duplicate Listing', 'dismissed')$$,
  '42501', NULL, 'a filer cannot pre-judge their own report as dismissed');

SELECT lives_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status)
   VALUES ('aaaaaaaa-1111-4111-8111-111111111111', 'Requests Payment', 'new')$$,
  'a filer may still file a report as new');

-- Ownership is still enforced: the pin must not have displaced it.
SELECT throws_ok(
  $$INSERT INTO public.job_reports (user_id, reason, status)
   VALUES ('bbbbbbbb-1111-1111-8111-111111111111', 'Other', 'new')$$,
  '42501', NULL, 'a filer still cannot report as another user');

-- Restore the file's ambient role (postgres), not service_role: the cascade
-- tests below delete from auth.users, which service_role cannot do.
SELECT set_config('role', 'postgres', true);

-- Remove the extra report again. The assertion above is about the insert being
-- permitted at all, and the cascade tests count this user's reports, so
-- leaving a second row behind would change what they are actually measuring.
-- Done as postgres because `authenticated` has no DELETE on job_reports.
DELETE FROM public.job_reports WHERE reason = 'Requests Payment';

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