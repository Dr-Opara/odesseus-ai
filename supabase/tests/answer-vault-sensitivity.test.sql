-- Answer Vault sensitivity + equivalence safeguards (Phase 2E) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the 20261020000000_answer_vault_sensitivity.sql slice:
--   * application_answer_vault gains normalized_intent,
--     sensitivity_classification (constrained to 'standard'), and
--     approved_at, additively,
--   * existing RLS/ownership on the table is untouched by the migration.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'cccccccc-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'vault-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create user 1');

SELECT has_column('public', 'application_answer_vault', 'normalized_intent', 'normalized_intent column exists');
SELECT has_column('public', 'application_answer_vault', 'sensitivity_classification', 'sensitivity_classification column exists');
SELECT has_column('public', 'application_answer_vault', 'approved_at', 'approved_at column exists');

SELECT lives_ok(
  $$INSERT INTO public.application_answer_vault
    (user_id, answer_key, label, category, answer_text, normalized_intent, approved_at)
  VALUES (
    'cccccccc-1111-4111-8111-111111111111', 'work_authorization_us',
    'Are you authorized to work in the US?', 'work_authorization',
    'Yes, I am a US citizen.', 'authorized us work', now())$$,
  'insert a vault row with a standard sensitivity classification (the default)');

SELECT is(
  (SELECT sensitivity_classification FROM public.application_answer_vault
   WHERE user_id = 'cccccccc-1111-4111-8111-111111111111'),
  'standard', 'sensitivity_classification defaults to standard');

SELECT throws_ok(
  $$UPDATE public.application_answer_vault
   SET sensitivity_classification = 'sensitive'
   WHERE user_id = 'cccccccc-1111-4111-8111-111111111111'$$,
  '23514', NULL,
  'a vault row can never be marked sensitive — the write-path must exclude it entirely, not flag it here');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.application_answer_vault'::regclass),
  'RLS remains enabled on application_answer_vault after the additive migration');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'application_answer_vault'
     AND 'anon' = ANY (roles)),
  0, 'no application_answer_vault policy targets anon');

SELECT * FROM finish();
ROLLBACK;
