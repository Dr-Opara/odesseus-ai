-- Stripe webhook delivery observability (M10) (pgTAP).
-- Run with: npx supabase test db
--
-- Proves the M10 webhook-observability slice end to end against the real
-- database:
--   * public.webhook_events is an append-only delivery log: RLS-enabled with
--     a single deny-browser-access policy, no anon/authenticated privileges
--     (M9 hardening posture), full postgres/service_role access,
--   * outcome and http_status are CHECK-constrained server-side, and the
--     logging RPC fails closed on invalid values instead of writing garbage,
--   * user_id follows auth.users with ON DELETE SET NULL so the audit trail
--     survives candidate deletion,
--   * odesseus_log_webhook_event() returns the row id, records nullable
--     stripe_event_id (unparseable deliveries), round-trips details, and is
--     service-role-only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(40);

-- ---------------------------------------------------------------------------
-- Fixture: a candidate whose deletion must not destroy the audit trail
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO auth.users (id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    'bbbbbbbb-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'weblog-u1@example.com',
    'not-a-real-password', now(), now(), now())$$,
  'create a candidate whose webhook events must survive deletion');

-- ---------------------------------------------------------------------------
-- 1. Table shape + RLS posture
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'webhook_events', 'webhook_events table exists');

SELECT is(
  (SELECT relrowsecurity::int FROM pg_class
   WHERE oid = 'public.webhook_events'::regclass),
  1, 'webhook_events has ROW LEVEL SECURITY enabled');

SELECT columns_are('public', 'webhook_events', ARRAY[
  'id', 'stripe_event_id', 'event_type', 'outcome', 'http_status',
  'user_id', 'org_id', 'sku', 'checkout_session_id', 'reason',
  'details', 'created_at']);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'webhook_events'),
  1, 'webhook_events has exactly one policy (the deny-browser-access policy)');

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'webhook_events'
     AND roles @> ARRAY['anon']::name[]
     AND roles @> ARRAY['authenticated']::name[]
     AND qual = 'false' AND with_check = 'false') = 1,
  'the single policy denies both anon and authenticated with USING false + WITH CHECK false');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'webhook_events'
     AND grantee IN ('anon', 'authenticated')),
  0, 'webhook_events carries no anon/authenticated privileges (M9 hardening posture)');

SELECT ok(
  has_table_privilege('service_role', 'public.webhook_events', 'SELECT')
  AND has_table_privilege('service_role', 'public.webhook_events', 'INSERT')
  AND has_table_privilege('service_role', 'public.webhook_events', 'UPDATE')
  AND has_table_privilege('service_role', 'public.webhook_events', 'DELETE'),
  'service_role holds full table privileges');

SELECT ok(
  has_table_privilege('postgres', 'public.webhook_events', 'SELECT')
  AND has_table_privilege('postgres', 'public.webhook_events', 'INSERT'),
  'postgres holds table privileges');

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints enforced server-side
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status) VALUES ('halfway', 200)$$,
  '23514', NULL, 'an unknown outcome violates the outcome CHECK');

SELECT throws_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status) VALUES ('fulfilled', 199)$$,
  '23514', NULL, 'http_status below 200 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status) VALUES ('fulfilled', 600)$$,
  '23514', NULL, 'http_status above 599 violates the range CHECK');

SELECT lives_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status) VALUES ('fulfilled', 200)$$,
  'http_status 200 satisfies the range CHECK');

SELECT lives_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status) VALUES ('errored', 599)$$,
  'http_status 599 satisfies the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.webhook_events (outcome, http_status, reason)
   VALUES ('rejected', 400, repeat('x', 501))$$,
  '23514', NULL, 'reasons longer than 500 chars violate the length CHECK');

-- ---------------------------------------------------------------------------
-- 3. Indexes + FK semantics
-- ---------------------------------------------------------------------------
SELECT has_index('public', 'webhook_events', 'webhook_events_stripe_event_id_idx', 'stripe_event_id');
SELECT has_index('public', 'webhook_events', 'webhook_events_created_at_idx', 'created_at');
SELECT has_index('public', 'webhook_events', 'webhook_events_outcome_idx', 'outcome');

SELECT lives_ok(
  $$INSERT INTO public.webhook_events
     (stripe_event_id, event_type, outcome, http_status, user_id, reason)
   VALUES ('evt_fk_1', 'invoice.paid', 'fulfilled', 200,
     'bbbbbbbb-1111-4111-8111-111111111111', 'audit row for the fixture candidate')$$,
  'insert an audit row referencing the auth fixture');

SELECT lives_ok(
  $$DELETE FROM auth.users WHERE id = 'bbbbbbbb-1111-4111-8111-111111111111'$$,
  'delete the candidate');

