-- Employer jobs + subscription quota sync (M4) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M4 employer-side slice end to end against the real database:
--   * public.employer_jobs exists, is RLS-protected, and is owner/admin-writable,
--   * publishing a job consumes exactly one job-post credit (claim trigger),
--   * drafts never consume; publishing a saved draft does; re-publishing a
--     closed job never consumes twice (ledger ref is the choke point),
--   * exhausted credits raise and roll the posting back,
--   * featured_listings.job_id now binds to employer_jobs (the deferred FK),
--   * odesseus_sync_employer_subscription upserts the plan, grants the tier's
--     job-post credits exactly once per paid period (idempotent replays), and
--     is service-role-only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(39);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'employer_jobs', 'employer_jobs exists');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employer_jobs'::regclass),
  'RLS is enabled on employer_jobs');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_jobs'),
  4, 'employer_jobs has select-member + admin/owner write policies');

SELECT ok(has_table_privilege('authenticated', 'public.employer_jobs', 'SELECT'),
  'authenticated can read employer_jobs (member-scoped by RLS)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_jobs', 'INSERT'),
  'authenticated has no table-level INSERT (RLS WITH CHECK governs)');
SELECT ok(has_table_privilege('service_role', 'public.employer_jobs', 'INSERT'),
  'service_role can insert employer_jobs (billing/seed paths)');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.featured_listings'::regclass AND contype = 'f'),
  2, 'featured_listings now has two FKs (org_id + job_id)');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.featured_listings'::regclass
      AND conname = 'featured_listings_job_id_fkey'
      AND confrelid = 'public.employer_jobs'::regclass),
  'featured_listings.job_id FKs to employer_jobs (deferred FK resolved)');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'odesseus_private'
    WHERE p.proname = 'claim_job_post_credit'),
  'claim_job_post_credit trigger function exists in odesseus_private');

-- ---------------------------------------------------------------------------
-- Fixture: org owned by user 1 with a starter grant via the sync RPC
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'emp-jobs-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner user');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    '22222222-2222-4222-8222-222222222222',
    'Employee Jobs Inc.',
    '11111111-1111-4111-8111-111111111111')$$,
  'create employer organization');

SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'starter', 'active',
    'sub_starter_1', 'cus_starter_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz, true)),
  3, 'starter invoice sync grants 3 job-post credits');

SELECT is(
  (SELECT status FROM public.employer_subscriptions
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  'active', 'sync upserts the subscription row as active');
SELECT is(
  (SELECT job_posts_included FROM public.employer_subscriptions
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  3, 'sync records job_posts_included = 3 for starter');

-- ---------------------------------------------------------------------------
-- Claim trigger: exactly one credit per published job
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.employer_jobs
    (id, org_id, title, status)
  VALUES (
    '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222222',
    'Draft role A', 'draft')$$,
  'draft job inserts without consuming a credit');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  0, 'no credit consumed by a draft');

SELECT lives_ok(
  $$INSERT INTO public.employer_jobs
    (id, org_id, title, status)
  VALUES (
    '33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222222',
    'Published role B', 'published')$$,
  'publishing a job consumes a credit');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  1, 'one credit consumed after first publish');

SELECT is(
  (SELECT delta FROM public.job_post_credit_ledger
   WHERE org_id = '22222222-2222-4222-8222-222222222222'
     AND reason = 'job_post'
     AND external_reference = 'job_post:33333333-3333-4333-8333-333333333332'),
  -1, 'publish is mirrored to the credit ledger with delta -1');

SELECT lives_ok(
  $$INSERT INTO public.employer_jobs
    (id, org_id, title, status)
  VALUES (
    '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222',
    'Published role C', 'published')$$,
  'publishing a second job works while credits remain');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  2, 'two credits consumed after second publish');

SELECT lives_ok(
  $$UPDATE public.employer_jobs
   SET status = 'published'
   WHERE id = '33333333-3333-4333-8333-333333333331'$$,
  'publishing a saved draft consumes the final credit');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  3, 'all three starter credits consumed');

