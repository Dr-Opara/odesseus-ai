-- Localized currency & pricing engine (Phase 2).
--
-- This migration is additive and safe for existing users:
--   1. Creates `pricing_products`  — canonical machine-readable product catalog.
--   2. Creates `pricing_markets`   — reusable, currency-bound pricing markets.
--   3. Creates `pricing_prices`    — localized prices in integer minor units,
--      optionally mapped to future Stripe price/product IDs.
--   4. Creates `pricing_country_markets` — country → pricing market mapping.
--
-- Money rule: every amount is an integer of the currency's minor units
-- (`amount_minor`). USD $24.99 is stored as 2499; JPY ¥2,500 is stored as
-- 2500 (JPY has zero decimal digits). No floating-point money anywhere.
--
-- Fallback rule: only the USD_US market carries the approved reference
-- prices (see below). Any other market that exists but has no price, and any
-- country with no market mapping, resolves deterministically to the USD_US
-- fallback market. Nothing in the database or application performs FX
-- conversion; localized prices are configured commercial prices.
--
-- Stripe-readiness: `stripe_price_id` / `stripe_product_id` are optional
-- storage identifiers for wiring future Checkout sessions to configured
-- prices. They are never the source of truth for Odesseus pricing and are
-- never returned by the pricing API.
--
-- Deliberate non-changes:
--   * No Phase 1 table, column, policy, or country record is modified.
--   * The existing static billing catalog (src/lib/billing/catalog.ts) and
--     checkout flow are untouched; wiring checkout to this engine is a later
--     phase.
--   * No credit ledger, entitlement-expiry engine, or Live entitlement logic
--     is introduced here. Product rules live in `metadata` only.
--
-- Product rule metadata (informational, enforced by later phases):
--   * candidate_application_* : application credits, NEVER expire.
--   * candidate_live_single / pack_3 : Live passes, NEVER expire.
--   * candidate_live_annual : 12 calendar months from purchase.
--   * employer_starter_bundle : recurring every 30 days, 5 base job-post
--     credits that expire at the end of the billing cycle, no rollover.
--   * employer_addon_post : one extra job-post credit, expires 30 days after
--     purchase.

-- ---------------------------------------------------------------------------
-- 1. pricing_products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_products (
  "product_key"   text                    NOT NULL
                  CONSTRAINT "pricing_products_product_key_check"
                    CHECK ("product_key" ~ '^[a-z0-9_]+$'),
  "family"        text                    NOT NULL
                  CONSTRAINT "pricing_products_family_check"
                    CHECK ("family" IN ('candidate', 'employer')),
  "display_name"  text                    NOT NULL
                  CONSTRAINT "pricing_products_display_name_check"
                    CHECK (length("display_name") > 0),
  "billing_type"  text                    NOT NULL
                  CONSTRAINT "pricing_products_billing_type_check"
                    CHECK ("billing_type" IN ('one_time', 'recurring')),
  "billing_period_days" integer,
  "active"        boolean                 NOT NULL DEFAULT true,
  "metadata"      jsonb                   NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_products_pkey" PRIMARY KEY ("product_key"),
  CONSTRAINT "pricing_products_period_consistency_check" CHECK (
    ("billing_type" = 'recurring' AND "billing_period_days" IS NOT NULL)
    OR ("billing_type" = 'one_time' AND "billing_period_days" IS NULL)
  )
);

COMMENT ON TABLE public.pricing_products IS
  'Canonical Odesseus product catalog. product_key is the stable machine-readable identifier; display_name is cosmetic only.';
COMMENT ON COLUMN public.pricing_products.product_key IS
  'Stable machine-readable product key (e.g. candidate_application_single). Never display-keyed.';
COMMENT ON COLUMN public.pricing_products.metadata IS
  'Informational product rules (credit type, counts, expiry semantics). Enforced by later entitlement phases.';

