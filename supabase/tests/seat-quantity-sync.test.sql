-- Seat quantity synchronization (M5 follow-up) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the seat-quantity synchronization slice against the real database:
--   * the adjustment claim is inserted once and a duplicate is refused at the
--     unique index, which is the actual duplicate-execution guard,
--   * a finished adjustment records its terminal outcome,
--   * a failed adjustment RELEASES its claim so the same resize can be retried,
--   * a successful adjustment keeps its claim, so a retry stays a no-op,
--   * unknown outcomes and malformed claims fail closed,
--   * the org's live seat subscription is discoverable, and
--   * the whole surface is service-role only, with no browser path.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(31);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'seat-sync-owner@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner user');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    '22222222-2222-4222-8222-222222222222',
    'Seat Sync Inc.',
    '11111111-1111-4111-8111-111111111111')$$,
  'create employer organization');

-- ---------------------------------------------------------------------------
-- The live seat subscription is discoverable so the sync can resize it
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.odesseus_org_live_seat_subscription(
    '22222222-2222-4222-8222-222222222222')),
  0, 'an org with no purchased seats has no live seat subscription');

SELECT lives_ok(
  $$INSERT INTO public.recruiter_seats (org_id, count, stripe_subscription_id,
      stripe_customer_id, active_until)
  VALUES (
    '22222222-2222-4222-8222-222222222222', 3, 'sub_seats_sync_1',
    'cus_seats_sync_1', now() + interval '30 days')$$,
  'record a paid seat entitlement');

SELECT is(
  (SELECT seat_count FROM public.odesseus_org_live_seat_subscription(
    '22222222-2222-4222-8222-222222222222')),
  3, 'the live seat subscription reports the paid seat count');

SELECT is(
  (SELECT stripe_subscription_id FROM public.odesseus_org_live_seat_subscription(
    '22222222-2222-4222-8222-222222222222')),
  'sub_seats_sync_1', 'the live seat subscription exposes the Stripe subscription id');

-- An expired entitlement is not live: there is nothing left to resize, and a
-- stale period must not be mistaken for a paid month.
SELECT lives_ok(
  $$UPDATE public.recruiter_seats SET active_until = now() - interval '1 day'
    WHERE org_id = '22222222-2222-4222-8222-222222222222'$$,
  'expire the seat entitlement');

SELECT is(
  (SELECT count(*)::int FROM public.odesseus_org_live_seat_subscription(
    '22222222-2222-4222-8222-222222222222')),
  0, 'an expired seat period is not a live subscription');

SELECT lives_ok(
  $$UPDATE public.recruiter_seats SET active_until = now() + interval '30 days'
    WHERE org_id = '22222222-2222-4222-8222-222222222222'$$,
  'restore the live seat period');

-- ---------------------------------------------------------------------------
-- Claiming an adjustment
-- ---------------------------------------------------------------------------
SELECT ok(
  public.odesseus_claim_seat_adjustment(
    'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2',
    '22222222-2222-4222-8222-222222222222', 2,
    '99999999-1111-4111-8111-111111111111'::uuid,
    'sub_seats_sync_1', 3),
  'a first seat adjustment claim succeeds');

