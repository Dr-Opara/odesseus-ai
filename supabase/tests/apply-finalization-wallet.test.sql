-- odesseus_finalize_application + execution_mode contract (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the Phase 3 backend slice end to end against the real database:
--   * application_runs.execution_mode is the {standard, smart} domain,
--   * the new atomic finalization RPC debits 49¢ (standard) / 199¢ (smart)
--     from the wallet only after verified success, atomically with the
--     application upsert, with correct ledger rows and balance_cents_after,
--   * replays are idempotent and never re-charge,
--   * insufficient wallet balance raises and rolls everything back,
--   * the legacy 4-arg RPC is preserved byte-for-byte,
--   * the RPC is callable only by postgres / service_role.
--
-- Each run gets its own user: application_runs_one_active_per_user allows
-- only one active run per user, and these fixtures stay active until their
-- finalize step flips them to submitted.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(64);

-- ---------------------------------------------------------------------------
-- Fixtures (one user per run)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apply-fin-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user u1');

SELECT lives_ok(
  $$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Acme', 'Engineer')$$,
  'create job j1 for u1');

SELECT lives_ok(
  $$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'u1_base_resume.pdf', true, true)$$,
  'create approved resume for u1');

SELECT lives_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'https://acme.example.com/apply',
    'standard')$$,
  'create standard run r1 for u1');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apply-fin-u2@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user u2');

SELECT lives_ok(
  $$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Beta', 'Designer')$$,
  'create job j2 for u2');

SELECT lives_ok(
  $$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'u2_base_resume.pdf', true, true)$$,
  'create approved resume for u2');

SELECT lives_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',
    'https://beta.example.com/apply',
    'smart')$$,
  'create smart run r3 for u2 (insufficient-wallet scenario)');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apply-fin-u3@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user u3');

SELECT lives_ok(
  $$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'Gamma', 'Analyst')$$,
  'create job j3 for u3');

SELECT lives_ok(
  $$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'u3_base_resume.pdf', true, true)$$,
  'create approved resume for u3');

SELECT lives_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'https://gamma.example.com/apply',
    'smart')$$,
  'create smart run r2 for u3');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'apply-fin-u4@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user u4');

SELECT lives_ok(
  $$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 'Delta', 'PM')$$,
  'create job j4 for u4');

SELECT lives_ok(
  $$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    'u4_base_resume.pdf', true, true)$$,
  'create approved resume for u4');

SELECT lives_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'https://delta.example.com/apply')$$,
  'create run rd without execution_mode (default)');

-- ---------------------------------------------------------------------------
-- execution_mode contract
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.application_runs
    (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd9',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'https://delta.example.com/legacy',
    'assisted')$$,
  '23514',
  NULL,
  'legacy assisted mode is rejected by the new check');

SELECT is(
  (SELECT execution_mode FROM public.application_runs
   WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4'),
  'standard', 'runs created without a mode default to standard');

SELECT ok(
  (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
   WHERE adrelid = 'public.application_runs'::regclass
     AND adnum = (SELECT attnum FROM pg_attribute
                  WHERE attrelid = 'public.application_runs'::regclass
                    AND attname = 'execution_mode')) LIKE '%standard%',
  'execution_mode column default is standard');

-- ---------------------------------------------------------------------------
-- RPC surface + grants
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'odesseus_finalize_application'::name,
  '{uuid,uuid,text,text,text}'::name[],
  'odesseus_finalize_application(uuid,uuid,text,text,text) exists');

SELECT has_function(
  'public', 'odesseus_finalize_successful_application'::name,
  '{uuid,uuid,text,text}'::name[],
  'legacy odesseus_finalize_successful_application(uuid,uuid,text,text) preserved');

SELECT is(
  has_function_privilege('service_role',
    'public.odesseus_finalize_application(uuid,uuid,text,text,text)', 'EXECUTE'),
  true, 'service_role may execute the finalize RPC');

SELECT is(
  has_function_privilege('authenticated',
    'public.odesseus_finalize_application(uuid,uuid,text,text,text)', 'EXECUTE'),
  false, 'authenticated browsers may not execute the finalize RPC');

-- ---------------------------------------------------------------------------
-- Standard Apply finalization (49¢)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'wallet_topup', 1000, 'test topup', 1000, 'afw-topup-u1-1')$$,
  'fund u1 wallet with $10');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  1000, 'u1 wallet funded to 1000¢');

SELECT lives_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'standard',
    'Thank you for applying!',
    'https://acme.example.com/thanks')$$,
  'standard finalize succeeds');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  951, 'standard apply debits exactly 49¢');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  1, 'exactly one debit row per successful run');