SELECT throws_ok(
  $$INSERT INTO public.employer_jobs
    (id, org_id, title, status)
  VALUES (
    '33333333-3333-4333-8333-333333333334', '22222222-2222-4222-8222-222222222222',
    'Over-quota role D', 'published')$$,
  NULL, 'no job post credits available for this employer',
  'publishing with zero remaining credits raises and rolls back');

SELECT is(
  (SELECT count(*)::int FROM public.employer_jobs
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  3, 'the over-quota posting is rolled back (no partial row)');

-- Closing then re-publishing the same job must never consume twice: the unique
-- ledger ref 'job_post:<job_id>' is the idempotency choke point.
SELECT lives_ok(
  $$UPDATE public.employer_jobs
   SET status = 'closed'
   WHERE id = '33333333-3333-4333-8333-333333333332'$$,
  'closing a job does not consume a credit');

SELECT lives_ok(
  $$UPDATE public.employer_jobs
   SET status = 'published'
   WHERE id = '33333333-3333-4333-8333-333333333332'$$,
  're-publishing a closed job succeeds (no credit available)');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = '22222222-2222-4222-8222-222222222222'),
  3, 're-publishing consumes no additional credit (idempotent)');

-- ---------------------------------------------------------------------------
-- New billing period: the org renews and gets a fresh cycle
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'starter', 'active',
    'sub_starter_1', 'cus_starter_1',
    '2026-11-01 00:00:00+00'::timestamptz,
    '2026-12-01 00:00:00+00'::timestamptz, true)),
  3, 'renewal period grants a fresh 3-credit cycle');

SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'starter', 'active',
    'sub_starter_1', 'cus_starter_1',
    '2026-10-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz, true)),
  0, 'replaying the same paid period grants nothing (idempotent)');

SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'growth', 'active',
    'sub_growth_1', 'cus_growth_1',
    '2026-12-01 00:00:00+00'::timestamptz,
    '2027-01-01 00:00:00+00'::timestamptz, true)),
  10, 'growth tier grants 10 job-post credits');

SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'business', 'active',
    'sub_business_1', 'cus_business_1',
    '2027-01-01 00:00:00+00'::timestamptz,
    '2027-02-01 00:00:00+00'::timestamptz, true)),
  25, 'business tier grants 25 job-post credits');

SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    '22222222-2222-4222-8222-222222222222', 'starter', 'active',
    'sub_status_only_1', 'cus_status_only_1',
    '2027-02-01 00:00:00+00'::timestamptz,
    '2027-03-01 00:00:00+00'::timestamptz, false)),
  0, 'status-only sync (subscription.updated) never grants credits');

SELECT is(
  (SELECT status FROM public.employer_subscriptions
   WHERE stripe_subscription_id = 'sub_status_only_1'),
  'active', 'status-only sync still upserts the subscription row');

SELECT throws_ok(
  $$SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
      '22222222-2222-4222-8222-222222222222', 'platinum', 'active',
      'sub_bad_1', 'cus_bad_1', now(), now() + interval '30 days', true)$$,
  NULL, 'unknown employer tier: platinum',
  'unknown employer tier is rejected');

SELECT throws_ok(
  $$SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
      '22222222-2222-4222-8222-222222222222', 'starter', 'paused',
      'sub_bad_2', 'cus_bad_2', now(), now() + interval '30 days', true)$$,
  NULL, 'unknown subscription status: paused',
  'unknown subscription status is rejected');

SELECT throws_ok(
  $$SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
      '99999999-9999-4999-8999-999999999999', 'starter', 'active',
      'sub_bad_3', 'cus_bad_3', now(), now() + interval '30 days', true)$$,
  NULL, 'employer organization not found',
  'missing organization fails closed');

SELECT throws_ok(
  $$SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
      '22222222-2222-4222-8222-222222222222', 'starter', 'active',
      '', 'cus_bad_4', now(), now() + interval '30 days', true)$$,
  NULL, 'a stripe subscription id is required to sync',
  'missing stripe subscription id fails closed');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean)', 'EXECUTE'),
  'odesseus_sync_employer_subscription is service-role-only (webhook)');

SELECT * FROM finish();
ROLLBACK;