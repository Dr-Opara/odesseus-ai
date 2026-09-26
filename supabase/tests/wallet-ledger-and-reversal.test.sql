-- Wallet ledger + reversal contract (pgTAP).
-- Run with: npx supabase test db
--
-- Proves, against the real database, the full money-movement primitives of
-- the candidate wallet:
--   * a wallet top-up recorded through the Stripe billing_events → trigger
--     path credits exactly credit_delta and stamps balance_cents_after,
--   * duplicate webhook events are rejected by the unique stripe_event_id
--     (no double credit),
--   * Standard (49¢) and Smart (199¢) Apply debits leave exact balances and
--     exactly one debit per run (replays never re-charge),
--   * odesseus_reverse_credit_transaction() posts an opposite-delta ledger
--     row exactly once (replays are no-ops), restoring the prior balance,
--   * reversing a top-up whose funds were already spent is blocked and rolls
--     back, while the wallet keeps recovering for later reversals,
--   * insufficient-wallet finalization raises and rolls back completely
--     (no application, no debit, run untouched),
--   * the reversal RPC is service-role/postgres only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(51);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- W1: standard apply + debit reversal + top-up round trip.
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('22222222-2222-4222-8222-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wallet-r1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user w1');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'Acme', 'Engineer')$$,
  'create job for w1');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('44444444-4444-4444-8444-000000000001', '22222222-2222-4222-8222-000000000001',
    'w1_resume.pdf', true, true)$$,
  'create approved resume for w1');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-000000000001',
    '33333333-3333-4333-8333-000000000001', '44444444-4444-4444-8444-000000000001',
    'https://acme.example.com/apply', 'standard')$$,
  'create standard run for w1');

-- Top-up through the real billing_events → fulfillment → ledger path.
SELECT lives_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES ('evt_w1_topup', 'cs_w1_topup', '22222222-2222-4222-8222-000000000001',
    'wallet_topup', 1000, 'wallet_10', 1000, 'usd')$$,
  'record $10 wallet top-up for w1');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000001'),
  1000, 'wallet holds exactly 1000¢ after a $10 top-up');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE user_id = '22222222-2222-4222-8222-000000000001'
     AND external_reference = 'evt_w1_topup'
     AND credit_type = 'wallet_topup' AND delta = 1000 AND balance_cents_after = 1000),
  1, 'top-up ledger row carries delta +1000 and balance_cents_after 1000');

SELECT is(
  (SELECT count(*)::int FROM odesseus_private.credit_ledger
   WHERE user_id = '22222222-2222-4222-8222-000000000001'
     AND external_reference = 'evt_w1_topup'),
  1, 'top-up is also mirrored to the private audit ledger');

-- A replayed webhook event (same stripe_event_id) must never double-credit.
SELECT throws_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES ('evt_w1_topup', 'cs_w1_dupe', '22222222-2222-4222-8222-000000000001',
    'wallet_topup', 1000, 'wallet_10', 1000, 'usd')$$,
  '23505', NULL, 'duplicate Stripe event id is rejected (no double credit)');

SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     '55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-000000000001',
     'standard', 'submitted successfully — you are in the running', 'https://acme.example.com/thanks')),
  49, 'standard apply debits exactly 49¢ on verified success');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000001'),
  951, 'wallet is exactly 951¢ after a standard apply debit');

SELECT is(
  (SELECT count(*)::int FROM public.applications
   WHERE user_id = '22222222-2222-4222-8222-000000000001' AND status = 'applied'),
  1, 'a verified application row exists after finalization');

SELECT is(
  (SELECT status FROM public.application_runs
   WHERE id = '55555555-5555-4555-8555-000000000001'),
  'submitted', 'run is marked submitted after verified success');

SELECT is(
  (SELECT already_finalized FROM public.odesseus_finalize_application(
     '55555555-5555-4555-8555-000000000001', '22222222-2222-4222-8222-000000000001',
     'standard', 'submitted successfully — you are in the running', 'https://acme.example.com/thanks')),
  true, 'replayed finalization reports already_finalized');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000001'),
  951, 'replayed finalization never re-charges the wallet');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE user_id = '22222222-2222-4222-8222-000000000001'
     AND external_reference = 'application:55555555-5555-4555-8555-000000000001'),
  1, 'exactly one debit row exists for the run');

-- Reversal: restores the exact charged amount and ledger discipline.
SELECT is(
  (SELECT reversal_delta FROM public.odesseus_reverse_credit_transaction(
     'application:55555555-5555-4555-8555-000000000001', 'test reversal')),
  49, 'reversing the standard debit posts an opposite delta of +49');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000001'),
  1000, 'wallet returns to 1000¢ after the debit reversal');

SELECT is(
  (SELECT already_reversed FROM public.odesseus_reverse_credit_transaction(
     'application:55555555-5555-4555-8555-000000000001', 'test reversal again')),
  true, 'replaying a reversal is a no-op');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000001'),
  1000, 'replayed reversal does not move the wallet');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE external_reference = 'reversal:application:55555555-5555-4555-8555-000000000001'),
  1, 'exactly one reversal row exists per original transaction');

SELECT throws_ok(
  $$SELECT public.odesseus_reverse_credit_transaction('no_such_transaction', 'nope')$$,
  'P0001', NULL, 'reversing an unknown reference raises');