SELECT is(
  (SELECT user_id FROM public.webhook_events WHERE stripe_event_id = 'evt_fk_1'),
  NULL, 'deleting the candidate nulls user_id (ON DELETE SET NULL)');

SELECT is(
  (SELECT count(*)::int FROM public.webhook_events WHERE stripe_event_id = 'evt_fk_1'),
  1, 'the audit row survives candidate deletion');

-- ---------------------------------------------------------------------------
-- 4. RPC: presence, security posture, fail-closed validation
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'odesseus_log_webhook_event'::name,
  '{text,text,text,integer,uuid,uuid,text,text,text,jsonb}'::name[],
  'odesseus_log_webhook_event exists');

SELECT function_returns(
  'public', 'odesseus_log_webhook_event'::name,
  '{text,text,text,integer,uuid,uuid,text,text,text,jsonb}'::name[],
  'uuid', 'odesseus_log_webhook_event returns uuid');

SELECT is(
  (SELECT prosecdef::int FROM pg_proc
   WHERE proname = 'odesseus_log_webhook_event'),
  1, 'odesseus_log_webhook_event is SECURITY DEFINER');

SELECT throws_ok(
  $$SELECT public.odesseus_log_webhook_event('evt_bad_1', 'checkout.session.completed', 'nope', 200)$$,
  'P0001', NULL, 'an unknown outcome is rejected by the RPC');

SELECT throws_ok(
  $$SELECT public.odesseus_log_webhook_event('evt_bad_2', 'checkout.session.completed', 'fulfilled', 199)$$,
  'P0001', NULL, 'http_status below 200 is rejected by the RPC');

SELECT throws_ok(
  $$SELECT public.odesseus_log_webhook_event('evt_bad_3', 'checkout.session.completed', 'fulfilled', 600)$$,
  'P0001', NULL, 'http_status above 599 is rejected by the RPC');

SELECT throws_ok(
  $$SELECT public.odesseus_log_webhook_event('evt_bad_4', 'checkout.session.completed', 'fulfilled', NULL)$$,
  'P0001', NULL, 'a NULL http_status is rejected by the RPC');

SELECT ok(
  has_function_privilege('service_role', 'public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.odesseus_log_webhook_event(text, text, text, integer, uuid, uuid, text, text, text, jsonb)', 'EXECUTE'),
  'RPC is executable by service_role only');

-- ---------------------------------------------------------------------------
-- 5. RPC round-trips
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$SELECT public.odesseus_log_webhook_event(
     'evt_full_1', 'charge.refunded', 'fulfilled', 200,
     NULL, NULL, NULL, NULL, 'refund reversal processed',
     '{"attempt": 2}')$$,
  'record a fulfilled delivery with details');

SELECT is(
  (SELECT count(*)::int FROM public.webhook_events WHERE stripe_event_id = 'evt_full_1'),
  1, 'the RPC row is present');

SELECT is(
  (SELECT outcome FROM public.webhook_events WHERE stripe_event_id = 'evt_full_1'),
  'fulfilled', 'the RPC stores the outcome');

SELECT is(
  (SELECT http_status FROM public.webhook_events WHERE stripe_event_id = 'evt_full_1'),
  CAST(200 AS smallint), 'the RPC stores the http_status');

SELECT is(
  (SELECT details FROM public.webhook_events WHERE stripe_event_id = 'evt_full_1'),
  '{"attempt": 2}', 'the RPC round-trips the details jsonb');

SELECT is(
  (SELECT reason FROM public.webhook_events WHERE stripe_event_id = 'evt_full_1'),
  'refund reversal processed', 'the RPC stores the reason');

SELECT lives_ok(
  $$SELECT public.odesseus_log_webhook_event(
     NULL, NULL, 'rejected', 400, NULL, NULL, NULL, NULL,
     'invalid signature (event unparseable)', '{}')$$,
  'record a delivery with no Stripe event id (unparseable signature)');

SELECT is(
  (SELECT count(*)::int FROM public.webhook_events
   WHERE stripe_event_id IS NULL AND outcome = 'rejected'),
  1, 'unparseable deliveries are recorded with a NULL stripe_event_id');

-- Duplicate deliveries append rows: the log is not unique-keyed because
-- Stripe replays event ids and every delivery attempt matters.
SELECT lives_ok(
  $$SELECT public.odesseus_log_webhook_event(
     'evt_dup_1', 'checkout.session.completed', 'duplicate', 200)$$,
  'log a replay of a previously fulfilled event as duplicate');

SELECT is(
  (SELECT count(*)::int FROM public.webhook_events WHERE stripe_event_id = 'evt_dup_1'),
  1, 'each delivery attempt gets its own row');

SELECT * FROM finish();
ROLLBACK;