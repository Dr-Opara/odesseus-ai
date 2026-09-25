-- Current pricing contract + wallet/employer database tests (pgTAP).
-- Run with: npx supabase test db
--
-- Covers the current pricing contract (Path A, Gate 0 closed):
--   * canonical products + reusable markets + integer-minor-unit prices,
--   * legacy credit products deactivated in place (never deleted),
--   * candidate wallet (credit_balances.wallet_balance_cents) + ledger audit
--     (credit_transactions.balance_cents_after),
--   * wallet credit-type CHECK widening on credit_transactions, credit_ledger
--     and billing_events,
--   * wallet branch of odesseus_private.apply_credit_transaction(),
--   * employer / featured / recruiter tables, RLS, and grants,
--   * employer tier grant + featured-expiry RPCs.
--
-- Fallback semantics (country unmapped / market inactive / missing country)
-- live in src/lib/pricing/service.ts and are covered by the vitest suites;
-- this file proves the database shapes the service depends on.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(132);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'pricing_products', 'pricing_products exists');
SELECT has_table('public', 'pricing_markets', 'pricing_markets exists');
SELECT has_table('public', 'pricing_prices', 'pricing_prices exists');
SELECT has_table('public', 'pricing_country_markets', 'pricing_country_markets exists');

SELECT is(
  (SELECT format_type(a.atttypid, a.atttypmod)
   FROM pg_attribute a
   WHERE a.attrelid = 'public.pricing_prices'::regclass AND a.attname = 'amount_minor'),
  'integer', 'amount_minor is an integer column (minor units, never a float)');

SELECT is(
  (SELECT count(*)::int
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname LIKE 'pricing\_%'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid IN ('pg_catalog.numeric'::regtype,
                        'pg_catalog.float4'::regtype,
                        'pg_catalog.float8'::regtype)),
  0, 'no float/numeric column exists in any pricing table');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname = 'pricing_prices_amount_minor_check'
     AND pg_get_constraintdef(oid) LIKE '%amount_minor%> 0%'),
  1, 'amount_minor is enforced positive');

SELECT columns_are('public', 'pricing_products', ARRAY[
  'product_key', 'family', 'display_name', 'billing_type',
  'billing_period_days', 'active', 'metadata', 'created_at', 'updated_at'
]);
SELECT columns_are('public', 'pricing_markets', ARRAY[
  'market_key', 'name', 'currency', 'locale', 'region',
  'active', 'created_at', 'updated_at'
]);
SELECT columns_are('public', 'pricing_prices', ARRAY[
  'id', 'product_key', 'market_key', 'currency', 'amount_minor', 'active',
  'effective_from', 'effective_until', 'stripe_price_id', 'stripe_product_id',
  'metadata', 'created_at', 'updated_at'
]);
SELECT columns_are('public', 'pricing_country_markets', ARRAY[
  'country_code', 'market_key', 'created_at', 'updated_at'
]);

