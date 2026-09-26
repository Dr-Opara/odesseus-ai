-- M9 RLS audit (pgTAP).
-- Run with: npx supabase test db
--
-- A systematic sweep of the public schema's security posture:
--   * every public table has ROW LEVEL SECURITY enabled and at least one
--     policy (a bare table with no policy would silently leak nothing to
--     anon but grant all rows to every role with privileges),
--   * the anon grant surface is empty except for public reference catalog
--     (countries + pricing_*) which anon may only SELECT,
--   * server-only tables (admin_users, partner_*) carry zero anon or
--     authenticated privileges after the M9 hardening migration,
--   * every table is covered by one of: own-row auth.uid() scoping,
--     org-helper scoping, anon-readable reference data, or an all-denied
--     browser surface (server-only),
--   * the resumes bucket stays private: storage.objects only ever carries
--     resume_files_* own-scoped policies,
--   * the odesseus_private schema is unreachable by anon/authenticated.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(19);

-- ---------------------------------------------------------------------------
-- 1. Baseline inventory
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> 'schema_migrations'),
  55, 'public schema holds exactly 55 tables (audit inventory is current)');

SELECT is(
  (SELECT count(*)::int FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> 'schema_migrations'
     AND c.relrowsecurity = false),
  0, 'no public table runs without row-level security');

SELECT is(
  (SELECT count(*)::int FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> 'schema_migrations'
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = c.relname)),
  0, 'every public table has at least one policy');

-- ---------------------------------------------------------------------------
-- 2. Anonymous grant surface (post-M9 hardening)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
       'REFERENCES', 'TRIGGER', 'MAINTAIN')),
  0, 'anon holds no write/reference privileges on any public table');

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT DISTINCT table_name FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee = 'anon' AND privilege_type = 'SELECT'
     EXCEPT
     SELECT unnest(ARRAY[
       'countries', 'pricing_products', 'pricing_markets',
       'pricing_prices', 'pricing_country_markets'])
   ) leaked),
  0, 'anon may SELECT only the public reference tables (countries, pricing_*)');

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT table_name FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee = 'anon' AND privilege_type = 'SELECT'
     INTERSECT
     SELECT unnest(ARRAY[
       'countries', 'pricing_products', 'pricing_markets',
       'pricing_prices', 'pricing_country_markets'])
   ) readable),
  5, 'all five reference tables remain readable by anon');

-- ---------------------------------------------------------------------------
-- 3. Server-only tables: no anon/authenticated privileges after M9
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'admin_users'
     AND grantee IN ('anon', 'authenticated')),
  0, 'admin_users carries no anon/authenticated privileges (M9)');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'partners'
     AND grantee IN ('anon', 'authenticated')),
  0, 'partners carries no anon/authenticated privileges (M9)');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'partner_applications'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
       'REFERENCES', 'TRIGGER', 'MAINTAIN')),
  0, 'partner_applications is write-unreachable for browsers (M9)');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'partner_earnings'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0, 'partner_earnings is fully unreachable for browsers (M9)');

-- ---------------------------------------------------------------------------
-- 4. Coverage: every table is own-row scoped, org-helper scoped,
--    reference-readable, or server-denied
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> 'schema_migrations'
     AND NOT (
       -- (a) own-row auth.uid() or org-helper scoping
       EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname
           AND p.roles @> ARRAY['authenticated']::name[]
           AND (coalesce(p.qual, '') LIKE '%auth.uid()%'
             OR coalesce(p.with_check, '') LIKE '%auth.uid()%'
             OR coalesce(p.qual, '') LIKE '%is_org_%'
             OR coalesce(p.with_check, '') LIKE '%is_org_%'))
       OR
       -- (b) anon-readable reference data
       EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname
           AND p.qual = 'true' AND p.cmd = 'SELECT'
           AND (p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['authenticated']::name[]))
       OR
       -- (c) server-denied: every browser-targeted policy is a deny
       NOT EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname
           AND (p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['authenticated']::name[])
           AND p.qual <> 'false')
     )),
  0, 'every public table is covered by own-row, org-helper, reference, or deny scoping');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND roles @> ARRAY['anon']::name[] AND qual = 'true'
     AND tablename NOT IN (
       'countries', 'pricing_products', 'pricing_markets',
       'pricing_prices', 'pricing_country_markets')),
  0, 'no policy grants anon blanket rows outside the public reference tables');

-- ---------------------------------------------------------------------------
-- 5. Core candidate tables stay own-row scoped
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT unnest(ARRAY['profiles', 'applications', 'interviews', 'resumes']) AS t
     INTERSECT
     SELECT DISTINCT p.tablename FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.roles @> ARRAY['authenticated']::name[]
       AND (coalesce(p.qual, '') LIKE '%auth.uid()%'
         OR coalesce(p.with_check, '') LIKE '%auth.uid()%')
   ) scoped),
  4, 'profiles, applications, interviews, resumes are auth.uid()-scoped');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('profiles', 'job_opportunities', 'resumes', 'job_reports',
       'notification_preferences')
     AND roles @> ARRAY['anon']::name[]),
  0, 'no anon policy targets core candidate tables');

-- ---------------------------------------------------------------------------
-- 6. Resumes storage stays private
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'),
  4, 'storage.objects carries exactly the four resume_files_* policies');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'resume\_files\_%'),
  0, 'no storage.objects policy besides resume_files_* exists');

-- ---------------------------------------------------------------------------
-- 7. Private schema is unreachable by browser roles
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'odesseus_private'
     AND grantee IN ('anon', 'authenticated')),
  0, 'odesseus_private tables carry no anon/authenticated privileges');

-- ---------------------------------------------------------------------------
-- 8. The admin audit log is append-only, and not writable by anyone who could
--    forge an entry. The table grants no INSERT, UPDATE or DELETE to any role,
--    so the only write path is the SECURITY DEFINER RPC. A log an admin can
--    edit is not evidence of anything.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'no role may insert into, update, or delete an admin_audit_log row');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type = 'SELECT'),
  0, 'browser roles may not read the admin audit log');

SELECT * FROM finish();
ROLLBACK;