-- ---------------------------------------------------------------------------
-- 2. pricing_markets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_markets (
  "market_key"    text                    NOT NULL
                  CONSTRAINT "pricing_markets_market_key_check"
                    CHECK ("market_key" ~ '^[A-Z0-9_]+$'),
  "name"          text                    NOT NULL
                  CONSTRAINT "pricing_markets_name_check"
                    CHECK (length("name") > 0),
  "currency"      text                    NOT NULL
                  CONSTRAINT "pricing_markets_currency_check"
                    CHECK ("currency" ~ '^[A-Z]{3}$'),
  "locale"        text                    NOT NULL
                  CONSTRAINT "pricing_markets_locale_check"
                    CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  "region"        text
                  CONSTRAINT "pricing_markets_region_check"
                    CHECK ("region" IS NULL OR length("region") > 0),
  "active"        boolean                 NOT NULL DEFAULT true,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_markets_pkey" PRIMARY KEY ("market_key"),
  CONSTRAINT "pricing_markets_currency_uniq"
    UNIQUE ("market_key", "currency")
);

COMMENT ON TABLE public.pricing_markets IS
  'Reusable commercial pricing markets. One market may group many countries; a single country can later be overridden via pricing_country_markets.';
COMMENT ON COLUMN public.pricing_markets.locale IS
  'Default formatting context (BCP-47) for this market, e.g. ja-JP for JPY zero-decimal display.';

-- ---------------------------------------------------------------------------
-- 3. pricing_prices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_prices (
  "id"            uuid                    NOT NULL DEFAULT gen_random_uuid(),
  "product_key"   text                    NOT NULL,
  "market_key"    text                    NOT NULL,
  "currency"      text                    NOT NULL
                  CONSTRAINT "pricing_prices_currency_check"
                    CHECK ("currency" ~ '^[A-Z]{3}$'),
  "amount_minor"  integer                 NOT NULL
                  CONSTRAINT "pricing_prices_amount_minor_check"
                    CHECK ("amount_minor" > 0),
  "active"        boolean                 NOT NULL DEFAULT true,
  "effective_from" timestamp with time zone,
  "effective_until" timestamp with time zone,
  "stripe_price_id"   text,
  "stripe_product_id" text,
  "metadata"      jsonb                   NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_prices_product_market_uniq"
    UNIQUE ("product_key", "market_key"),
  CONSTRAINT "pricing_prices_product_fkey"
    FOREIGN KEY ("product_key")
    REFERENCES public.pricing_products ("product_key") ON DELETE RESTRICT,
  CONSTRAINT "pricing_prices_currency_market_fkey"
    FOREIGN KEY ("market_key", "currency")
    REFERENCES public.pricing_markets ("market_key", "currency") ON DELETE RESTRICT,
  CONSTRAINT "pricing_prices_effective_window_check" CHECK (
    "effective_from" IS NULL
    OR "effective_until" IS NULL
    OR "effective_from" < "effective_until"
  )
);

CREATE INDEX IF NOT EXISTS "pricing_prices_market_key_idx"
  ON public.pricing_prices ("market_key");
CREATE INDEX IF NOT EXISTS "pricing_prices_stripe_price_id_idx"
  ON public.pricing_prices ("stripe_price_id")
  WHERE "stripe_price_id" IS NOT NULL;

COMMENT ON TABLE public.pricing_prices IS
  'Configurable localized prices in integer minor units. A price is bound to exactly one product and one market; currency is enforced to equal the market currency by a composite FK.';
COMMENT ON COLUMN public.pricing_prices.amount_minor IS
  'Monetary amount in the currency minor units, integer only (USD $24.99 = 2499; JPY zero-decimal ¥2,500 = 2500). Never a float.';
COMMENT ON COLUMN public.pricing_prices.stripe_price_id IS
  'Optional Stripe Price ID for later checkout wiring. Not a secret, but never returned by the pricing API.';
COMMENT ON COLUMN public.pricing_prices.stripe_product_id IS
  'Optional Stripe Product ID for later checkout wiring. Not a secret, but never returned by the pricing API.';

-- ---------------------------------------------------------------------------
-- 4. pricing_country_markets — country → pricing market mapping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_country_markets (
  "country_code"  text                    NOT NULL,
  "market_key"    text                    NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_country_markets_pkey" PRIMARY KEY ("country_code"),
  CONSTRAINT "pricing_country_markets_country_fkey"
    FOREIGN KEY ("country_code")
    REFERENCES public.countries ("code") ON DELETE CASCADE,
  CONSTRAINT "pricing_country_markets_market_fkey"
    FOREIGN KEY ("market_key")
    REFERENCES public.pricing_markets ("market_key") ON DELETE RESTRICT
);

