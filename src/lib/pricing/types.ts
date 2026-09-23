import type { MarketReason, UnavailableReason } from "./config";

/** Row shape for `pricing_products` as the pricing engine needs it. */
export type PricingProduct = {
  product_key: string;
  family: string;
  display_name: string;
  billing_type: string;
  billing_period_days: number | null;
  active: boolean;
  metadata: Record<string, unknown>;
};

/** Row shape for `pricing_markets` as the pricing engine needs it. */
export type PricingMarket = {
  market_key: string;
  name: string;
  currency: string;
  locale: string;
  region: string | null;
  active: boolean;
};

/** Row shape for `pricing_prices` as the pricing engine needs it. */
export type PricingPriceRow = {
  product_key: string;
  market_key: string;
  currency: string;
  amount_minor: number;
  active: boolean;
  effective_from: string | null;
  effective_until: string | null;
};

/**
 * Where the visitor's market resolved to. `market` is null only when even
 * the fallback market is unusable (should never happen in the seeded data).
 */
export type MarketResolution = {
  market: PricingMarket | null;
  reason: MarketReason;
};

/** One product's localized price entry for API responses. */
export type LocalizedPrice = {
  product_key: string;
  display_name: string;
  family: string;
  billing_type: string;
  billing_period_days: number | null;
  /** True when the product is currently for sale and has a resolvable price. */
  available: boolean;
  /** Why the entry is unavailable; only present when `available` is false. */
  reason?: UnavailableReason;
  /** The market whose price is actually shown (may be the fallback). */
  market_key: string;
  /** Currency of the shown price. */
  currency: string;
  /** Integer minor units — the number the frontend must display, unmodified. */
  amount_minor: number;
  /** Intl-formatted string ready for display. */
  formatted_price: string;
  /**
   * True when the resolved market had no configured price and the USD_US
   * fallback reference price is being shown instead. Frontends may label
   * this "reference pricing".
   */
  is_fallback: boolean;
};

/** Options that control how the engine resolves a market for a caller. */
export type PriceResolutionContext = {
  /** ISO alpha-2 country code from the caller (profile country is Phase 2's source). */
  countryCode?: string | null;
  /** A valid BCP-47 locale from the profile, used only for formatting. */
  locale?: string | null;
  /** Whether the caller has an authenticated session (affects the fallback reason). */
  signedIn?: boolean;
};