-- Spec employer pricing (pgTAP).
-- Run with: npx supabase test db
--
-- Proves 20261124000000_spec_employer_pricing.sql against the real database:
--   * the AI Starter Bundle grants 5 base credits expiring at the cycle end,
--   * a $10 add-on grant gets its own 30-day clock and is idempotent,
--   * publishing spends the credit that expires soonest and starts a 30-day
--     job clock; pausing never moves it; reactivating inside it is free,
--   * an expired job can be reposted with a new credit; a closed job can't be
--     reopened,
--   * the expiry job relaunches auto-renew posts with a credit, and expires
--     them when none is left,
--   * add-ons are purchasable only with an active AI Starter Bundle.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES ('e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'spec-employer@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create employer owner');

SELECT lives_ok($$INSERT INTO public.employer_organizations (id, name, owner_user_id)
  VALUES ('e2000000-0000-4000-8000-000000000001', 'Spec Hiring Co',
    'e1000000-0000-4000-8000-000000000001')$$,
  'create employer organization');

SELECT is(
  public.odesseus_employer_can_buy_addons('e2000000-0000-4000-8000-000000000001'),
  false, 'add-ons are not purchasable without an AI Starter Bundle');

-- ---------------------------------------------------------------------------
-- AI Starter Bundle: 5 base credits, expire at cycle end
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT credits_granted FROM public.odesseus_sync_employer_subscription(
    'e2000000-0000-4000-8000-000000000001', 'ai_starter', 'active',
    'sub_spec_ai_1', 'cus_spec_1',
    now() - interval '10 days', now() + interval '20 days', true)),
  5, 'a paid AI Starter Bundle cycle grants 5 base credits');

SELECT is(
  (SELECT kind || ':' || total::text FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001' AND kind = 'base'),
  'base:5', 'the grant is recorded as base credits');

SELECT ok(
  (SELECT expires_at FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001' AND kind = 'base')
    BETWEEN now() + interval '19 days 23 hours' AND now() + interval '20 days 1 hour',
  'base credits expire at the billing-cycle end (no rollover)');

SELECT is(
  public.odesseus_employer_can_buy_addons('e2000000-0000-4000-8000-000000000001'),
  true, 'add-ons are purchasable with an active AI Starter Bundle');

-- ---------------------------------------------------------------------------
-- Add-on credits: own 30-day clock, idempotent
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT credits_granted FROM public.odesseus_grant_employer_addon_credits(
    'e2000000-0000-4000-8000-000000000001', 2, 'cs_spec_addon_1', now())),
  2, 'two $10 add-on credits are granted');

SELECT ok(
  (SELECT expires_at FROM public.employer_job_post_credits
   WHERE external_reference = 'addon:cs_spec_addon_1')
    BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour',
  'add-on credits expire 30 days after purchase, independent of the cycle');

SELECT is(
  (SELECT already_granted FROM public.odesseus_grant_employer_addon_credits(
    'e2000000-0000-4000-8000-000000000001', 2, 'cs_spec_addon_1', now())),
  true, 'replaying the same checkout grants nothing new');

SELECT is(
  (SELECT count(*)::int FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001' AND kind = 'addon'),
  1, 'exactly one add-on grant row exists');

SELECT throws_ok(
  $$SELECT * FROM public.odesseus_grant_employer_addon_credits(
    'e2000000-0000-4000-8000-000000000001', 0, 'cs_spec_addon_bad', now())$$,
  NULL, 'add-on quantity must be between 1 and 100',
  'a zero-quantity add-on is refused');

-- ---------------------------------------------------------------------------
-- Publish: soonest-expiring credit, 30-day job clock
-- ---------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO public.employer_jobs (id, org_id, title, status)
  VALUES ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    'Security Engineer', 'published')$$,
  'publishing a job succeeds');