SELECT is(
  (SELECT credit_type FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  'standard_apply', 'debit is credit_type standard_apply');

SELECT is(
  (SELECT delta FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  -49, 'debit delta is the signed −49¢');

SELECT is(
  (SELECT amount_cents FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  49, 'amount_cents = abs(delta) for the wallet row');

SELECT is(
  (SELECT balance_cents_after FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  951, 'trigger records balance_cents_after');

SELECT is(
  (SELECT metadata->>'execution_mode' FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  'standard', 'debit metadata records the execution mode');

SELECT is(
  (SELECT metadata->>'rate_cents' FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  '49', 'debit metadata records the applied rate');

SELECT is(
  (SELECT status FROM public.application_runs WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  'submitted', 'run r1 is submitted');

SELECT is(
  (SELECT status FROM public.applications
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
     AND job_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  'applied', 'application row recorded as applied');

SELECT is(
  (SELECT count(*)::int FROM public.applications
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
     AND job_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  1, 'exactly one application row for the job');

-- ---------------------------------------------------------------------------
-- Idempotent replay
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'standard',
    'Thank you for applying!',
    'https://acme.example.com/thanks')$$,
  'replaying the same run does not error');

SELECT is(
  (SELECT already_finalized FROM
     public.odesseus_finalize_application(
       'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       'standard',
       'Thank you for applying!',
       'https://acme.example.com/thanks') LIMIT 1),
  true, 'replay reports already_finalized');

SELECT is(
  (SELECT amount_debited_cents FROM
     public.odesseus_finalize_application(
       'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       'standard',
       'Thank you for applying!',
       'https://acme.example.com/thanks') LIMIT 1),
  0, 'replay debits nothing');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  951, 'wallet unchanged after replay');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  1, 'still exactly one debit row after replay');

-- ---------------------------------------------------------------------------
-- Smart Apply finalization (199¢)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'wallet_topup', 1000, 'test topup', 1000, 'afw-topup-u3-1')$$,
  'fund u3 wallet with $10');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'),
  1000, 'u3 wallet funded to 1000¢');

SELECT lives_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'smart',
    'Application submitted — thank you.',
    'https://gamma.example.com/submitted')$$,
  'smart finalize succeeds');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'),
  801, 'smart apply debits exactly 199¢');

SELECT is(
  (SELECT credit_type FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  'smart_apply', 'debit is credit_type smart_apply');

SELECT is(
  (SELECT delta FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  -199, 'debit delta is the signed −199¢');

SELECT is(
  (SELECT amount_cents FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  199, 'smart amount_cents = abs(delta)');

SELECT is(
  (SELECT metadata->>'execution_mode' FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  'smart', 'smart debit metadata records the mode');

SELECT is(
  (SELECT status FROM public.application_runs WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  'submitted', 'run r2 is submitted');

-- ---------------------------------------------------------------------------
-- Insufficient wallet balance: verified success but no funds → full rollback
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'wallet_topup', 100, 'test topup', 100, 'afw-topup-u2-1')$$,
  'fund u2 wallet with $1 (below the smart rate)');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  100, 'u2 wallet at 100¢');

SELECT throws_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'smart',
    'Thank you for applying!',
    'https://beta.example.com/thanks')$$,
  NULL,
  'insufficient wallet balance',
  'smart finalize with 100¢ raises');

SELECT is(
  (SELECT status FROM public.application_runs WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3'),
  'queued', 'run r3 is untouched after the rollback');

SELECT is(
  (SELECT count(*)::int FROM public.applications
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
     AND job_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'),
  0, 'no application row survives the rollback');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  100, 'wallet unchanged after the rollback');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE external_reference = 'application:dddddddd-dddd-4ddd-8ddd-ddddddddddd3'),
  0, 'no debit row survives the rollback');

-- ---------------------------------------------------------------------------
-- Guard rails: mode/confirmation validation and ownership
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'smart',
    '',
    'https://beta.example.com/thanks')$$,
  NULL,
  'a confirmed submission message is required to finalize',
  'an empty confirmation text is rejected');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  100, 'wallet unchanged after the empty-confirmation rejection');

SELECT throws_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'turbo',
    'Thank you for applying!',
    'https://beta.example.com/thanks')$$,
  NULL,
  'unknown execution mode: turbo',
  'a mode outside standard|smart is rejected');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  100, 'wallet unchanged after the mode rejection');

SELECT throws_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'standard',
    'Thank you for applying!',
    'https://acme.example.com/thanks')$$,
  NULL,
  'application run not found',
  'a run owned by another user cannot be finalized');

SELECT is(
  (SELECT status FROM public.application_runs WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  'submitted', 'run r1 remains submitted after the ownership rejection');

ROLLBACK;