SELECT is(
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pricing_prices'
     AND column_name = 'metadata'),
  '''{}''::jsonb', 'metadata defaults to an empty jsonb object');

-- ---------------------------------------------------------------------------
-- Wallet + ledger schema shape
-- ---------------------------------------------------------------------------
SELECT columns_are('public', 'credit_balances', ARRAY[
  'user_id', 'application_credits', 'interview_passes',
  'updated_at', 'live_unlimited_until', 'wallet_balance_cents'
]);

SELECT is(
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credit_balances'
     AND column_name = 'wallet_balance_cents'),
  '0', 'wallet_balance_cents defaults to 0');

SELECT ok((SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.credit_balances'::regclass
    AND attname = 'wallet_balance_cents'),
  'wallet_balance_cents is NOT NULL');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname = 'credit_balances_wallet_non_negative'
     AND pg_get_constraintdef(oid) LIKE '%wallet_balance_cents%>= 0%'),
  1, 'wallet_balance_cents cannot go negative');

SELECT has_column('public', 'credit_transactions', 'balance_cents_after',
  'balance_cents_after audit column exists on credit_transactions');

SELECT ok(NOT (SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.credit_transactions'::regclass
    AND attname = 'balance_cents_after'),
  'balance_cents_after is nullable — NULL for non-wallet rows');

-- ---------------------------------------------------------------------------
-- RLS and grants — pricing tables
-- ---------------------------------------------------------------------------
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pricing_products'::regclass),
  'RLS is enabled on pricing_products');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pricing_markets'::regclass),
  'RLS is enabled on pricing_markets');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pricing_prices'::regclass),
  'RLS is enabled on pricing_prices');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pricing_country_markets'::regclass),
  'RLS is enabled on pricing_country_markets');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'pricing\_%'),
  4, 'exactly one policy per pricing table (four total)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'pricing\_%'
     AND cmd = 'SELECT'),
  4, 'every pricing policy is SELECT-only');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'pricing\_%'
     AND roles = ARRAY['anon', 'authenticated']::name[]),
  4, 'every pricing policy targets anon and authenticated');

SELECT ok(has_table_privilege('anon', 'public.pricing_products', 'SELECT'),
  'anon can read pricing_products');
SELECT ok(has_table_privilege('anon', 'public.pricing_markets', 'SELECT'),
  'anon can read pricing_markets');
SELECT ok(has_table_privilege('anon', 'public.pricing_prices', 'SELECT'),
  'anon can read pricing_prices');
SELECT ok(has_table_privilege('anon', 'public.pricing_country_markets', 'SELECT'),
  'anon can read pricing_country_markets');

SELECT ok(NOT has_table_privilege('anon', 'public.pricing_products', 'INSERT'),
  'anon cannot insert pricing_products');
SELECT ok(NOT has_table_privilege('anon', 'public.pricing_markets', 'INSERT'),
  'anon cannot insert pricing_markets');
SELECT ok(NOT has_table_privilege('anon', 'public.pricing_prices', 'INSERT'),
  'anon cannot insert pricing_prices');
SELECT ok(NOT has_table_privilege('anon', 'public.pricing_country_markets', 'INSERT'),
  'anon cannot insert pricing_country_markets');

SELECT ok(NOT has_table_privilege('authenticated', 'public.pricing_products', 'UPDATE'),
  'authenticated cannot update pricing_products');
SELECT ok(NOT has_table_privilege('authenticated', 'public.pricing_markets', 'UPDATE'),
  'authenticated cannot update pricing_markets');
SELECT ok(NOT has_table_privilege('authenticated', 'public.pricing_prices', 'UPDATE'),
  'authenticated cannot update pricing_prices');
SELECT ok(NOT has_table_privilege('authenticated', 'public.pricing_country_markets', 'UPDATE'),
  'authenticated cannot update pricing_country_markets');

SELECT ok(NOT has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'profiles remain private — no client can read another user''s data');

-- ---------------------------------------------------------------------------
-- RLS and grants — employer / featured / recruiter tables
-- ---------------------------------------------------------------------------
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employer_organizations'::regclass),
  'RLS is enabled on employer_organizations');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employer_members'::regclass),
  'RLS is enabled on employer_members');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employer_subscriptions'::regclass),
  'RLS is enabled on employer_subscriptions');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employer_job_post_credits'::regclass),
  'RLS is enabled on employer_job_post_credits');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.job_post_credit_ledger'::regclass),
  'RLS is enabled on job_post_credit_ledger');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.featured_listings'::regclass),
  'RLS is enabled on featured_listings');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recruiter_seats'::regclass),
  'RLS is enabled on recruiter_seats');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_organizations'),
  4, 'employer_organizations has owner/member CRUD policies');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_members'),
  4, 'employer_members has member/owner policies');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_subscriptions'),
  1, 'employer_subscriptions is read-only for clients (one SELECT policy)');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employer_job_post_credits'),
  1, 'employer_job_post_credits is read-only for clients');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'job_post_credit_ledger'),
  1, 'job_post_credit_ledger is read-only for clients');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'featured_listings'),
  1, 'featured_listings is read-only for clients');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'recruiter_seats'),
  1, 'recruiter_seats is read-only for clients');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN (
     'employer_organizations', 'employer_members', 'employer_subscriptions',
     'employer_job_post_credits', 'job_post_credit_ledger',
     'featured_listings', 'recruiter_seats')
     AND 'anon' = ANY (roles)),
  0, 'no employer policy targets anon — all are authenticated-scoped');

SELECT ok(has_table_privilege('authenticated', 'public.employer_organizations', 'SELECT'),
  'authenticated can read employer_organizations (member-scoped by RLS)');
SELECT ok(has_table_privilege('authenticated', 'public.employer_subscriptions', 'SELECT'),
  'authenticated can read employer_subscriptions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_subscriptions', 'INSERT'),
  'authenticated cannot insert employer_subscriptions (webhook-only)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.employer_job_post_credits', 'UPDATE'),
  'authenticated cannot mutate employer_job_post_credits');

SELECT is(
  (SELECT count(*)::int
   FROM pg_class c
   JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
   WHERE c.relname IN (
     'employer_organizations', 'employer_members', 'employer_subscriptions',
     'employer_job_post_credits', 'job_post_credit_ledger',
     'featured_listings', 'recruiter_seats')
     AND has_table_privilege('anon', 'public.' || c.relname, 'SELECT')),
  0, 'anon cannot select any employer table');

SELECT ok(has_table_privilege('service_role', 'public.employer_organizations', 'INSERT'),
  'service_role can create employer organizations (webhook/billing paths)');
SELECT ok(has_table_privilege('service_role', 'public.featured_listings', 'INSERT'),
  'service_role can create featured listings (paid purchase flow)');

SELECT ok(has_function_privilege('authenticated', 'odesseus_private.is_org_member(uuid)', 'EXECUTE'),
  'is_org_member is executable by authenticated (used by RLS policies)');
SELECT ok(has_function_privilege('authenticated', 'odesseus_private.is_org_owner(uuid)', 'EXECUTE'),
  'is_org_owner is executable by authenticated');
SELECT ok(has_function_privilege('authenticated', 'odesseus_private.is_org_admin_or_owner(uuid)', 'EXECUTE'),
  'is_org_admin_or_owner is executable by authenticated');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.featured_listings'::regclass AND contype = 'f'),
  2, 'featured_listings has two FKs (org_id + job_id -> employer_jobs, added in M4)');

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.pricing_products), 21,
  '21 canonical products (9 legacy + 12 current-contract)');

SELECT is(
  (SELECT array_agg(product_key ORDER BY product_key) FROM public.pricing_products
   WHERE active),
  ARRAY[
    'candidate_live_annual',
    'candidate_live_pack_3',
    'candidate_live_single',
    'candidate_smart_apply',
    'candidate_standard_apply',
    'employer_business',
    'employer_growth',
    'employer_starter',
    'featured_14d',
    'featured_30d_ai',
    'featured_7d',
    'recruiter_seat_month',
    'wallet_topup_10',
    'wallet_topup_20',
    'wallet_topup_50'
  ],
  'exact active product key set (15)');

SELECT is(
  (SELECT array_agg(product_key ORDER BY product_key) FROM public.pricing_products
   WHERE NOT active),
  ARRAY[
    'candidate_application_pack_100',
    'candidate_application_pack_25',
    'candidate_application_pack_50',
    'candidate_application_single',
    'employer_addon_post',
    'employer_starter_bundle'
  ],
  'legacy credit products are deactivated in place — exactly six, never deleted');

SELECT is((SELECT count(*)::int FROM public.pricing_products WHERE NOT active), 6,
  'six inactive products');

SELECT is((SELECT count(DISTINCT family)::int FROM public.pricing_products), 2,
  'two product families (candidate, employer)');

SELECT is(
  (SELECT billing_type FROM public.pricing_products
   WHERE product_key = 'employer_starter'),
  'recurring', 'employer starter plan is recurring');

SELECT is(
  (SELECT billing_period_days FROM public.pricing_products
   WHERE product_key = 'employer_starter'),
  30, 'employer starter plan recurs every 30 days');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.pricing_products
  WHERE billing_type = 'one_time' AND billing_period_days IS NOT NULL),
  'one-time products never carry a billing period');

SELECT ok(EXISTS (
  SELECT 1 FROM public.pricing_products
  WHERE product_key = 'candidate_standard_apply'
    AND metadata->>'charge_type' = 'apply_rate'
    AND metadata->>'mode' = 'standard'
    AND NOT (metadata->>'credits_expire')::boolean),
  'Standard Apply is a 49¢ apply-rate product with non-expiring charges');

SELECT is(
  (SELECT metadata->>'mode' FROM public.pricing_products
   WHERE product_key = 'candidate_smart_apply'),
  'smart', 'Smart Apply carries the smart execution mode');

SELECT is(
  (SELECT metadata->>'legacy_sku' FROM public.pricing_products
   WHERE product_key = 'wallet_topup_10'),
  'wallet_10', 'wallet top-up products carry their legacy SKU in metadata');

SELECT is(
  (SELECT array_agg(metadata->>'jobs' ORDER BY product_key)
   FROM public.pricing_products
   WHERE product_key IN ('employer_starter', 'employer_growth', 'employer_business')),
  ARRAY['25', '10', '3'],
  'employer plans grant 3 / 10 / 25 job posts (Business, Growth, Starter)');

SELECT ok(EXISTS (
  SELECT 1 FROM public.pricing_products
  WHERE product_key = 'featured_7d'
    AND metadata->>'featured_days' = '7' AND metadata->>'ai' = 'false')
  AND EXISTS (
  SELECT 1 FROM public.pricing_products
  WHERE product_key = 'featured_30d_ai'
    AND metadata->>'featured_days' = '30' AND metadata->>'ai' = 'true'),
  'featured listings carry day counts and the AI flag');

SELECT is(
  (SELECT billing_period_days FROM public.pricing_products
   WHERE product_key = 'recruiter_seat_month'),
  30, 'recruiter seat is a monthly recurring product');

SELECT is(
  (SELECT (metadata->>'entitlement_months')::int
   FROM public.pricing_products
   WHERE product_key = 'candidate_live_annual'),
  12, 'candidate live annual grants 12 calendar months (unchanged)');

SELECT is(
  (SELECT count(*)::int FROM public.pricing_products
   WHERE product_key LIKE 'candidate_live\_%' AND active),
  3, 'all three candidate Live products remain active and untouched');

-- ---------------------------------------------------------------------------
-- Markets
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.pricing_markets), 10,
  'ten launch markets');

SELECT is(
  (SELECT array_agg(market_key ORDER BY market_key) FROM public.pricing_markets),
  ARRAY[
    'AUD_AU', 'CAD_CA', 'EUR_EUROZONE', 'GBP_UK', 'GHS_GH',
    'JPY_JP', 'KES_KE', 'NGN_NG', 'USD_US', 'ZAR_ZA'
  ],
  'exact launch market key set');

SELECT is((SELECT currency FROM public.pricing_markets WHERE market_key = 'USD_US'),
  'USD', 'USD_US market is USD');
SELECT is((SELECT currency FROM public.pricing_markets WHERE market_key = 'JPY_JP'),
  'JPY', 'JPY_JP market is JPY (zero-decimal supported)');

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.pricing_prices), 21,
  '21 price rows (12 new + 9 legacy)');

SELECT is((SELECT count(*)::int FROM public.pricing_prices
   WHERE active AND market_key = 'USD_US' AND currency = 'USD'),
  15, 'fifteen active prices on the USD_US market');

SELECT is((SELECT count(*)::int FROM public.pricing_prices
   WHERE NOT active AND market_key = 'USD_US' AND currency = 'USD'),
  6, 'six legacy prices deactivated alongside their products');

SELECT is(
  (SELECT count(*)::int
   FROM public.pricing_prices p
   JOIN (VALUES
     ('candidate_standard_apply', 49),
     ('candidate_smart_apply', 199),
     ('wallet_topup_10', 1000),
     ('wallet_topup_20', 2000),
     ('wallet_topup_50', 5000),
     ('employer_starter', 7900),
     ('employer_growth', 14900),
     ('employer_business', 29900),
     ('featured_7d', 2900),
     ('featured_14d', 4900),
     ('featured_30d_ai', 12900),
     ('recruiter_seat_month', 2000)
   ) AS e(product_key, amount_minor) USING (product_key, amount_minor)
   WHERE p.active),
  12, 'all twelve new approved reference USD prices stored exactly (minor units)');

SELECT is(
  (SELECT count(*)::int
   FROM public.pricing_prices p
   JOIN (VALUES
     ('candidate_application_single', 99),
     ('candidate_application_pack_25', 2000),
     ('candidate_application_pack_50', 3500),
     ('candidate_application_pack_100', 5900),
     ('employer_starter_bundle', 10000),
     ('employer_addon_post', 1000)
   ) AS e(product_key, amount_minor) USING (product_key, amount_minor)),
  6, 'legacy prices keep their original amounts (inactive, never deleted)');

SELECT is(
  (SELECT count(*)::int
   FROM public.pricing_prices p
   JOIN (VALUES
     ('candidate_live_single', 2499),
     ('candidate_live_pack_3', 5999),
     ('candidate_live_annual', 49900)
   ) AS e(product_key, amount_minor) USING (product_key, amount_minor)
   WHERE p.active),
  3, 'Live reference prices are unchanged byte-for-byte (2499/5999/49900)');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.pricing_prices p
  JOIN public.pricing_markets m ON m.market_key = p.market_key
  WHERE p.currency <> m.currency),
  'a price currency always equals its market currency (composite FK)');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname IN (
     'pricing_prices_product_fkey',
     'pricing_prices_currency_market_fkey',
     'pricing_country_markets_country_fkey',
     'pricing_country_markets_market_fkey'
   )),
  4, 'all four pricing foreign keys exist');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname IN (
     'pricing_products_product_key_check',
     'pricing_products_family_check',
     'pricing_products_billing_type_check',
     'pricing_products_period_consistency_check',
     'pricing_markets_market_key_check',
     'pricing_markets_currency_check',
     'pricing_prices_currency_check',
     'pricing_prices_effective_window_check'
   )),
  8, 'format and consistency CHECK constraints exist');

-- ---------------------------------------------------------------------------
-- Country → market mappings
-- ---------------------------------------------------------------------------
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'US'),
  'USD_US', 'United States maps to USD_US');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'GB'),
  'GBP_UK', 'United Kingdom maps to GBP_UK');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'CA'),
  'CAD_CA', 'Canada maps to CAD_CA');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'NG'),
  'NGN_NG', 'Nigeria maps to NGN_NG');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'GH'),
  'GHS_GH', 'Ghana maps to GHS_GH');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'KE'),
  'KES_KE', 'Kenya maps to KES_KE');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'ZA'),
  'ZAR_ZA', 'South Africa maps to ZAR_ZA');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'AU'),
  'AUD_AU', 'Australia maps to AUD_AU');
SELECT is((SELECT market_key FROM public.pricing_country_markets WHERE country_code = 'JP'),
  'JPY_JP', 'Japan maps to JPY_JP');

SELECT is(
  (SELECT count(*)::int FROM public.pricing_country_markets pm
   JOIN public.countries c ON c.code = pm.country_code
   WHERE pm.market_key = 'EUR_EUROZONE'),
  (SELECT count(*)::int FROM public.countries WHERE default_currency = 'EUR'),
  'every EUR-currency country is grouped into EUR_EUROZONE (data-driven)');

SELECT is(
  (SELECT count(*)::int FROM public.pricing_country_markets),
  (SELECT 9 + count(*)::int FROM public.countries WHERE default_currency = 'EUR'),
  'mapping rows = 9 explicit markets + the full Eurozone block');

SELECT is(
  (SELECT count(*)::int FROM public.pricing_country_markets WHERE country_code = 'IN'),
  0, 'India has no mapping row — fallback reference pricing applies');

-- ---------------------------------------------------------------------------
-- Stripe-readiness and effective windows stay optional
-- ---------------------------------------------------------------------------
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'public.pricing_prices'::regclass
    AND attname IN ('stripe_price_id', 'stripe_product_id')
    AND attnotnull),
  'Stripe identifier columns are nullable (wiring is optional)');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'public.pricing_prices'::regclass
    AND attname IN ('effective_from', 'effective_until')
    AND attnotnull),
  'effective-window columns are nullable');

-- ---------------------------------------------------------------------------
-- Wallet credit-type CHECK widening
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT pg_get_constraintdef(oid)
   FROM pg_constraint WHERE conname = 'credit_transactions_credit_type_check')
  LIKE '%wallet_topup%standard_apply%smart_apply%',
  'credit_transactions admits wallet_topup / standard_apply / smart_apply');

SELECT ok(
  (SELECT pg_get_constraintdef(oid)
   FROM pg_constraint WHERE conname = 'credit_ledger_credit_type_check')
  LIKE '%wallet_topup%standard_apply%smart_apply%',
  'odesseus_private.credit_ledger admits the wallet credit types');

SELECT ok(
  (SELECT pg_get_constraintdef(oid)
   FROM pg_constraint WHERE conname = 'billing_events_credit_type_check')
  LIKE '%wallet_topup%',
  'billing_events admits wallet_topup purchases');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname = 'credit_transactions_wallet_amount_check'
     AND pg_get_constraintdef(oid) LIKE '%abs(delta)%'),
  1, 'wallet-typed transactions must carry amount_cents = abs(delta)');

-- ---------------------------------------------------------------------------
-- Trigger behavior: wallet branch
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'wallet-pgtap@example.com',
  'not-a-real-password', now(), now(), now());

SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'wallet_topup', 1000, 'test topup', 1000, 'pgtap-topup-1')$$,
  'wallet top-up inserts (delta +1000, amount_cents 1000)');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1000, 'wallet top-up credits the wallet in cents');

SELECT is(
  (SELECT balance_cents_after FROM public.credit_transactions
   WHERE external_reference = 'pgtap-topup-1'),
  1000, 'trigger records balance_cents_after on the top-up row');

SELECT is(
  (SELECT count(*)::int FROM odesseus_private.credit_ledger
   WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
     AND credit_type = 'wallet_topup'),
  1, 'top-up is mirrored to the private credit ledger');

SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'standard_apply', -49, 'successful application', 49, 'pgtap-apply-1')$$,
  'standard apply debit inserts (delta −49)');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  951, 'standard apply debits 49¢ from the wallet');

SELECT is(
  (SELECT balance_cents_after FROM public.credit_transactions
   WHERE external_reference = 'pgtap-apply-1'),
  951, 'apply debit records the post-debit balance');

SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'smart_apply', -199, 'successful smart application', 199, 'pgtap-apply-2')$$,
  'smart apply debit inserts (delta −199)');

SELECT is(
  (SELECT wallet_balance_cents FROM public.credit_balances
   WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  752, 'smart apply debits 199¢ from the wallet');

SELECT throws_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, amount_cents, external_reference)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'standard_apply', -900, 'would overdraw', 900, 'pgtap-overdraw')$$,
  NULL, 'insufficient wallet balance',
  'overdrawing the wallet raises and rolls back');

SELECT lives_ok(
  $$INSERT INTO public.credit_transactions
    (user_id, credit_type, delta, reason, external_reference)
  VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'application', 1, 'legacy credit grant', 'pgtap-credit-1')$$,
  'non-wallet credit rows still insert (application path unchanged)');

SELECT is(
  (SELECT application_credits FROM public.credit_balances
   WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1, 'application credits still tracked separately from the wallet');

SELECT is(
  (SELECT balance_cents_after FROM public.credit_transactions
   WHERE external_reference = 'pgtap-credit-1'),
  NULL, 'non-wallet rows keep balance_cents_after NULL');

-- ---------------------------------------------------------------------------
-- Employer / featured RPCs
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('service_role', 'public.grant_employer_tier_job_posts(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.grant_employer_tier_job_posts(uuid, text)', 'EXECUTE'),
  'grant_employer_tier_job_posts is service-role-only (webhook)');

SELECT ok(
  has_function_privilege('service_role', 'public.expire_ended_featured_listings()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.expire_ended_featured_listings()', 'EXECUTE'),
  'expire_ended_featured_listings is service-role-only (scheduled job)');

INSERT INTO public.employer_organizations (id, name, owner_user_id)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'PgTAP Employer Inc.',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

SELECT is(
  (SELECT total FROM public.grant_employer_tier_job_posts(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'starter')),
  3, 'starter tier grant returns 3 job-post credits');

SELECT is(
  (SELECT total FROM public.employer_job_post_credits
   WHERE org_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  3, 'credit grant row stores total 3');

SELECT is(
  (SELECT delta FROM public.job_post_credit_ledger
   WHERE org_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
     AND reason = 'tier_grant'),
  3, 'tier grant is mirrored to the job-post credit ledger');

SELECT throws_ok(
  $$SELECT public.grant_employer_tier_job_posts(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'platinum')$$,
  NULL, 'unknown employer tier: platinum',
  'unknown tier is rejected');

INSERT INTO public.employer_jobs (id, org_id, title, status)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Draft fixture job',
  'draft');

INSERT INTO public.featured_listings
  (org_id, job_id, tier, starts_at, expires_at, is_active)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'featured_7d',
  now() - interval '10 days',
  now() - interval '1 day',
  true);

SELECT is(
  (SELECT expired FROM public.expire_ended_featured_listings()),
  1, 'expiry job expires the ended listing');

SELECT is(
  (SELECT is_active FROM public.featured_listings
   WHERE job_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  false, 'expired listing is marked inactive');

SELECT * FROM finish();
ROLLBACK;