-- Apply execution-mode integrity (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M3 hardening against the real database:
--   * odesseus_finalize_application() refuses a requested mode that
--     contradicts the run's committed execution_mode — a standard (49¢) run
--     cannot be charged at the smart (199¢) rate, and vice versa — while
--     correct-mode finalization still settles exactly 49¢ / 199¢,
--   * replays of an already-submitted run remain idempotent no-ops even when
--     replayed with a differing mode argument (the mode that mattered was
--     the one used for the original charge),
--   * a run may only reach the terminal 'submitted' state with captured
--     verification evidence (confirmation text + submitted_at + finished_at);
--     the storage CHECK rejects any submitted row missing that evidence.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures: m1 with a standard run
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('77777777-7777-4777-8777-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mode-m1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create mode-integrity user m1');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('88888888-8888-4888-8888-000000000001', '77777777-7777-4777-8777-000000000001', 'M1Co', 'Engineer')$$,
  'create job for m1');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('99999999-9999-4999-8999-000000000001', '77777777-7777-4777-8777-000000000001',
    'm1_resume.pdf', true, true)$$,
  'create approved resume for m1');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '77777777-7777-4777-8777-000000000001',
    '88888888-8888-4888-8888-000000000001', '99999999-9999-4999-8999-000000000001',
    'https://m1.example.com/apply', 'standard')$$,
  'create standard run for m1');

SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('77777777-7777-4777-8777-000000000001',
    'wallet_topup', 1000, 'fixture topup', 1000, 'mode:m1:topup')$$,
  'fund m1 wallet with $10');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000001'),
  1000, 'm1 wallet holds 1000¢');

-- ---------------------------------------------------------------------------
-- Mode mismatch is fail-closed (standard run, smart request)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_finalize_application(
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '77777777-7777-4777-8777-000000000001',
     'smart', 'confirmed — thank you', 'https://m1.example.com/thanks')$$,
  NULL, 'execution mode mismatch: run is standard but requested smart',
  'a smart charge is refused for a run committed to standard');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000001'),
  1000, 'wallet unchanged after the mode-mismatch refusal');

SELECT is(
  (SELECT status FROM public.application_runs
   WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
  'queued', 'run untouched after the mode-mismatch refusal');

-- ---------------------------------------------------------------------------
-- Correct-mode finalization still settles exactly 49¢ with evidence
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '77777777-7777-4777-8777-000000000001',
     'standard', 'confirmed — thank you', 'https://m1.example.com/thanks')),
  49, 'standard finalize debits exactly 49¢');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000001'),
  951, 'wallet is 951¢ after the standard debit');

SELECT is(
  (SELECT status FROM public.application_runs
   WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
  'submitted', 'standard run is submitted');

SELECT is(
  (SELECT submission_confirmation IS NOT NULL
     AND submitted_at IS NOT NULL
     AND finished_at IS NOT NULL
   FROM public.application_runs
   WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
  true, 'submitted run carries confirmation text and timestamps');

-- ---------------------------------------------------------------------------
-- Replay with a differing mode is still an idempotent no-op (no charge)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT already_finalized FROM public.odesseus_finalize_application(
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '77777777-7777-4777-8777-000000000001',
     'smart', 'confirmed — thank you', 'https://m1.example.com/thanks')),
  true, 'replayed finalize reports already_finalized even with a different mode arg');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000001'),
  951, 'replay charges nothing (wallet stays 951¢)');

-- ---------------------------------------------------------------------------
-- Fixtures: m2 with a smart run (mirror asserts the other direction)
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('77777777-7777-4777-8777-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mode-m2@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create mode-integrity user m2');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('88888888-8888-4888-8888-000000000002', '77777777-7777-4777-8777-000000000002', 'M2Co', 'Analyst')$$,
  'create job for m2');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('99999999-9999-4999-8999-000000000002', '77777777-7777-4777-8777-000000000002',
    'm2_resume.pdf', true, true)$$,
  'create approved resume for m2');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', '77777777-7777-4777-8777-000000000002',
    '88888888-8888-4888-8888-000000000002', '99999999-9999-4999-8999-000000000002',
    'https://m2.example.com/apply', 'smart')$$,
  'create smart run for m2');

SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('77777777-7777-4777-8777-000000000002',
    'wallet_topup', 2000, 'fixture topup', 2000, 'mode:m2:topup')$$,
  'fund m2 wallet with $20');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000002'),
  2000, 'm2 wallet holds 2000¢');

SELECT throws_ok(
  $$SELECT public.odesseus_finalize_application(
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', '77777777-7777-4777-8777-000000000002',
     'standard', 'confirmed — thank you', 'https://m2.example.com/thanks')$$,
  NULL, 'execution mode mismatch: run is smart but requested standard',
  'a standard charge is refused for a run committed to smart');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000002'),
  2000, 'wallet unchanged after the mirrored mode-mismatch refusal');

SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', '77777777-7777-4777-8777-000000000002',
     'smart', 'confirmed — thank you', 'https://m2.example.com/thanks')),
  199, 'smart finalize debits exactly 199¢');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '77777777-7777-4777-8777-000000000002'),
  1801, 'wallet is 1801¢ after the smart debit');

-- ---------------------------------------------------------------------------
-- Storage invariant: 'submitted' requires captured verification evidence
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('77777777-7777-4777-8777-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mode-m3@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create mode-integrity user m3');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('88888888-8888-4888-8888-000000000003', '77777777-7777-4777-8777-000000000003', 'M3Co', 'PM')$$,
  'create job for m3');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('99999999-9999-4999-8999-000000000003', '77777777-7777-4777-8777-000000000003',
    'm3_resume.pdf', true, true)$$,
  'create approved resume for m3');

SELECT throws_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', '77777777-7777-4777-8777-000000000003',
    '88888888-8888-4888-8888-000000000003', '99999999-9999-4999-8999-000000000003',
    'https://m3.example.com/apply', 'standard', 'submitted')$$,
  '23514', NULL,
  'a submitted run without confirmation evidence is rejected by the CHECK');

SELECT lives_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode, status,
     submission_confirmation, submitted_at, finished_at)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', '77777777-7777-4777-8777-000000000003',
    '88888888-8888-4888-8888-000000000003', '99999999-9999-4999-8999-000000000003',
    'https://m3.example.com/apply', 'standard', 'submitted',
    'verified on page', now(), now())$$,
  'a submitted run with full verification evidence is allowed');

ROLLBACK;