SELECT is(
  (SELECT count(*)::int FROM public.employer_seat_adjustments
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  1, 'the claim is recorded as a pending audit row');

SELECT is(
  (SELECT outcome FROM public.employer_seat_adjustments
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  'pending', 'a fresh claim starts pending');

-- This is the duplicate-execution guard. Two concurrent serverless invocations
-- both reach this point; the unique index is what makes only one of them
-- proceed to call Stripe. An in-process check could not offer this.
SELECT ok(
  NOT public.odesseus_claim_seat_adjustment(
    'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2',
    '22222222-2222-4222-8222-222222222222', 2,
    '99999999-1111-4111-8111-111111111111'::uuid,
    'sub_seats_sync_1', 3),
  'a duplicate seat adjustment claim is refused');

SELECT is(
  (SELECT count(*)::int FROM public.employer_seat_adjustments
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  1, 'the refused duplicate leaves no second audit row');

-- A different target is a different adjustment, and must not be swallowed by
-- the first one's claim.
SELECT ok(
  public.odesseus_claim_seat_adjustment(
    'seat-sync:22222222-2222-4222-8222-222222222222:member-2:1',
    '22222222-2222-4222-8222-222222222222', 1,
    '99999999-2222-4111-8111-111111111111'::uuid,
    'sub_seats_sync_1', 3),
  'a claim for a different target quantity succeeds');

-- ---------------------------------------------------------------------------
-- Recording the terminal outcome
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_finish_seat_adjustment(
      'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2', 'updated')$$,
  'finish a successful adjustment');

SELECT is(
  (SELECT outcome FROM public.employer_seat_adjustments
   WHERE idempotency_key = 'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2'),
  'updated', 'the successful outcome is recorded');

SELECT ok(
  NOT public.odesseus_claim_seat_adjustment(
    'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2',
    '22222222-2222-4222-8222-222222222222', 2),
  'a completed adjustment keeps its claim, so a replay stays a no-op');

-- A failure must be retryable. Without releasing the key, one transient Stripe
-- outage would block that exact adjustment forever.
SELECT lives_ok(
  $$SELECT public.odesseus_finish_seat_adjustment(
      'seat-sync:22222222-2222-4222-8222-222222222222:member-2:1',
      'failed', 'stripe is down')$$,
  'finish a failed adjustment');

SELECT is(
  (SELECT outcome FROM public.employer_seat_adjustments
   WHERE new_quantity = 1),
  'failed', 'the failure is recorded');

SELECT is(
  (SELECT idempotency_key FROM public.employer_seat_adjustments
   WHERE new_quantity = 1),
  NULL, 'a failed adjustment releases its idempotency claim');

SELECT ok(
  public.odesseus_claim_seat_adjustment(
    'seat-sync:22222222-2222-4222-8222-222222222222:member-2:1',
    '22222222-2222-4222-8222-222222222222', 1,
    '99999999-2222-4111-8111-111111111111'::uuid,
    'sub_seats_sync_1', 3),
  'a released claim can be retried');

-- ---------------------------------------------------------------------------
-- Fail-closed validation
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.odesseus_claim_seat_adjustment('short', 
      '22222222-2222-4222-8222-222222222222', 1)$$,
  NULL, 'invalid seat adjustment idempotency key',
  'a too-short idempotency key is rejected');

SELECT throws_ok(
  $$SELECT public.odesseus_claim_seat_adjustment(
      'seat-sync:valid-key:member-3:-1',
      '22222222-2222-4222-8222-222222222222', -1)$$,
  NULL, 'invalid target seat quantity: -1',
  'a negative target quantity is rejected');

SELECT throws_ok(
  $$SELECT public.odesseus_finish_seat_adjustment(
      'seat-sync:22222222-2222-4222-8222-222222222222:member-1:2', 'granted')$$,
  NULL, 'unknown seat adjustment outcome: granted',
  'an unrecognized outcome cannot be recorded');

SELECT throws_ok(
  $$SELECT public.odesseus_finish_seat_adjustment(
      'seat-sync:22222222-2222-4222-8222-222222222222:never:9', 'updated')$$,
  NULL, 'seat adjustment claim not found: seat-sync:22222222-2222-4222-8222-222222222222:never:9',
  'finishing an adjustment that was never claimed fails closed');

-- ---------------------------------------------------------------------------
-- Privileges + RLS contract
-- ---------------------------------------------------------------------------
-- These tables hold Stripe subscription identifiers. They are server-only.
SELECT ok(
  has_table_privilege('service_role', 'public.employer_seat_adjustments', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.employer_seat_adjustments', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.employer_seat_adjustments', 'SELECT'),
  'employer_seat_adjustments is readable only by the service role');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_seat_adjustments'),
  1, 'the adjustment table has exactly one deny-by-default policy');

SELECT ok(
  has_function_privilege('service_role',
    'public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer)', 'EXECUTE'),
  'odesseus_claim_seat_adjustment is service-role-only');

SELECT ok(
  has_function_privilege('service_role',
    'public.odesseus_finish_seat_adjustment(text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.odesseus_finish_seat_adjustment(text, text, text)', 'EXECUTE'),
  'odesseus_finish_seat_adjustment is service-role-only');

SELECT ok(
  has_function_privilege('service_role',
    'public.odesseus_org_live_seat_subscription(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.odesseus_org_live_seat_subscription(uuid)', 'EXECUTE'),
  'odesseus_org_live_seat_subscription is service-role-only');

SELECT * FROM finish();
ROLLBACK;
