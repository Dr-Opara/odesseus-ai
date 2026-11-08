-- Spec candidate pricing (pgTAP).
-- Run with: npx supabase test db
--
-- Proves 20261123000000_spec_candidate_pricing.sql against the real database:
--   * an application-credit pack purchase grants exactly its credits,
--   * a verified submission spends exactly 1 credit (Apply or Smart Apply),
--     leaves any legacy wallet untouched, and reports 0 wallet cents debited,
--   * a replay never spends a second credit,
--   * with no credits, a legacy wallet pays the single-credit price (99¢),
--   * with neither, finalization raises and rolls everything back,
--   * Live passes are granted 1 / 3 per purchase, and Live Annual opens a
--     12-month window,
--   * the reversal RPC refunds a spent credit.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures: one user, three jobs, three runs
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('5bec0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'spec-pricing@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create spec-pricing user');

SELECT lives_ok($$INSERT INTO public.job_opportunities (id, user_id, company_name, role_title)
  VALUES
    ('5bec0000-0000-4000-8000-0000000000a1', '5bec0000-0000-4000-8000-000000000001', 'CreditCo', 'Engineer'),
    ('5bec0000-0000-4000-8000-0000000000a2', '5bec0000-0000-4000-8000-000000000001', 'WalletCo', 'Engineer'),
    ('5bec0000-0000-4000-8000-0000000000a3', '5bec0000-0000-4000-8000-000000000001', 'BrokeCo', 'Engineer')$$,
  'create three jobs');

SELECT lives_ok($$INSERT INTO public.resumes (id, user_id, file_name, is_approved, is_master)
  VALUES ('5bec0000-0000-4000-8000-0000000000b1', '5bec0000-0000-4000-8000-000000000001',
    'spec_resume.pdf', true, true)$$,
  'create approved resume');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('5bec0000-0000-4000-8000-0000000000c1', '5bec0000-0000-4000-8000-000000000001',
    '5bec0000-0000-4000-8000-0000000000a1', '5bec0000-0000-4000-8000-0000000000b1',
    'https://creditco.example.com/apply', 'smart')$$,
  'create a smart run for the credit path');

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES ('evt_spec_app25', 'cs_spec_app25', '5bec0000-0000-4000-8000-000000000001',
    'application', 25, 'app_25', 2000, 'usd')$$,
  'a 25-credit pack purchase is fulfilled');

SELECT is(
  (SELECT application_credits FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  25, 'the pack grants exactly 25 application credits');

SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('5bec0000-0000-4000-8000-000000000001',
    'wallet_topup', 500, 'legacy fixture balance', 500, 'spec:legacy-wallet')$$,
  'seed a legacy wallet balance of 500¢');

-- ---------------------------------------------------------------------------
-- Credit path
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     '5bec0000-0000-4000-8000-0000000000c1', '5bec0000-0000-4000-8000-000000000001',
     'smart', 'Thanks for applying', 'https://creditco.example.com/thanks')),
  0, 'a credit-paid submission debits 0 wallet cents');

SELECT is(
  (SELECT application_credits FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  24, 'Smart Apply spends exactly 1 credit');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  500, 'the legacy wallet is untouched while credits remain');

SELECT is(
  (SELECT credit_type || ':' || delta::text FROM public.credit_transactions
   WHERE external_reference = 'application:5bec0000-0000-4000-8000-0000000000c1'),
  'application:-1', 'the ledger row is an application credit of −1');

SELECT is(
  (SELECT verification_evidence->>'charge' FROM public.applications
   WHERE job_id = '5bec0000-0000-4000-8000-0000000000a1'),
  'application_credit', 'the evidence records how the submission was paid');

SELECT is(
  (SELECT already_finalized FROM public.odesseus_finalize_application(
     '5bec0000-0000-4000-8000-0000000000c1', '5bec0000-0000-4000-8000-000000000001',
     'smart', 'Thanks for applying', 'https://creditco.example.com/thanks')),
  true, 'a replay reports already_finalized');

