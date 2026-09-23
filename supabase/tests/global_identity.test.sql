-- Phase 1 database/RLS tests (pgTAP).
-- Run with: npx supabase test db
--
-- Covers: additive schema shape, nullable localization columns, canonical
-- countries dataset, RLS + grants on countries, unchanged owner-only profile
-- policies, CHECK enforcement, and the absence of US/GB/CA pinning columns.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(45);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'countries', 'countries table exists');
SELECT columns_are('public', 'countries', ARRAY[
  'code', 'name', 'default_currency', 'default_locale',
  'calling_code', 'active', 'created_at', 'updated_at'
]);
SELECT has_column('public', 'profiles', 'location',
  'legacy free-text location column is preserved');

SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'country_code'),
  'profiles.country_code is nullable');
SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'locale'),
  'profiles.locale is nullable');
SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'preferred_currency'),
  'profiles.preferred_currency is nullable');
SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'timezone'),
  'profiles.timezone is nullable');
SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'preferred_language'),
  'profiles.preferred_language is nullable');
SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attname = 'application_contact_email'),
  'profiles.application_contact_email is nullable');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint WHERE conname IN (
    'profiles_country_code_check',
    'profiles_locale_check',
    'profiles_preferred_currency_check',
    'profiles_timezone_check',
    'profiles_preferred_language_check',
    'profiles_application_contact_email_check'
  )),
  6, 'six profile format CHECK constraints exist');
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname = 'profiles_country_code_fkey'),
  1, 'country_code references countries(code)');

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.countries'::regclass),
  'RLS is enabled on countries');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'countries'),
  1, 'countries has exactly one policy');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'countries' AND cmd = 'SELECT'),
  1, 'the countries policy is SELECT-only');
SELECT is(
  (SELECT roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'countries'),
  ARRAY['anon', 'authenticated']::name[],
  'countries is readable by anon and authenticated');

SELECT ok(has_table_privilege('anon', 'public.countries', 'SELECT'),
  'anon can read countries');
SELECT ok(NOT has_table_privilege('anon', 'public.countries', 'INSERT'),
  'anon cannot insert countries');
SELECT ok(NOT has_table_privilege('authenticated', 'public.countries', 'UPDATE'),
  'authenticated cannot update countries');
SELECT ok(NOT has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon cannot read profiles, so the contact email stays private');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'),
  4, 'profiles still has exactly the original owner-only policies');

-- ---------------------------------------------------------------------------
-- Seed data quality
-- ---------------------------------------------------------------------------
SELECT ok((SELECT count(*) FROM public.countries) >= 240,
  'global dataset is seeded');
SELECT is((SELECT count(*)::int FROM public.countries WHERE active), 241,
  'exactly 241 active territories');
SELECT is((SELECT bool_and(active) FROM public.countries
  WHERE code IN ('US', 'GB', 'CA')), true,
  'US, GB, and CA are active');

-- Mojibake regression: the six previously-corrupted canonical names must be
-- stored byte-exact in the database.
SELECT is((SELECT name FROM public.countries WHERE code = 'AX'), 'Åland Islands',
  'AX name is Åland Islands');
SELECT is((SELECT name FROM public.countries WHERE code = 'BL'), 'Saint Barthélemy',
  'BL name is Saint Barthélemy');
SELECT is((SELECT name FROM public.countries WHERE code = 'CW'), 'Curaçao',
  'CW name is Curaçao');
SELECT is((SELECT name FROM public.countries WHERE code = 'RE'), 'Réunion',
  'RE name is Réunion');
SELECT is((SELECT name FROM public.countries WHERE code = 'ST'), 'São Tomé and Príncipe',
  'ST name is São Tomé and Príncipe');
SELECT is((SELECT name FROM public.countries WHERE code = 'TR'), 'Türkiye',
  'TR name is Türkiye');

-- Class-level guard: no mojibake marker may appear in ANY country name
-- (chr(195)=Ã, chr(194)=Â, chr(65533)=U+FFFD), not just in the six known rows.
SELECT is((SELECT count(*)::int FROM public.countries
  WHERE STRPOS(name, chr(195)) > 0
     OR STRPOS(name, chr(194)) > 0
     OR STRPOS(name, chr(65533)) > 0), 0,
  'no mojibake markers in any country name');

-- Launch-market policy: TR stays active; AX, BL, CW, RE, and ST remain valid
-- canonical records but ship inactive for V1.
SELECT ok((SELECT active FROM public.countries WHERE code = 'TR'),
  'TR (Türkiye) is active for V1');
SELECT is((SELECT count(*)::int FROM public.countries
  WHERE code IN ('AX', 'BL', 'CW', 'RE', 'ST') AND active), 0,
  'AX, BL, CW, RE, ST are withheld (active = false) for V1');
SELECT is((SELECT count(*)::int FROM public.countries
  WHERE code IN ('US', 'GB', 'CA')), 3,
  'US, GB, and CA exist as ordinary rows');
SELECT ok((SELECT count(*) FROM public.countries WHERE code = 'NG') = 1,
  'coverage extends beyond US/GB/CA (Nigeria present)');
SELECT ok((SELECT count(*) FROM public.countries WHERE code = 'DE') = 1,
  'Germany present');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.countries WHERE code !~ '^[A-Z]{2}$'),
  'every country code is ISO alpha-2');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.countries WHERE default_currency !~ '^[A-Z]{3}$'),
  'every default currency is a three-letter code');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.countries WHERE default_locale
    !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  'every default locale is well-formed');

SELECT hasnt_column('public', 'countries', 'pinned',
  'no pinned flag exists in the database');
SELECT hasnt_column('public', 'countries', 'priority',
  'no priority flag exists in the database');

-- ---------------------------------------------------------------------------
-- CHECK enforcement on a real profile row
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'phase1-test@example.com',
  'not-a-real-password', now(), now(), now());

INSERT INTO public.profiles (id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

SELECT throws_ok(
  $$UPDATE public.profiles SET country_code = 'USA'
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', NULL, 'invalid country code rejected by CHECK');

SELECT lives_ok(
  $$UPDATE public.profiles SET
      country_code = 'DE',
      locale = 'de-DE',
      preferred_currency = 'EUR',
      timezone = 'Europe/Berlin',
      preferred_language = 'de',
      application_contact_email = 'candidate@example.com'
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'valid localization values accepted');

SELECT throws_ok(
  $$UPDATE public.profiles SET application_contact_email = 'not-an-email'
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', NULL, 'invalid contact email rejected by CHECK');

SELECT lives_ok(
  $$UPDATE public.profiles SET
      country_code = NULL, locale = NULL, preferred_currency = NULL,
      timezone = NULL, preferred_language = NULL,
      application_contact_email = NULL
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'all six columns accept NULL for existing-user compatibility');

SELECT throws_ok(
  $$INSERT INTO public.countries (code, name, default_currency, default_locale)
    VALUES ('USA', 'Bad row', 'USD', 'en-US')$$,
  '23514', NULL, 'countries rejects non alpha-2 codes');

SELECT * FROM finish();
ROLLBACK;
