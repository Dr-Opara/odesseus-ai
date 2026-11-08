/**
 * Pricing engine constants shared by the service and API routes.
 *
 * The fallback market is the deterministic safety net for every unresolved
 * case (missing country, unmapped country, inactive market, unauthenticated
 * visitor). It carries the approved reference prices, so an unconfigured
 * market never silently returns an incorrect or invented price — it returns
 * the documented reference price instead.
 */
export const FALLBACK_MARKET_KEY = "USD_US";

/**
 * Why a visitor's market resolved the way it did. Exposed on the API so the
 * frontend can explain fallbacks honestly instead of assuming a price.
 */
export const MARKET_REASONS = {
  /** The visitor's country mapped to an active pricing market. */
  MARKET_OK: "market_ok",
  /** The visitor is signed in but has no usable country yet. */
  COUNTRY_MISSING: "country_missing",
  /** The supplied country code was malformed / not ISO alpha-2. */
  MALFORMED_COUNTRY: "malformed_country",
  /** Country is valid but has no row in pricing_country_markets. */
  COUNTRY_UNMAPPED: "country_unmapped",
  /** Country mapped to a market that is currently inactive. */
  MARKET_INACTIVE: "market_inactive",
  /** The visitor is not signed in; the fallback market applies. */
  UNAUTHENTICATED: "unauthenticated",
  /** Signed in but the profile row could not be loaded. */
  PROFILE_UNAVAILABLE: "profile_unavailable",
  /** Even the fallback market is inactive — no price can be resolved. */
  FALLBACK_INACTIVE: "fallback_inactive",
} as const;

export type MarketReason = (typeof MARKET_REASONS)[keyof typeof MARKET_REASONS];

/** Why a specific product has no price in this response. */
export const UNAVAILABLE_REASONS = {
  /** The product exists but is not currently sold. */
  PRODUCT_INACTIVE: "product_inactive",
  /** No price row exists for any market (should be rare with a fallback). */
  NO_PRICE: "no_price",
  /** No active market could be resolved at all. */
  MARKET_INACTIVE: "market_inactive",
} as const;

export type UnavailableReason =
  (typeof UNAVAILABLE_REASONS)[keyof typeof UNAVAILABLE_REASONS];

/**
 * Machine-readable product keys of the current pricing contract.
 *
 * Applications are paid with prepaid application credits
 * (`candidate_application_*`: $0.99 single, 25 = $20, 50 = $35, 100 = $59)
 * and Odesseus Live with one-time passes (`candidate_live_*`: $24.99 single,
 * 3 = $59.99, Annual $499). The wallet top-ups, the per-mode apply rates and
 * the Live subscription products are flipped to `active = false` by
 * 20261123000000_spec_candidate_pricing.sql rather than deleted, so they stay
 * resolvable by key for history while never being offered for sale.
 *
 * This list is a typing/ownership reference only — runtime resolution is
 * driven by the `pricing_products.active` column, and request keys are
 * validated by `PRODUCT_KEY_PATTERN`.
 */
export const PRODUCT_KEYS = [
  // Candidate application credits (1 credit = 1 verified submission).
  "candidate_application_single",
  "candidate_application_pack_25",
  "candidate_application_pack_50",
  "candidate_application_pack_100",
  // Odesseus Live passes (one-time).
  "candidate_live_single",
  "candidate_live_pack_3",
  "candidate_live_annual",
  // Employer plans (recurring).
  "employer_starter",
  "employer_growth",
  "employer_business",
  // Featured listings (one-time).
  "featured_7d",
  "featured_14d",
  "ai_30d",
  // Recruiter seat (recurring per seat).
  "recruiter_seat_month",
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const PRODUCT_KEY_PATTERN = /^[a-z0-9_]+$/;