SELECT is(
  (SELECT used FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001' AND kind = 'base'),
  1, 'the base credit (expiring sooner) is spent before the add-on');

SELECT ok(
  (SELECT expires_at FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001')
    BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour',
  'publishing starts a fresh 30-day job clock');

SELECT is(
  (SELECT post_cycle FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  1, 'the first posting window is cycle 1');

-- ---------------------------------------------------------------------------
-- Pause / reactivate: free, clock unchanged
-- ---------------------------------------------------------------------------
SELECT lives_ok($$UPDATE public.employer_jobs SET status = 'paused'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'an active job can be paused');

SELECT lives_ok($$UPDATE public.employer_jobs SET status = 'published'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'a paused job can be reactivated inside its window');

SELECT is(
  (SELECT sum(used)::int FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001'),
  1, 'reactivating inside the window consumes no credit');

SELECT is(
  (SELECT post_cycle FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  1, 'reactivating never opens a new posting window');

-- ---------------------------------------------------------------------------
-- Expiry, repost and auto-renew
-- ---------------------------------------------------------------------------
-- Age the post past its window, then run the expiry job.
SELECT lives_ok($$UPDATE public.employer_jobs
  SET expires_at = now() - interval '1 minute'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'age the post past its 30-day window');

SELECT is(
  (SELECT outcome FROM public.odesseus_process_expired_employer_jobs(500)
   WHERE job_id = 'e3000000-0000-4000-8000-000000000001'),
  'expired', 'a post without auto-renew expires at the end of its window');

SELECT is(
  (SELECT status FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  'expired', 'the job is now expired (hidden from candidates)');

SELECT lives_ok($$UPDATE public.employer_jobs SET status = 'published'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'an expired job can be reposted');

SELECT is(
  (SELECT post_cycle FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  2, 'reposting opens a second posting window');

SELECT is(
  (SELECT sum(used)::int FROM public.employer_job_post_credits
   WHERE org_id = 'e2000000-0000-4000-8000-000000000001'),
  2, 'reposting consumes a new credit');

-- Auto-renew with a credit available.
SELECT lives_ok($$UPDATE public.employer_jobs
  SET auto_renew = true, expires_at = now() - interval '1 minute'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'turn on auto-renew and age the post');

SELECT is(
  (SELECT outcome FROM public.odesseus_process_expired_employer_jobs(500)
   WHERE job_id = 'e3000000-0000-4000-8000-000000000001'),
  'renewed', 'an auto-renew post relaunches when a credit is available');

SELECT is(
  (SELECT status || ':' || post_cycle::text FROM public.employer_jobs
   WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  'published:3', 'the relaunched post is active in a third window');

-- Auto-renew with no credit left: spend everything, then expire.
SELECT lives_ok($$UPDATE public.employer_job_post_credits SET used = total
  WHERE org_id = 'e2000000-0000-4000-8000-000000000001'$$,
  'exhaust every credit');

SELECT lives_ok($$UPDATE public.employer_jobs
  SET expires_at = now() - interval '1 minute'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'age the post again');

SELECT is(
  (SELECT outcome FROM public.odesseus_process_expired_employer_jobs(500)
   WHERE job_id = 'e3000000-0000-4000-8000-000000000001'),
  'renewal_failed', 'auto-renew without a credit reports renewal_failed');

SELECT is(
  (SELECT status FROM public.employer_jobs WHERE id = 'e3000000-0000-4000-8000-000000000001'),
  'expired', 'and the post expires instead of staying live');

-- ---------------------------------------------------------------------------
-- Filled / Closed is permanent
-- ---------------------------------------------------------------------------
SELECT lives_ok($$UPDATE public.employer_jobs SET status = 'closed', closed_reason = 'filled'
  WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  'a job can be marked filled');

SELECT throws_ok(
  $$UPDATE public.employer_jobs SET status = 'published'
    WHERE id = 'e3000000-0000-4000-8000-000000000001'$$,
  NULL, 'a closed job cannot be reopened',
  'a filled/closed job can never be reopened');

SELECT * FROM finish();
ROLLBACK;
