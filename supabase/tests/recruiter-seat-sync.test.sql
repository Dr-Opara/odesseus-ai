-- Recruiter seat sync (M5) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M5 recruiter-seat slice end to end against the real database:
--   * the sync RPC upserts one recruiter_seats row per Stripe subscription,
--   * active/trialing seats carry the paid count and an active_until derived
--     from the paid period,
--   * past_due keeps the count but marks the period end,
--   * canceled/incomplete voids the entitlement (count 0),
--   * replays/upserts are a no-op-safe single row (no dupes, no seat
--     inflation), and malformed input fails closed,
--   * the RPC is service-role-only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- Fixture: org owned by user 1
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'emp-seat-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner user');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    '22222222-2222-4222-8222-222222222222',
    'Seats Inc.',
    '11111111-1111-4111-8111-111111111111')$$,
  'create employer organization');

-- ---------------------------------------------------------------------------
-- Active grant
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '22222222-2222-4222-8222-222222222222', 3, 'active',
    'sub_seats_1', 'cus_seats_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz)),
  3, 'active sync reports the paid seat count');

SELECT is(
  (SELECT count FROM public.recruiter_seats
   WHERE stripe_subscription_id = 'sub_seats_1'),
  3, 'active seats are stored with the paid count');

SELECT is(
  (SELECT active_until FROM public.recruiter_seats
   WHERE stripe_subscription_id = 'sub_seats_1'),
  '2026-11-01 00:00:00+00'::timestamptz,
  'active seats carry an active_until matching the paid period end');

SELECT is(
  (SELECT count(*)::int FROM public.recruiter_seats
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  1, 'one recruiter_seats row per subscription');

-- ---------------------------------------------------------------------------
-- Upsert / replay semantics
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '22222222-2222-4222-8222-222222222222', 3, 'active',
    'sub_seats_1', 'cus_seats_1',
    '2026-11-01 00:00:00+00'::timestamptz,
    '2026-12-01 00:00:00+00'::timestamptz)),
  3, 'replaying the same subscription upserts in place (no duplicate row)');

SELECT is(
  (SELECT count(*)::int FROM public.recruiter_seats
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  1, 'upsert never creates a second row for the same subscription');

SELECT is(
  (SELECT active_until FROM public.recruiter_seats
   WHERE stripe_subscription_id = 'sub_seats_1'),
  '2026-12-01 00:00:00+00'::timestamptz,
  'upsert refreshes active_until to the replayed period end');

-- A seat increase on the same subscription is applied over the existing row.
SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '22222222-2222-4222-8222-222222222222', 5, 'active',
    'sub_seats_1', 'cus_seats_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz)),
  5, 'seat add-ons update the same subscription row');

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '22222222-2222-4222-8222-222222222222', 5, 'past_due',
    'sub_seats_1', 'cus_seats_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz)),
  5, 'past_due keeps the seat count (plan still owes seats)');

SELECT is(
  (SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
    '22222222-2222-4222-8222-222222222222', 5, 'canceled',
    'sub_seats_1', 'cus_seats_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz)),
  0, 'canceled voids the seat entitlement (count 0)');

SELECT is(
  (SELECT count FROM public.recruiter_seats
   WHERE stripe_subscription_id = 'sub_seats_1'),
  0, 'canceled count is persisted as 0');

-- ---------------------------------------------------------------------------
-- Fail-closed validation
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
      '22222222-2222-4222-8222-222222222222', 0, 'active',
      'sub_bad_1', 'cus_bad_1', now(), now() + interval '30 days')$$,
  NULL, 'recruiter seat count must be at least 1, got 0',
  'active seats require at least one paid seat');

SELECT throws_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
      '22222222-2222-4222-8222-222222222222', 2, 'paused',
      'sub_bad_2', 'cus_bad_2', now(), now() + interval '30 days')$$,
  NULL, 'unknown subscription status: paused',
  'unknown subscription status is rejected');

SELECT throws_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
      '99999999-9999-4999-8999-999999999999', 2, 'active',
      'sub_bad_3', 'cus_bad_3', now(), now() + interval '30 days')$$,
  NULL, 'employer organization not found',
  'missing organization fails closed');

SELECT throws_ok(
  $$SELECT seat_count FROM public.odesseus_sync_recruiter_seat(
      '22222222-2222-4222-8222-222222222222', 2, 'active',
      '', 'cus_bad_4', now(), now() + interval '30 days')$$,
  NULL, 'a stripe subscription id is required to sync',
  'missing stripe subscription id fails closed');

-- ---------------------------------------------------------------------------
-- Privileges + RLS contract
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz)', 'EXECUTE'),
  'odesseus_sync_recruiter_seat is service-role-only (webhook)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'recruiter_seats'),
  1, 'recruiter_seats keeps its single member-read policy (no write policies added)');

SELECT ok(has_table_privilege('authenticated', 'public.recruiter_seats', 'SELECT'),
  'authenticated may still read recruiter_seats');
SELECT ok(NOT has_table_privilege('authenticated', 'public.recruiter_seats', 'INSERT'),
  'authenticated has no table-level INSERT on recruiter_seats');

SELECT * FROM finish();
ROLLBACK;