COMMENT ON TABLE public.pricing_country_markets IS
  'Default pricing market per country. A country with no row resolves to the configured fallback market (see pricing service / docs).';

-- ---------------------------------------------------------------------------
-- RLS: publicly readable reference data, read-only for clients.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pricing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_country_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pricing_products_select_public"
  ON public.pricing_products
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "pricing_markets_select_public"
  ON public.pricing_markets
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "pricing_prices_select_public"
  ON public.pricing_prices
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "pricing_country_markets_select_public"
  ON public.pricing_country_markets
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Clients may never create prices, markets, products, or mappings. Only the
-- service role (RLS-bypassing) and postgres may mutate the catalog.
REVOKE ALL ON TABLE public.pricing_products FROM anon;
REVOKE ALL ON TABLE public.pricing_products FROM authenticated;
REVOKE ALL ON TABLE public.pricing_markets FROM anon;
REVOKE ALL ON TABLE public.pricing_markets FROM authenticated;
REVOKE ALL ON TABLE public.pricing_prices FROM anon;
REVOKE ALL ON TABLE public.pricing_prices FROM authenticated;
REVOKE ALL ON TABLE public.pricing_country_markets FROM anon;
REVOKE ALL ON TABLE public.pricing_country_markets FROM authenticated;

GRANT SELECT ON TABLE public.pricing_products TO anon, authenticated;
GRANT SELECT ON TABLE public.pricing_markets TO anon, authenticated;
GRANT SELECT ON TABLE public.pricing_prices TO anon, authenticated;
GRANT SELECT ON TABLE public.pricing_country_markets TO anon, authenticated;

GRANT ALL ON TABLE public.pricing_products TO postgres, service_role;
GRANT ALL ON TABLE public.pricing_markets TO postgres, service_role;
GRANT ALL ON TABLE public.pricing_prices TO postgres, service_role;
GRANT ALL ON TABLE public.pricing_country_markets TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Seed: canonical products (approved by product decision)
-- ---------------------------------------------------------------------------

INSERT INTO public.pricing_products
  (product_key, family, display_name, billing_type, billing_period_days, metadata)
VALUES
  ('candidate_application_single',  'candidate', 'Single application credit',          'one_time',  NULL,
   '{"credit_type":"application","credits":1,"credits_expire":false,"legacy_sku":"app_1"}'),
  ('candidate_application_pack_25', 'candidate', '25 application credits',             'one_time',  NULL,
   '{"credit_type":"application","credits":25,"credits_expire":false,"legacy_sku":"app_25"}'),
  ('candidate_application_pack_50', 'candidate', '50 application credits',             'one_time',  NULL,
   '{"credit_type":"application","credits":50,"credits_expire":false,"legacy_sku":"app_50"}'),
  ('candidate_application_pack_100','candidate', '100 application credits',            'one_time',  NULL,
   '{"credit_type":"application","credits":100,"credits_expire":false,"legacy_sku":"app_100"}'),
  ('candidate_live_single',         'candidate', 'Odesseus Live — single session',     'one_time',  NULL,
   '{"credit_type":"interview","passes":1,"passes_expire":false,"legacy_sku":"interview_1"}'),
  ('candidate_live_pack_3',         'candidate', 'Odesseus Live — 3 sessions',         'one_time',  NULL,
   '{"credit_type":"interview","passes":3,"passes_expire":false,"legacy_sku":"interview_3"}'),
  ('candidate_live_annual',         'candidate', 'Odesseus Live annual',               'one_time',  NULL,
   '{"credit_type":"interview","entitlement":"12 calendar months from purchase","entitlement_months":12,"legacy_sku":"interview_annual"}'),
  ('employer_starter_bundle',       'employer',  'Employer starter bundle',            'recurring', 30,
   '{"credit_type":"job_post","credits":5,"rollover":false,"credits_expire_at_cycle_end":true,"billing_period_days":30}'),
  ('employer_addon_post',           'employer',  'Employer job-post add-on',           'one_time',  NULL,
   '{"credit_type":"job_post","credits":1,"expires_days":30}')
