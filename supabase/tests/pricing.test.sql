-- Phase 2 database/RLS tests (pgTAP).
-- Run with: npx supabase test db
--
-- Covers the localized pricing engine: canonical products, reusable pricing
-- markets, integer-minor-unit prices pinned to their market's currency,
-- country → market mappings (incl. the data-driven Eurozone block), public
-- read-only RLS, and the approved USD reference price set.
--
-- Fallback semantics (country unmapped / market inactive / missing country)
-- live in the application service (src/lib/pricing/service.ts) and are
-- covered by the vitest suites; this file proves the database shapes the
-- service depends on.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(65);

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
-- RLS and grants
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
-- Products
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.pricing_products), 9,
  'nine canonical products');

SELECT is(
  (SELECT array_agg(product_key ORDER BY product_key) FROM public.pricing_products),
  ARRAY[
    'candidate_application_pack_100',
    'candidate_application_pack_25',
    'candidate_application_pack_50',
    'candidate_application_single',
    'candidate_live_annual',
    'candidate_live_pack_3',
    'candidate_live_single',
    'employer_addon_post',
    'employer_starter_bundle'
  ],
  'exact canonical product key set');

SELECT is((SELECT count(*)::int FROM public.pricing_products WHERE NOT active), 0,
  'every seeded product is active');

SELECT is((SELECT count(DISTINCT family)::int FROM public.pricing_products), 2,
  'two product families (candidate, employer)');

SELECT is(
  (SELECT billing_type FROM public.pricing_products
   WHERE product_key = 'employer_starter_bundle'),
  'recurring', 'employer starter bundle is recurring');

SELECT is(
  (SELECT billing_period_days FROM public.pricing_products
   WHERE product_key = 'employer_starter_bundle'),
  30, 'employer starter bundle recurs every 30 days');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.pricing_products
  WHERE billing_type = 'one_time' AND billing_period_days IS NOT NULL),
  'one-time products never carry a billing period');

SELECT ok((SELECT NOT (metadata->>'credits_expire')::boolean
   FROM public.pricing_products
   WHERE product_key = 'candidate_application_pack_25'),
  'application credits never expire (metadata rule present)');

SELECT is(
  (SELECT (metadata->>'entitlement_months')::int
   FROM public.pricing_products
   WHERE product_key = 'candidate_live_annual'),
  12, 'candidate live annual grants 12 calendar months');

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
SELECT is((SELECT count(*)::int FROM public.pricing_prices), 9,
  'nine price rows');

SELECT is((SELECT count(*)::int FROM public.pricing_prices
   WHERE active AND market_key = 'USD_US' AND currency = 'USD'),
  9, 'every price is active, on the USD_US market, in USD');

SELECT is(
  (SELECT count(*)::int
   FROM public.pricing_prices p
   JOIN (VALUES
     ('candidate_application_single', 99),
     ('candidate_application_pack_25', 2000),
     ('candidate_application_pack_50', 3500),
     ('candidate_application_pack_100', 5900),
     ('candidate_live_single', 2499),
     ('candidate_live_pack_3', 5999),
     ('candidate_live_annual', 49900),
     ('employer_starter_bundle', 10000),
     ('employer_addon_post', 1000)
   ) AS e(product_key, amount_minor) USING (product_key, amount_minor)),
  9, 'all nine approved reference USD prices stored exactly (minor units)');

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

SELECT * FROM finish();
ROLLBACK;