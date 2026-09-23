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

/** Machine-readable product keys from the canonical catalog. */
export const PRODUCT_KEYS = [
  "candidate_application_single",
  "candidate_application_pack_25",
  "candidate_application_pack_50",
  "candidate_application_pack_100",
  "candidate_live_single",
  "candidate_live_pack_3",
  "candidate_live_annual",
  "employer_starter_bundle",
  "employer_addon_post",
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const PRODUCT_KEY_PATTERN = /^[a-z0-9_]+$/;