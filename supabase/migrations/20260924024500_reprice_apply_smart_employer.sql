-- Approved pricing restructure: Apply / Smart Apply + employer tiers and featured add-ons.
-- This migration updates the localized commercial catalog only. Checkout/entitlement
-- enforcement is intentionally handled separately so existing credits cannot be
-- misapplied between Basic Apply and Smart Apply.

UPDATE public.pricing_products
SET display_name = 'Apply',
    metadata = '{"application_mode":"basic","successful_submission_only":true,"credits_expire":false}'::jsonb,
    updated_at = now()
WHERE product_key = 'candidate_application_single';

UPDATE public.pricing_prices
SET amount_minor = 49, updated_at = now()
WHERE product_key = 'candidate_application_single'
  AND market_key = 'USD_US';

INSERT INTO public.pricing_products
  (product_key, family, display_name, billing_type, billing_period_days, metadata)
VALUES
  ('candidate_smart_apply_single', 'candidate', 'Smart Apply', 'one_time', NULL,
   '{"application_mode":"smart","successful_submission_only":true,"analyzes_jd":true,"selects_best_resume":true,"customizes_resume":true,"generates_answers":true,"submits_application":true}'::jsonb),
  ('employer_growth_bundle', 'employer', 'Employer Growth', 'recurring', 30,
   '{"job_posts":10,"basic_analytics":true,"rollover":false}'::jsonb),
  ('employer_business_bundle', 'employer', 'Employer Business', 'recurring', 30,
   '{"job_posts":25,"ai_matching":true,"multiple_recruiter_seats":true,"rollover":false}'::jsonb),
  ('employer_featured_7', 'employer', 'Featured Job — 7 days', 'one_time', NULL,
   '{"featured_days":7}'::jsonb),
  ('employer_featured_14', 'employer', 'Featured Job — 14 days', 'one_time', NULL,
   '{"featured_days":14}'::jsonb),
  ('employer_ai_featured_30', 'employer', 'AI Featured Job — 30 days', 'one_time', NULL,
   '{"featured_days":30,"ai_matching":true,"targeted_candidate_exposure":true,"candidate_alerts":true,"performance_analytics":true}'::jsonb),
  ('employer_recruiter_seat', 'employer', 'Additional recruiter seat', 'recurring', 30,
   '{"recruiter_seats":1}'::jsonb)
ON CONFLICT (product_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    billing_type = EXCLUDED.billing_type,
    billing_period_days = EXCLUDED.billing_period_days,
    metadata = EXCLUDED.metadata,
    active = true,
    updated_at = now();

UPDATE public.pricing_products
SET display_name = 'Employer Starter',
    metadata = '{"job_posts":3,"rollover":false,"credits_expire_at_cycle_end":true}'::jsonb,
    updated_at = now()
WHERE product_key = 'employer_starter_bundle';

-- Old application packs become commercially invalid once Basic Apply is $0.49.
-- Keep historical rows for auditability but stop offering them.
UPDATE public.pricing_products
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'employer_addon_post'
);

INSERT INTO public.pricing_prices
  (product_key, market_key, currency, amount_minor, metadata)
VALUES
  ('candidate_smart_apply_single', 'USD_US', 'USD', 199, '{"kind":"reference"}'),
  ('employer_growth_bundle', 'USD_US', 'USD', 14900, '{"kind":"reference"}'),
  ('employer_business_bundle', 'USD_US', 'USD', 29900, '{"kind":"reference"}'),
  ('employer_featured_7', 'USD_US', 'USD', 2900, '{"kind":"reference"}'),
  ('employer_featured_14', 'USD_US', 'USD', 4900, '{"kind":"reference"}'),
  ('employer_ai_featured_30', 'USD_US', 'USD', 12900, '{"kind":"reference"}'),
  ('employer_recruiter_seat', 'USD_US', 'USD', 2000, '{"kind":"reference"}')
ON CONFLICT (product_key, market_key) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    metadata = EXCLUDED.metadata,
    active = true,
    updated_at = now();

UPDATE public.pricing_prices
SET amount_minor = 7900, active = true, updated_at = now()
WHERE product_key = 'employer_starter_bundle'
  AND market_key = 'USD_US';

UPDATE public.pricing_prices
SET active = false, updated_at = now()
WHERE product_key IN (
  'candidate_application_pack_25',
  'candidate_application_pack_50',
  'candidate_application_pack_100',
  'employer_addon_post'
);
