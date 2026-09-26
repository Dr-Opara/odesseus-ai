-- Featured listing creation (M6) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M6 featured-listing slice end to end against the real database:
--   * odesseus_create_featured_listing computes the paid visibility window
--     from the tier (7 / 14 / 30 days) and stores the listing with the
--     money-verified payment intent,
--   * creation is idempotent on stripe_payment_intent: a replay returns the
--     original listing instead of creating a duplicate,
--   * the featured job must belong to the paying organization,
--   * unknown tiers, missing orgs, and empty payment intents fail closed,
--   * the RPC is service-role-only and featured_listings keeps its single
--     member-read policy (no write policies added).
--
-- Visibility note: the RPC inserts inside its statement. Row-returning calls
-- therefore capture listing ids into temp tables first (separate statements),
-- so the follow-up SELECT can read the row its snapshot would otherwise miss.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(25);

-- ---------------------------------------------------------------------------
-- Fixture: two orgs, two jobs (one job in the paying org, one elsewhere)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'aaaaaaaa-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'featured-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner user');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    'aaaaaaaa-2222-4222-8222-222222222222',
    'Featured Org A',
    'aaaaaaaa-1111-4111-8111-111111111111')$$,
  'create featured org A');

SELECT lives_ok(
  $$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES (
    'aaaaaaaa-3333-4333-8333-333333333333',
    'Featured Org B',
    'aaaaaaaa-1111-4111-8111-111111111111')$$,
  'create featured org B');

SELECT lives_ok(
  $$INSERT INTO public.employer_jobs (id, org_id, title, status)
  VALUES (
    'aaaaaaaa-4444-4444-8444-444444444444',
    'aaaaaaaa-2222-4222-8222-222222222222',
    'Engineer in Org A',
    'draft')$$,
  'create job in org A');

SELECT lives_ok(
  $$INSERT INTO public.employer_jobs (id, org_id, title, status)
  VALUES (
    'aaaaaaaa-5555-4555-8555-555555555555',
    'aaaaaaaa-3333-4333-8333-333333333333',
    'Engineer in Org B',
    'draft')$$,
  'create job in org B');

-- ---------------------------------------------------------------------------
-- 7-day tier
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$CREATE TEMP TABLE tmp_feat_7d AS
  SELECT listing_id, expires_at FROM public.odesseus_create_featured_listing(
    'aaaaaaaa-2222-4222-8222-222222222222',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'featured_7d', 'pi_featured_7d')$$,
  'create 7-day listing (captures id)');

SELECT is(
  (SELECT expires_at - starts_at FROM public.featured_listings
   WHERE id = (SELECT listing_id FROM tmp_feat_7d)),
  interval '7 days',
  'featured_7d listing is created with a 7-day visibility window');

SELECT is(
  (SELECT tier FROM public.featured_listings
   WHERE id = (SELECT listing_id FROM tmp_feat_7d)),
  'featured_7d', 'tier is persisted on the listing');

SELECT is(
  (SELECT is_active FROM public.featured_listings
   WHERE id = (SELECT listing_id FROM tmp_feat_7d)),
  true, 'new listing is active');

-- ---------------------------------------------------------------------------
-- Idempotency: replaying the same payment intent returns the original listing
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$CREATE TEMP TABLE tmp_feat_7d_replay AS
  SELECT listing_id FROM public.odesseus_create_featured_listing(
    'aaaaaaaa-2222-4222-8222-222222222222',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'featured_7d', 'pi_featured_7d')$$,
  'replay the same payment intent (captures id)');

SELECT is(
  (SELECT listing_id FROM tmp_feat_7d_replay),
  (SELECT listing_id FROM tmp_feat_7d),
  'replaying the same payment intent returns the original listing id');

SELECT is(
  (SELECT count(*)::int FROM public.featured_listings
   WHERE stripe_payment_intent = 'pi_featured_7d'),
  1, 'replay does not create a duplicate listing row');

-- ---------------------------------------------------------------------------
-- 14-day and 30-day tiers
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$CREATE TEMP TABLE tmp_feat_14d AS
  SELECT listing_id FROM public.odesseus_create_featured_listing(
    'aaaaaaaa-2222-4222-8222-222222222222',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'featured_14d', 'pi_featured_14d')$$,
  'create 14-day listing (captures id)');

SELECT is(
  (SELECT expires_at - starts_at FROM public.featured_listings
   WHERE id = (SELECT listing_id FROM tmp_feat_14d)),
  interval '14 days',
  'featured_14d listing is created with a 14-day visibility window');

SELECT lives_ok(
  $$CREATE TEMP TABLE tmp_feat_ai AS
  SELECT listing_id FROM public.odesseus_create_featured_listing(
    'aaaaaaaa-2222-4222-8222-222222222222',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'ai_30d', 'pi_featured_ai_30d')$$,
  'create 30-day AI listing (captures id)');

SELECT is(
  (SELECT expires_at - starts_at FROM public.featured_listings
   WHERE id = (SELECT listing_id FROM tmp_feat_ai)),
  interval '30 days',
  'ai_30d listing is created with a 30-day visibility window');

-- ---------------------------------------------------------------------------
-- Ownership gate
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT listing_id FROM public.odesseus_create_featured_listing(
      'aaaaaaaa-2222-4222-8222-222222222222',
      'aaaaaaaa-5555-4555-8555-555555555555',
      'featured_7d', 'pi_cross_org')$$,
  NULL, 'featured job not found in this organization',
  'an org cannot feature a job that belongs to a different org');

SELECT throws_ok(
  $$SELECT listing_id FROM public.odesseus_create_featured_listing(
      'aaaaaaaa-2222-4222-8222-222222222222',
      '99999999-9999-4999-8999-999999999999',
      'featured_7d', 'pi_missing_job')$$,
  NULL, 'featured job not found in this organization',
  'a nonexistent job fails closed');

-- ---------------------------------------------------------------------------
-- Fail-closed validation
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT listing_id FROM public.odesseus_create_featured_listing(
      'aaaaaaaa-2222-4222-8222-222222222222',
      'aaaaaaaa-4444-4444-8444-444444444444',
      'platinum', 'pi_bad_tier')$$,
  NULL, 'unknown featured tier: platinum',
  'unknown featured tier is rejected');

SELECT throws_ok(
  $$SELECT listing_id FROM public.odesseus_create_featured_listing(
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-4444-4444-8444-444444444444',
      'featured_7d', 'pi_bad_org')$$,
  NULL, 'employer organization not found',
  'missing organization fails closed');

SELECT throws_ok(
  $$SELECT listing_id FROM public.odesseus_create_featured_listing(
      'aaaaaaaa-2222-4222-8222-222222222222',
      'aaaaaaaa-4444-4444-8444-444444444444',
      'featured_7d', '')$$,
  NULL, 'a stripe payment intent is required',
  'missing payment intent fails closed');

-- ---------------------------------------------------------------------------
-- Privileges + RLS contract
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_create_featured_listing(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_create_featured_listing(uuid, uuid, text, text)', 'EXECUTE'),
  'odesseus_create_featured_listing is service-role-only (webhook)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'featured_listings'),
  1, 'featured_listings keeps its single member-read policy (no write policies added)');

SELECT ok(has_table_privilege('authenticated', 'public.featured_listings', 'SELECT'),
  'authenticated may still read featured_listings');
SELECT ok(NOT has_table_privilege('authenticated', 'public.featured_listings', 'INSERT'),
  'authenticated has no table-level INSERT on featured_listings');

SELECT * FROM finish();
ROLLBACK;