ON CONFLICT (product_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: initial pricing markets (10)
-- ---------------------------------------------------------------------------
-- These are the Phase 2 launch markets. Any country outside them (or any
-- market without a configured price) resolves to the USD_US fallback until
-- deliberate commercial prices are set for that market.

INSERT INTO public.pricing_markets (market_key, name, currency, locale, region)
VALUES
  ('USD_US',        'United States (USD)',        'USD', 'en-US', 'NORTH_AMERICA'),
  ('GBP_UK',        'United Kingdom (GBP)',       'GBP', 'en-GB', 'EUROPE'),
  ('CAD_CA',        'Canada (CAD)',               'CAD', 'en-CA', 'NORTH_AMERICA'),
  ('NGN_NG',        'Nigeria (NGN)',              'NGN', 'en-NG', 'AFRICA'),
  ('GHS_GH',        'Ghana (GHS)',                'GHS', 'en-GH', 'AFRICA'),
  ('KES_KE',        'Kenya (KES)',                'KES', 'en-KE', 'AFRICA'),
  ('ZAR_ZA',        'South Africa (ZAR)',         'ZAR', 'en-ZA', 'AFRICA'),
  ('EUR_EUROZONE',  'Eurozone (EUR)',             'EUR', 'en-IE', 'EUROPE'),
  ('AUD_AU',        'Australia (AUD)',            'AUD', 'en-AU', 'OCEANIA'),
  ('JPY_JP',        'Japan (JPY)',                'JPY', 'ja-JP', 'ASIA')
ON CONFLICT (market_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: approved reference prices (USD_US only)
-- ---------------------------------------------------------------------------
-- These nine rows are the APPROVED reference prices in integer minor units.
-- Other markets carry NO price rows yet: they resolve through the USD_US
-- fallback (documented provisional strategy) until real commercial prices
-- are approved and inserted as new rows here.

INSERT INTO public.pricing_prices
  (product_key, market_key, currency, amount_minor, stripe_price_id, stripe_product_id, metadata)
VALUES
  ('candidate_application_single',   'USD_US', 'USD',    99, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_application_pack_25',  'USD_US', 'USD',  2000, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_application_pack_50',  'USD_US', 'USD',  3500, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_application_pack_100', 'USD_US', 'USD',  5900, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_live_single',          'USD_US', 'USD',  2499, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_live_pack_3',          'USD_US', 'USD',  5999, NULL, NULL, '{"kind":"reference"}'),
  ('candidate_live_annual',          'USD_US', 'USD', 49900, NULL, NULL, '{"kind":"reference"}'),
  ('employer_starter_bundle',        'USD_US', 'USD', 10000, NULL, NULL, '{"kind":"reference"}'),
  ('employer_addon_post',            'USD_US', 'USD',  1000, NULL, NULL, '{"kind":"reference"}')
ON CONFLICT (product_key, market_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: country → market mappings
-- ---------------------------------------------------------------------------
-- Data-driven first: every territory whose Phase 1 default currency is EUR
-- joins the shared EUROZONE market (no 241-row hand-maintained list).
-- Explicit overrides follow; add a row here to give one country its own
-- market without touching application code.

INSERT INTO public.pricing_country_markets (country_code, market_key)
SELECT code, 'EUR_EUROZONE'
FROM public.countries
WHERE default_currency = 'EUR'
ON CONFLICT (country_code) DO NOTHING;

INSERT INTO public.pricing_country_markets (country_code, market_key)
VALUES
  ('US', 'USD_US'),
  ('GB', 'GBP_UK'),
  ('CA', 'CAD_CA'),
  ('NG', 'NGN_NG'),
  ('GH', 'GHS_GH'),
  ('KE', 'KES_KE'),
  ('ZA', 'ZAR_ZA'),
  ('AU', 'AUD_AU'),
  ('JP', 'JPY_JP')
ON CONFLICT (country_code) DO NOTHING;