SELECT is(
  (SELECT application_credits FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  24, 'a replay never spends a second credit');

-- Refund of a spent credit through the generic reversal RPC.
SELECT is(
  (SELECT reversal_delta FROM public.odesseus_reverse_credit_transaction(
     'application:5bec0000-0000-4000-8000-0000000000c1', 'spec refund')),
  1, 'reversing a spent credit posts +1');

SELECT is(
  (SELECT application_credits FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  25, 'the credit is restored');

-- ---------------------------------------------------------------------------
-- Legacy wallet fallback
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('5bec0000-0000-4000-8000-000000000001',
    'application', -25, 'spend down fixture', NULL, 'spec:spend-down')$$,
  'spend the remaining credits');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('5bec0000-0000-4000-8000-0000000000c2', '5bec0000-0000-4000-8000-000000000001',
    '5bec0000-0000-4000-8000-0000000000a2', '5bec0000-0000-4000-8000-0000000000b1',
    'https://walletco.example.com/apply', 'standard')$$,
  'create a standard run for the wallet path');

SELECT is(
  (SELECT amount_debited_cents FROM public.odesseus_finalize_application(
     '5bec0000-0000-4000-8000-0000000000c2', '5bec0000-0000-4000-8000-000000000001',
     'standard', 'Application received', 'https://walletco.example.com/thanks')),
  99, 'with no credits, the legacy wallet pays the single-credit price');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  401, 'the wallet moves by exactly 99¢');

SELECT is(
  (SELECT credit_type FROM public.credit_transactions
   WHERE external_reference = 'application:5bec0000-0000-4000-8000-0000000000c2'),
  'standard_apply', 'the wallet debit keeps its mode credit type');

-- ---------------------------------------------------------------------------
-- Neither credits nor wallet
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO public.credit_transactions
  (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES ('5bec0000-0000-4000-8000-000000000001',
    'admin_adjustment', -401, 'empty the wallet', 401, 'spec:empty-wallet')$$,
  'empty the wallet');

SELECT lives_ok($$INSERT INTO public.application_runs
  (id, user_id, job_id, approved_resume_id, target_url, execution_mode)
  VALUES ('5bec0000-0000-4000-8000-0000000000c3', '5bec0000-0000-4000-8000-000000000001',
    '5bec0000-0000-4000-8000-0000000000a3', '5bec0000-0000-4000-8000-0000000000b1',
    'https://brokeco.example.com/apply', 'standard')$$,
  'create a run with nothing to pay');

SELECT throws_ok(
  $$SELECT * FROM public.odesseus_finalize_application(
     '5bec0000-0000-4000-8000-0000000000c3', '5bec0000-0000-4000-8000-000000000001',
     'standard', 'Application received', 'https://brokeco.example.com/thanks')$$,
  NULL, 'insufficient wallet balance',
  'finalization raises when neither credits nor wallet can pay');

SELECT is(
  (SELECT count(*)::int FROM public.applications
   WHERE job_id = '5bec0000-0000-4000-8000-0000000000a3'),
  0, 'nothing is recorded for an unpaid submission');

SELECT isnt(
  (SELECT status FROM public.application_runs WHERE id = '5bec0000-0000-4000-8000-0000000000c3'),
  'submitted', 'the unpaid run is not marked submitted');

-- ---------------------------------------------------------------------------
-- Live passes and Annual
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES
    ('evt_spec_live1', 'cs_spec_live1', '5bec0000-0000-4000-8000-000000000001',
      'interview', 1, 'interview_1', 2499, 'usd'),
    ('evt_spec_live3', 'cs_spec_live3', '5bec0000-0000-4000-8000-000000000001',
      'interview', 3, 'interview_3', 5999, 'usd')$$,
  'single and 3-pass Live purchases are fulfilled');

SELECT is(
  (SELECT interview_passes FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  4, '1 + 3 Live passes are granted');

SELECT lives_ok($$INSERT INTO public.billing_events
  (stripe_event_id, checkout_session_id, user_id, credit_type, credit_delta, sku, amount_cents, currency)
  VALUES ('evt_spec_annual', 'cs_spec_annual', '5bec0000-0000-4000-8000-000000000001',
    'interview', 1, 'interview_annual', 49900, 'usd')$$,
  'a Live Annual purchase is fulfilled');

SELECT ok(
  (SELECT live_unlimited_until FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001')
    BETWEEN now() + interval '11 months 27 days' AND now() + interval '12 months 1 day',
  'Live Annual opens a 12-month window');

SELECT is(
  (SELECT interview_passes FROM public.credit_balances
   WHERE user_id = '5bec0000-0000-4000-8000-000000000001'),
  4, 'Annual does not add discrete passes');

SELECT * FROM finish();
ROLLBACK;
