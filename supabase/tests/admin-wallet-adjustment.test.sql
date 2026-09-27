-- Admin wallet adjustments (Phase 9A). pgTAP.
--
-- Proves the admin wallet adjustment RPC end to end against the real database:
--   * odesseus_admin_adjust_wallet credits and debits wallet_balance_cents
--     through the shared apply_credit_transaction trigger, so the balance and
--     the ledger move together and the single choke point is never bypassed
--   * idempotent via external_reference: a retried request with the same
--     reference moves no money, writes no second audit row, and returns
--     applied = false with the existing balance
--   * a debit that would drive the balance negative fails with 'insufficient
--     wallet balance' and leaves no audit row behind
--   * an actor role of marketing_admin is refused at the database layer
--   * the audit row records the actor, direction, delta, before/after balance,
--     reference, and reason — enough to reconstruct the change without the
--     operator's memory
--   * odesseus_admin_audit_trail returns the bounded, recent-first trail for a
--     subject
--   * the trigger's wallet branch now handles 'admin_adjustment' alongside the
--     other wallet types, and the amount_cents = abs(delta) invariant holds

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(44);

-- ---------------------------------------------------------------------------
-- Fixture: candidate with a wallet
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'candidate-adj@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create candidate user');

SELECT lives_ok(
  $$INSERT INTO public.credit_balances (user_id, wallet_balance_cents, updated_at)
  VALUES ('bbbbbbbb-1111-4111-8111-111111111111', 1000, now())$$,
  'seed wallet with 1000 cents');

-- Admin users
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'cccccccc-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-finance@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create finance admin user');

SELECT lives_ok(
  $$INSERT INTO public.admin_users (user_id, role)
  VALUES ('cccccccc-1111-4111-8111-111111111111', 'finance_admin')$$,
  'grant finance_admin role');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'dddddddd-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-marketing@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create marketing admin user');

SELECT lives_ok(
  $$INSERT INTO public.admin_users (user_id, role)
  VALUES ('dddddddd-1111-4111-8111-111111111111', 'marketing_admin')$$,
  'grant marketing_admin role');

-- ---------------------------------------------------------------------------
-- Credit: a positive adjustment
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      500,                          -- p_amount_cents (positive = credit)
      'adj:credit-001',             -- p_reference
      'Webhook missed, manual credit', -- p_reason
      'cccccccc-1111-4111-8111-111111111111', -- p_actor_user_id
      'finance_admin',              -- p_actor_role
      'admin-finance@example.com')$$,
  'credit wallet by 500 cents');

SELECT is(
  (SELECT balance_cents_after FROM public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111', 500, 'adj:credit-001', 'noop',
      'cccccccc-1111-4111-8111-111111111111', 'finance_admin', 'admin-finance@example.com')),
  1500, 'balance after credit is 1500');

SELECT is(
  (SELECT applied FROM public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111', 500, 'adj:credit-001', 'noop',
      'cccccccc-1111-4111-8111-111111111111', 'finance_admin', 'admin-finance@example.com')),
  false, 'replay of same reference returns applied = false');

-- The ledger has the wallet branch entry with balance_cents_after = 1500
SELECT is(
  (SELECT balance_cents_after FROM public.credit_transactions
   WHERE external_reference = 'adj:credit-001'),
  1500, 'credit_transactions balance_cents_after is 1500');

SELECT is(
  (SELECT delta FROM public.credit_transactions
   WHERE external_reference = 'adj:credit-001'),
  500, 'credit_transactions delta is +500');

SELECT is(
  (SELECT credit_type FROM public.credit_transactions
   WHERE external_reference = 'adj:credit-001'),
  'admin_adjustment', 'credit_type is admin_adjustment');

SELECT is(
  (SELECT amount_cents FROM public.credit_transactions
   WHERE external_reference = 'adj:credit-001'),
  500, 'amount_cents = abs(delta) for credit');

-- The private ledger has the matching row
SELECT is(
  (SELECT delta FROM odesseus_private.credit_ledger
   WHERE external_reference = 'adj:credit-001'),
  500, 'private ledger delta matches');

SELECT is(
  (SELECT credit_type FROM odesseus_private.credit_ledger
   WHERE external_reference = 'adj:credit-001'),
  'admin_adjustment', 'private ledger credit_type matches');

