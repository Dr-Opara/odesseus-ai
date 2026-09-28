-- Immutable application snapshot completeness (Phase 2H) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves odesseus_finalize_application() (20261022000000) now freezes:
--   * run_id — which application_runs row produced this application,
--   * execution_mode — Apply ("standard") vs Smart Apply ("smart"),
--   * answers_snapshot — the exact application_run_questions answers
--     submitted with this run, in resolution order.
--
-- All existing idempotency/locking/charging behavior is covered separately
-- by apply-mode-integrity.test.sql and apply-finalization-wallet.test.sql;
-- this file only exercises the three new columns.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('eeeeeeee-7777-4777-8777-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'snapshot-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-7777-4777-8777-000000000001', 'SnapCo', 'Engineer')$$,
  'create job');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('eeeeeeee-9999-4999-8999-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'snap_resume.pdf', true, true)$$,
  'create approved resume');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'eeeeeeee-8888-4888-8888-000000000001', 'eeeeeeee-9999-4999-8999-000000000001',
    'https://snap.example.com/apply', 'smart')$$,
  'create smart run');

SELECT lives_ok($$INSERT INTO public.application_run_questions
  (run_id, user_id, field_key, question_text, category, answer_text, answer_source, status, resolved_at)
  VALUES ('eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
    'work_authorization_us', 'Are you authorized to work in the US?', 'work_authorization',
    'Yes, I am a US citizen.', 'user', 'resolved', now())$$,
  'record a resolved answer for the run');

SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('eeeeeeee-7777-4777-8777-000000000001',
    'wallet_topup', 1000, 'fixture topup', 1000, 'snapshot:topup')$$,
  'fund wallet');

SELECT lives_ok(
  $$SELECT public.odesseus_finalize_application(
     'eeeeeeee-aaaa-4aaa-8aaa-000000000001', 'eeeeeeee-7777-4777-8777-000000000001',
     'smart', 'confirmed — thank you', 'https://snap.example.com/thanks')$$,
  'finalize the run');

SELECT is(
  (SELECT jsonb_build_object(
     'run_id', run_id,
     'execution_mode', execution_mode,
     'answers', answers_snapshot -> 0 ->> 'answer_text'
   )
   FROM public.applications
   WHERE user_id = 'eeeeeeee-7777-4777-8777-000000000001'),
  jsonb_build_object(
    'run_id', 'eeeeeeee-aaaa-4aaa-8aaa-000000000001',
    'execution_mode', 'smart',
    'answers', 'Yes, I am a US citizen.'
  ),
  'the finalized application freezes run_id, execution_mode, and the exact submitted answer');

SELECT * FROM finish();
ROLLBACK;
