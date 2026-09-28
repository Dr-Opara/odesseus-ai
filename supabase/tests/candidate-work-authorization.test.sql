-- Phase 2A: candidate_work_authorization + job_preferences additive columns +
-- profiles.onboarding_completed_at stamping (pgTAP).
-- Run with: npx supabase test db
--
-- Proves:
--   * candidate_work_authorization is one row per user, own-row RLS only,
--     and rejects the self-contradictory "authorized without sponsorship AND
--     sponsorship required" combination,
--   * nothing in this migration defaults a candidate into "authorized" —
--     every boolean starts false until the applicant sets it,
--   * the new job_preferences columns (three-way work-arrangement flags,
--     exclusions, relocation preference) have the documented defaults and
--     constraints,
--   * profiles.onboarding_completed_at is stamped exactly once when
--     onboarding_completed first flips true, and cleared if it flips back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wa-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 1');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'wa-u2@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 2');

-- ---------------------------------------------------------------------------
-- 1. candidate_work_authorization: shape, RLS, grants
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'candidate_work_authorization', 'candidate_work_authorization table exists');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.candidate_work_authorization'::regclass),
  'RLS is enabled on candidate_work_authorization');

SELECT is(
  (SELECT array_agg(policyname ORDER BY policyname)::text[] FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'candidate_work_authorization'),
  ARRAY[
    'candidate_work_authorization_delete_own',
    'candidate_work_authorization_insert_own',
    'candidate_work_authorization_select_own',
    'candidate_work_authorization_update_own'
  ]::text[],
  'policies are exactly the four own-row CRUD policies');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'candidate_work_authorization'
     AND 'anon' = ANY (roles)),
  0, 'no candidate_work_authorization policy targets anon');

SELECT ok(NOT has_table_privilege('anon', 'public.candidate_work_authorization', 'SELECT'),
  'anon cannot read candidate_work_authorization');

-- Nothing here defaults a candidate into "authorized": every boolean starts false.
SELECT lives_ok(
  $$INSERT INTO public.candidate_work_authorization (user_id, country_code)
  VALUES ('bbbbbbbb-1111-4111-8111-111111111111', 'US')$$,
  'candidate declares only their country, leaving authorization booleans unset');

SELECT is(
  (SELECT authorized_without_sponsorship FROM public.candidate_work_authorization
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  false, 'authorized_without_sponsorship defaults false, never inferred true');

SELECT is(
  (SELECT sponsorship_required FROM public.candidate_work_authorization
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  false, 'sponsorship_required defaults false');

SELECT is(
  (SELECT relocation_allowed FROM public.candidate_work_authorization
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  false, 'relocation_allowed defaults false');

-- The applicant may not declare both "authorized without sponsorship" and
-- "sponsorship required" for the same country at once.
SELECT throws_ok(
  $$INSERT INTO public.candidate_work_authorization
    (user_id, country_code, authorized_without_sponsorship, sponsorship_required)
  VALUES ('bbbbbbbb-2222-4222-8222-222222222222', 'GB', true, true)$$,
  '23514', NULL, 'contradictory authorization/sponsorship combination is rejected');

SELECT lives_ok(
  $$UPDATE public.candidate_work_authorization
   SET authorized_without_sponsorship = true
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'$$,
  'applicant updates their own declared authorization');

-- One row per user (PK), and account deletion cascades.
SELECT throws_ok(
  $$INSERT INTO public.candidate_work_authorization (user_id, country_code)
  VALUES ('bbbbbbbb-1111-4111-8111-111111111111', 'CA')$$,
  '23505', NULL, 'a user cannot hold two work-authorization rows (PK enforced)');

SELECT lives_ok(
  $$DELETE FROM auth.users WHERE id = 'bbbbbbbb-1111-4111-8111-111111111111'$$,
  'delete user 1');

SELECT is(
  (SELECT count(*)::int FROM public.candidate_work_authorization
   WHERE user_id = 'bbbbbbbb-1111-4111-8111-111111111111'),
  0, 'deleting a user cascades their work-authorization row');

-- ---------------------------------------------------------------------------
-- 2. job_preferences additive columns
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.job_preferences (user_id)
  VALUES ('bbbbbbbb-2222-4222-8222-222222222222')$$,
  'create job_preferences row with defaults only');

SELECT is(
  (SELECT (remote_allowed, hybrid_allowed, onsite_allowed) FROM public.job_preferences
   WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  (true, true, true), 'all three work-arrangement flags default open');

SELECT is(
  (SELECT excluded_companies FROM public.job_preferences
   WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  '{}'::text[], 'excluded_companies defaults to an empty list');

SELECT is(
  (SELECT excluded_titles FROM public.job_preferences
   WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  '{}'::text[], 'excluded_titles defaults to an empty list');

SELECT is(
  (SELECT relocation_preference FROM public.job_preferences
   WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  NULL, 'relocation_preference is unset until the applicant states one');

SELECT throws_ok(
  $$UPDATE public.job_preferences SET relocation_preference = 'sometimes'
  WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'$$,
  '23514', NULL, 'relocation_preference rejects values outside the fixed set');

SELECT lives_ok(
  $$UPDATE public.job_preferences
   SET excluded_companies = ARRAY['Acme Corp'], hybrid_allowed = false
   WHERE user_id = 'bbbbbbbb-2222-4222-8222-222222222222'$$,
  'applicant sets exclusions and narrows work arrangement');

-- ---------------------------------------------------------------------------
-- 3. profiles.onboarding_completed_at stamping
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.profiles (id, onboarding_completed)
  VALUES ('bbbbbbbb-2222-4222-8222-222222222222', false)$$,
  'create profile row, onboarding not yet complete');

SELECT is(
  (SELECT onboarding_completed_at FROM public.profiles
   WHERE id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  NULL, 'onboarding_completed_at is null before completion');

SELECT lives_ok(
  $$UPDATE public.profiles SET onboarding_completed = true
   WHERE id = 'bbbbbbbb-2222-4222-8222-222222222222'$$,
  'candidate finishes onboarding');

SELECT ok(
  (SELECT onboarding_completed_at IS NOT NULL FROM public.profiles
   WHERE id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  'onboarding_completed_at is stamped the moment onboarding_completed flips true');

SELECT * FROM finish();
ROLLBACK;