-- ---------------------------------------------------------------------------
-- W2: smart apply + blocked-then-allowed top-up reversal
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('22222222-2222-4222-8222-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wallet-r2@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user w2');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000002', 'Beta', 'Designer')$$,
  'create job for w2');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-000000000002',
    'w2_resume.pdf', true, true)$$,
  'create approved resume for w2');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-000000000002',
    '33333333-3333-4333-8333-000000000002', '44444444-4444-4444-8444-000000000002',
    'https://beta.example.com/apply', 'smart')$$,
  'create smart run for w2');

SELECT lives_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES ('evt_w2_topup', 'cs_w2_topup', '22222222-2222-4222-8222-000000000002',
    'wallet_topup', 2000, 'wallet_20', 2000, 'usd')$$,
  'record $20 wallet top-up for w2');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000002'),
  2000, 'wallet holds exactly 2000¢ after a $20 top-up');

SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     '55555555-5555-4555-8555-000000000002', '22222222-2222-4222-8222-000000000002',
     'smart', 'submitted — confirmation captured', 'https://beta.example.com/applied')),
  199, 'smart apply debits exactly 199¢ on verified success');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000002'),
  1801, 'wallet is exactly 1801¢ after a smart apply debit');

SELECT throws_ok(
  $$SELECT public.odesseus_reverse_credit_transaction('evt_w2_topup', 'refund')$$,
  'P0001', NULL, 'reversing a top-up whose funds were spent is blocked');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000002'),
  1801, 'blocked top-up reversal rolls back completely');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE external_reference = 'reversal:evt_w2_topup'),
  0, 'blocked top-up reversal leaves no reversal row behind');

SELECT is(
  (SELECT reversal_delta FROM public.odesseus_reverse_credit_transaction(
     'application:55555555-5555-4555-8555-000000000002', 'invalid submission')),
  199, 'reversing the smart debit posts an opposite delta of +199');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000002'),
  2000, 'wallet recovers to 2000¢ after the smart debit reversal');

SELECT is(
  (SELECT reversal_delta FROM public.odesseus_reverse_credit_transaction('evt_w2_topup', 'full refund')),
  -2000, 'top-up reversal is allowed now that the wallet covers it');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000002'),
  0, 'wallet is exactly 0 after the top-up reversal');

-- ---------------------------------------------------------------------------
-- W3: insufficient funds at finalize -> full rollback
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('22222222-2222-4222-8222-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wallet-r3@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create wallet user w3');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000003', 'Gamma', 'Analyst')$$,
  'create job for w3');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('44444444-4444-4444-8444-000000000003', '22222222-2222-4222-8222-000000000003',
    'w3_resume.pdf', true, true)$$,
  'create approved resume for w3');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('55555555-5555-4555-8555-000000000003', '22222222-2222-4222-8222-000000000003',
    '33333333-3333-4333-8333-000000000003', '44444444-4444-4444-8444-000000000003',
    'https://gamma.example.com/apply', 'smart')$$,
  'create smart run for w3 (low wallet)');

SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, external_reference, amount_cents)
  VALUES ('22222222-2222-4222-8222-000000000003',
    'wallet_topup', 100, 'fixture', 'fixture:w3', 100)$$,
  'seed a 100¢ wallet for w3');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000003'),
  100, 'wallet holds exactly 100¢ for the insufficient scenario');

SELECT throws_ok(
  $$SELECT public.odesseus_finalize_application(
     '55555555-5555-4555-8555-000000000003', '22222222-2222-4222-8222-000000000003',
     'smart', 'submitted — confirmation captured', 'https://gamma.example.com/applied')$$,
  'P0001', NULL, 'smart finalization with 100¢ raises insufficient wallet balance');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '22222222-2222-4222-8222-000000000003'),
  100, 'insufficient finalization rolls the wallet back (unchanged)');

SELECT is(
  (SELECT count(*)::int FROM public.applications
   WHERE user_id = '22222222-2222-4222-8222-000000000003'),
  0, 'insufficient finalization records no application');

SELECT is(
  (SELECT status FROM public.application_runs
   WHERE id = '55555555-5555-4555-8555-000000000003'),
  'queued', 'insufficient finalization leaves the run untouched');

SELECT is(
  (SELECT count(*)::int FROM public.credit_transactions
   WHERE user_id = '22222222-2222-4222-8222-000000000003'
     AND external_reference = 'fixture:w3' AND balance_cents_after = 100),
  1, 'the fixture top-up carries balance_cents_after 100');

-- ---------------------------------------------------------------------------
-- Reversal RPC privileges
-- ---------------------------------------------------------------------------
SELECT is(has_function_privilege('anon', 'public.odesseus_reverse_credit_transaction(text, text)', 'EXECUTE'),
  false, 'anon cannot execute the reversal RPC');
SELECT is(has_function_privilege('authenticated', 'public.odesseus_reverse_credit_transaction(text, text)', 'EXECUTE'),
  false, 'authenticated browsers cannot execute the reversal RPC');
SELECT is(has_function_privilege('postgres', 'public.odesseus_reverse_credit_transaction(text, text)', 'EXECUTE'),
  true, 'postgres can execute the reversal RPC');

SELECT * FROM finish();

ROLLBACK;