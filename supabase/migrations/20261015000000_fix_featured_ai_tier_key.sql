-- Fix AI Featured listing product-key mismatch (Phase 13 release-gap closure).
--
-- The live, money-moving path has always used 'ai_30d' for the 30-day AI
-- Featured tier: src/lib/billing/catalog.ts (the Stripe checkout catalog),
-- the featured_listings.tier CHECK constraint, and
-- odesseus_create_featured_listing() all agree on 'ai_30d'. The newer,
-- not-yet-wired localized pricing_products/pricing_prices reference catalog
-- (20260924000000_current_pricing_contract.sql) seeded the same tier under a
-- different key, 'featured_30d_ai'. No frontend reads pricing_products to
-- drive the featured checkout flow yet (confirmed: zero consumers), so this
-- is a pure catalog-key correction against inert reference rows, not a live-
-- data fix. The historical migration is left byte-for-byte unchanged; this
-- re-keys the row instead. No featured_listings purchase row is touched —
-- that table's tier CHECK already only ever accepted 'ai_30d'.
--
-- Re-runnable: a no-op once 'featured_30d_ai' no longer exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pricing_products WHERE product_key = 'featured_30d_ai') THEN
    INSERT INTO public.pricing_products
      (product_key, family, display_name, billing_type, billing_period_days, active, metadata, created_at, updated_at)
    SELECT 'ai_30d', family, display_name, billing_type, billing_period_days, active, metadata, created_at, now()
    FROM public.pricing_products
    WHERE product_key = 'featured_30d_ai'
    ON CONFLICT (product_key) DO NOTHING;

    UPDATE public.pricing_prices
    SET product_key = 'ai_30d', updated_at = now()
    WHERE product_key = 'featured_30d_ai';

    DELETE FROM public.pricing_products WHERE product_key = 'featured_30d_ai';
  END IF;
END $$;