-- Audit row written in the same transaction
SELECT is(
  (SELECT count(*)::int FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  1, 'exactly one audit row for the credit');

SELECT is(
  (SELECT actor_user_id FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  'cccccccc-1111-4111-8111-111111111111', 'audit records the actor');

SELECT is(
  (SELECT actor_role FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  'finance_admin', 'audit records the role');

SELECT is(
  (SELECT details->>'direction' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  'credit', 'audit records direction = credit');

SELECT is(
  (SELECT details->>'delta_cents' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  '500', 'audit records delta_cents');

SELECT is(
  (SELECT details->>'balance_cents_before' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  '1000', 'audit records balance before');

SELECT is(
  (SELECT details->>'balance_cents_after' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  '1500', 'audit records balance after');

SELECT is(
  (SELECT details->>'reference' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  'adj:credit-001', 'audit records the reference');

SELECT is(
  (SELECT details->>'reason' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  'Webhook missed, manual credit', 'audit records the reason');

-- ---------------------------------------------------------------------------
-- Debit: a negative adjustment
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      -300,                       -- p_amount_cents (negative = debit)
      'adj:debit-001',
      'Duplicate charge refund',
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  'debit wallet by 300 cents');

SELECT is(
  (SELECT balance_cents_after FROM public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111', -300, 'adj:debit-001', 'noop',
      'cccccccc-1111-4111-8111-111111111111', 'finance_admin', 'admin-finance@example.com')),
  1200, 'balance after debit is 1200');

SELECT is(
  (SELECT delta FROM public.credit_transactions
   WHERE external_reference = 'adj:debit-001'),
  -300, 'credit_transactions delta is -300');

SELECT is(
  (SELECT amount_cents FROM public.credit_transactions
   WHERE external_reference = 'adj:debit-001'),
  300, 'amount_cents = abs(delta) for debit');

SELECT is(
  (SELECT details->>'direction' FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted' AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'
     AND details->>'reference' = 'adj:debit-001'),
  'debit', 'audit records direction = debit');

-- ---------------------------------------------------------------------------
-- Insufficient balance: debit that would go negative fails
-- ---------------------------------------------------------------------------
-- Current balance is 1200. Try to debit 2000.
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      -2000,
      'adj:debit-overshoot',
      'Should fail',
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  NULL, 'insufficient wallet balance',
  'debit exceeding balance fails with insufficient wallet balance');

-- No second audit row for the failed attempt
SELECT is(
  (SELECT count(*)::int FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted'
     AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'
     AND details->>'reference' = 'adj:debit-overshoot'),
  0, 'failed debit writes no audit row');

-- Balance unchanged
SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  1200, 'balance unchanged after failed debit');

-- ---------------------------------------------------------------------------
-- marketing_admin refused at the database layer
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      100,
      'adj:marketing-try',
      'Marketing should not move money',
      'dddddddd-1111-4111-8111-111111111111',
      'marketing_admin',
      'admin-marketing@example.com')$$,
  NULL, 'role marketing_admin may not adjust a wallet',
  'marketing_admin cannot adjust wallet');

SELECT is(
  (SELECT count(*)::int FROM public.admin_audit_log
   WHERE action = 'wallet.adjusted'
     AND subject_id = 'bbbbbbbb-1111-4111-8111-111111111111'
     AND details->>'reference' = 'adj:marketing-try'),
  0, 'marketing_admin attempt writes no audit row');

-- ---------------------------------------------------------------------------
-- Unrecognised role rejected
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      100,
      'adj:bad-role',
      'Bad role',
      'bbbbbbbb-1111-4111-8111-111111111111',
      'superadmin',
      'bad@example.com')$$,
  NULL, 'unknown admin role: superadmin',
  'unrecognised role rejected');

-- ---------------------------------------------------------------------------
-- Zero amount rejected
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      0,
      'adj:zero',
      'Zero',
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  NULL, 'an adjustment must be a non-zero amount',
  'zero amount rejected');

-- ---------------------------------------------------------------------------
-- Empty reference rejected
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      100,
      '',
      'Empty ref',
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  NULL, 'an adjustment reference is required',
  'empty reference rejected');

-- ---------------------------------------------------------------------------
-- Empty reason rejected
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      100,
      'adj:noreason',
      '',
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  NULL, 'an adjustment reason is required',
  'empty reason rejected');

-- ---------------------------------------------------------------------------
-- Reason length capped
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_admin_adjust_wallet(
      'bbbbbbbb-1111-4111-8111-111111111111',
      100,
      'adj:longreason',
      'x' || repeat('x', 500),
      'cccccccc-1111-4111-8111-111111111111',
      'finance_admin',
      'admin-finance@example.com')$$,
  NULL, 'adjustment reason is too long',
  'reason over 500 chars rejected');

-- ---------------------------------------------------------------------------
-- odesseus_admin_audit_trail returns bounded, recent-first
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.odesseus_admin_audit_trail(
      'candidate', 'bbbbbbbb-1111-4111-8111-111111111111', 10)),
  2, 'audit trail returns the two successful adjustments');

SELECT ok(
  (SELECT created_at FROM public.odesseus_admin_audit_trail(
      'candidate', 'bbbbbbbb-1111-4111-8111-111111111111', 10) LIMIT 1)
  >=
  (SELECT created_at FROM public.odesseus_admin_audit_trail(
      'candidate', 'bbbbbbbb-1111-4111-8111-111111111111', 10) OFFSET 1 LIMIT 1),
  'audit trail is recent-first');

SELECT is(
  (SELECT count(*)::int FROM public.odesseus_admin_audit_trail(
      'candidate', 'bbbbbbbb-1111-4111-8111-111111111111', 1)),
  1, 'audit trail respects limit');

-- ---------------------------------------------------------------------------
-- Permissions: service-role only
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_admin_adjust_wallet(uuid, integer, text, text, uuid, text, text)', 'EXECUTE'),
  'odesseus_admin_adjust_wallet is service-role-only');

SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_admin_audit_trail(text, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_admin_audit_trail(text, text, integer)', 'EXECUTE'),
  'odesseus_admin_audit_trail is service-role-only');

-- ---------------------------------------------------------------------------
-- The trigger's wallet branch includes admin_adjustment
-- ---------------------------------------------------------------------------
-- Verified implicitly by the successful adjustments above. The CHECK
-- credit_transactions_wallet_amount_check was also widened in the migration.
-- A silent fall-through to the interview branch would have applied the delta
-- to interview_passes instead, which these assertions would catch.

SELECT * FROM finish();
ROLLBACK;