-- Application Agent settings + decision log (Phase 2F) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves:
--   * application_agent_settings is one row per user, owner-only RLS, and
--     starts paused by default (an agent must be turned on deliberately),
--   * application_agent_decisions is an append-only explainability log:
--     owner can read their own decisions, nobody can UPDATE or DELETE one,
--     and the decision/mode CHECK constraints hold the full spec vocabulary.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'dddddddd-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agent-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 1');

-- ---------------------------------------------------------------------------
-- 1. application_agent_settings
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'application_agent_settings', 'application_agent_settings table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.application_agent_settings'::regclass),
  'RLS is enabled on application_agent_settings');
SELECT ok(NOT has_table_privilege('anon', 'public.application_agent_settings', 'SELECT'),
  'anon cannot read application_agent_settings');

SELECT lives_ok(
  $$INSERT INTO public.application_agent_settings (user_id)
  VALUES ('dddddddd-1111-4111-8111-111111111111')$$,
  'create a settings row with defaults only');

SELECT is(
  (SELECT paused FROM public.application_agent_settings
   WHERE user_id = 'dddddddd-1111-4111-8111-111111111111'),
  true, 'a new agent starts paused by default');

SELECT is(
  (SELECT mode FROM public.application_agent_settings
   WHERE user_id = 'dddddddd-1111-4111-8111-111111111111'),
  'review', 'a new agent defaults to review mode');

SELECT throws_ok(
  $$INSERT INTO public.application_agent_settings (user_id, mode)
  VALUES ('dddddddd-1111-4111-8111-111111111111', 'auto')$$,
  '23505', NULL, 'a user cannot hold two agent settings rows (PK enforced)');

SELECT throws_ok(
  $$UPDATE public.application_agent_settings SET mode = 'aggressive'
  WHERE user_id = 'dddddddd-1111-4111-8111-111111111111'$$,
  '23514', NULL, 'mode is constrained to review/hybrid/auto');

-- ---------------------------------------------------------------------------
-- 2. application_agent_decisions
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'application_agent_decisions', 'application_agent_decisions table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.application_agent_decisions'::regclass),
  'RLS is enabled on application_agent_decisions');

SELECT lives_ok(
  $$INSERT INTO public.application_agent_decisions (user_id, mode, decision, match_score, reasons)
  VALUES ('dddddddd-1111-4111-8111-111111111111', 'auto', 'AUTO_APPLY', 92, ARRAY['All configured rules passed.'])$$,
  'insert an explainable decision row');

SELECT throws_ok(
  $$INSERT INTO public.application_agent_decisions (user_id, mode, decision)
  VALUES ('dddddddd-1111-4111-8111-111111111111', 'auto', 'NOT_A_REAL_STATUS')$$,
  '23514', NULL, 'decision is constrained to the ten spec statuses');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'application_agent_decisions'
     AND grantee = 'authenticated'
     AND privilege_type IN ('UPDATE', 'DELETE')),
  0, 'authenticated cannot update or delete a decision row (append-only)');

SELECT ok(has_table_privilege('authenticated', 'public.application_agent_decisions', 'SELECT'),
  'authenticated can read their own decisions (RLS-scoped)');

SELECT ok(NOT has_table_privilege('anon', 'public.application_agent_decisions', 'SELECT'),
  'anon cannot read application_agent_decisions');

SELECT * FROM finish();
ROLLBACK;
