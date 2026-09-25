-- Notification preferences (M8) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M8 notification-preferences slice end to end against the real
-- database:
--   * the table is one row per user (user_id primary key),
--   * channel defaults match the product contract: applications / documents /
--     matches / activity on, product off,
--   * RLS gives the owning user full CRUD on their row and anonymous no
--     access, with grants limited to authenticated SELECT/INSERT/UPDATE/DELETE,
--   * the user FK cascades on account deletion.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ---------------------------------------------------------------------------
-- Fixture: two users so cross-user isolation can be asserted
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'aaaaaaaa-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'notif-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 1');

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'aaaaaaaa-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'notif-u2@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 2');

-- ---------------------------------------------------------------------------
-- Shape, defaults, RLS, and grants
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'notification_preferences', 'notification_preferences table exists');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.notification_preferences'::regclass AND contype = 'p'),
  1, 'notification_preferences has a primary key');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_preferences'::regclass),
  'RLS is enabled on notification_preferences');

SELECT is(
  (SELECT array_agg(policyname ORDER BY policyname)::text[] FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'notification_preferences'),
  ARRAY[
    'notification_preferences_delete_own',
    'notification_preferences_insert_own',
    'notification_preferences_select_own',
    'notification_preferences_update_own'
  ]::text[],
  'policies are exactly the four own-row CRUD policies');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'notification_preferences'
     AND 'anon' = ANY (roles)),
  0, 'no notification_preferences policy targets anon');

SELECT ok(has_table_privilege('authenticated', 'public.notification_preferences', 'SELECT'),
  'authenticated can read notification_preferences (own-row scoped by RLS)');
SELECT ok(has_table_privilege('authenticated', 'public.notification_preferences', 'INSERT'),
  'authenticated can create their notification preferences row');
SELECT ok(has_table_privilege('authenticated', 'public.notification_preferences', 'UPDATE'),
  'authenticated can update their notification preferences');
SELECT ok(has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE'),
  'authenticated can delete their notification preferences');
SELECT ok(NOT has_table_privilege('anon', 'public.notification_preferences', 'SELECT'),
  'anon cannot read notification_preferences');

-- ---------------------------------------------------------------------------
-- Contract defaults match the Notifications screen
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.notification_preferences (user_id)
  VALUES ('aaaaaaaa-1111-4111-8111-111111111111')$$,
  'create user 1 preference row with defaults only');

SELECT is(
  (SELECT applications FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  true, 'applications channel defaults on');
SELECT is(
  (SELECT documents FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  true, 'documents channel defaults on');
SELECT is(
  (SELECT matches FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  true, 'matches channel defaults on');
SELECT is(
  (SELECT activity FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  true, 'activity channel defaults on');
SELECT is(
  (SELECT product FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  false, 'product channel defaults off');

SELECT ok((SELECT created_at IS NOT NULL FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  'created_at is stamped when the row is created');

-- ---------------------------------------------------------------------------
-- User-owned mutation
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$UPDATE public.notification_preferences
   SET applications = false, product = true
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'$$,
  'user toggles channels on their own row');

SELECT is(
  (SELECT applications FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  false, 'applications toggle is persisted');
SELECT is(
  (SELECT product FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  true, 'product toggle is persisted');

-- One row per user: a second insert for the same user must fail (PK).
SELECT throws_ok(
  $$INSERT INTO public.notification_preferences (user_id)
  VALUES ('aaaaaaaa-1111-4111-8111-111111111111')$$,
  '23505', NULL, 'a user cannot hold two preference rows (PK enforced)');

-- ---------------------------------------------------------------------------
-- Referential behavior: user deletion cascades
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.notification_preferences (user_id)
  VALUES ('aaaaaaaa-2222-4222-8222-222222222222')$$,
  'create user 2 preference row');

SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences),
  2, 'two preference rows exist before deletion');

SELECT lives_ok(
  $$DELETE FROM auth.users WHERE id = 'aaaaaaaa-2222-4222-8222-222222222222'$$,
  'delete user 2');

SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-2222-4222-8222-222222222222'),
  0, 'deleting a user cascades their notification preferences');

SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences
   WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  1, 'other users'' preferences are untouched');

SELECT * FROM finish();
ROLLBACK;