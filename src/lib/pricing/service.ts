import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  FALLBACK_MARKET_KEY,
  MARKET_REASONS,
  UNAVAILABLE_REASONS,
  type MarketReason,
  type UnavailableReason,
} from "./config";
import { formatLocalizedPrice } from "./format";
import type {
  LocalizedPrice,
  MarketResolution,
  PriceResolutionContext,
  PricingMarket,
  PricingPriceRow,
  PricingProduct,
} from "./types";

type PricingClient = SupabaseClient<Database>;
export type { PricingClient };

const PRODUCT_COLUMNS =
  "product_key,family,display_name,billing_type,billing_period_days,active,metadata";
const MARKET_COLUMNS = "market_key,name,currency,locale,region,active";
const PRICE_COLUMNS =
  "product_key,market_key,currency,amount_minor,active,effective_from,effective_until";

/**
 * Normalizes an untrusted country code to ISO alpha-2 uppercase, or null when
 * it is missing or malformed. Malformed input resolves to the fallback market
 * — it is never passed to the database.
 */
export function normalizeCountryCode(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/** Loads one pricing market by key, or null when it does not exist. */
export async function findMarket(
  client: PricingClient,
  marketKey: string
): Promise<PricingMarket | null> {
  const { data, error } = await client
    .from("pricing_markets")
    .select(MARKET_COLUMNS)
    .eq("market_key", marketKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load pricing market: ${error.message}`);
  }
  return (data as PricingMarket) ?? null;
}

/** The fallback market when it exists and is active, else null. */
async function fallbackMarket(client: PricingClient): Promise<PricingMarket | null> {
  const market = await findMarket(client, FALLBACK_MARKET_KEY);
  if (!market || !market.active) return null;
  return market;
}

function reasonForMissingCountry(context: PriceResolutionContext): MarketReason {
  const code = context.countryCode?.trim().toUpperCase() ?? "";
  if (code !== "" && !/^[A-Z]{2}$/.test(code)) {
    return MARKET_REASONS.MALFORMED_COUNTRY;
  }
  return context.signedIn ? MARKET_REASONS.COUNTRY_MISSING : MARKET_REASONS.UNAUTHENTICATED;
}

/**
 * Resolves the pricing market for a caller.
 *
 * Order (Phase 2): authoritative billing country does not exist yet, so the
 * source is the profile country; the fallback covers everything else:
 *   1. valid profile country with an active mapped market → that market
 *   2. otherwise → the USD_US fallback market (approved reference prices)
 *
 * A resolved market is never "wrong": every unresolvable case returns the
 * documented fallback plus a machine-readable `reason`.
 */
export async function resolvePricingMarket(
  client: PricingClient,
  context: PriceResolutionContext = {}
): Promise<MarketResolution> {
  const countryCode = normalizeCountryCode(context.countryCode);

  if (!countryCode) {
    const fallback = await fallbackMarket(client);
    return {
      market: fallback,
      reason: fallback ? reasonForMissingCountry(context) : MARKET_REASONS.FALLBACK_INACTIVE,
    };
  }

  const { data: mapping, error } = await client
    .from("pricing_country_markets")
    .select("market_key")
    .eq("country_code", countryCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load country pricing market: ${error.message}`);
  }

  if (!mapping?.market_key) {
    const fallback = await fallbackMarket(client);
    return {
      market: fallback,
      reason: fallback ? MARKET_REASONS.COUNTRY_UNMAPPED : MARKET_REASONS.FALLBACK_INACTIVE,
    };
  }

  const market = await findMarket(client, mapping.market_key);

  if (!market || !market.active) {
    const fallback = await fallbackMarket(client);
    return {
      market: fallback,
      reason: fallback
        ? market
          ? MARKET_REASONS.MARKET_INACTIVE
          : MARKET_REASONS.COUNTRY_UNMAPPED
        : MARKET_REASONS.FALLBACK_INACTIVE,
    };
  }

  return { market, reason: MARKET_REASONS.MARKET_OK };
}

/** Active price row for one (product, market), honoring effective windows. */
export async function getActivePrice(
  client: PricingClient,
  productKey: string,
  marketKey: string
): Promise<PricingPriceRow | null> {
  const { data, error } = await client
    .from("pricing_prices")
    .select(PRICE_COLUMNS)
    .eq("product_key", productKey)
    .eq("market_key", marketKey)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load price: ${error.message}`);
  }

  const row = (data as PricingPriceRow) ?? null;
  if (!row) return null;

  const now = Date.now();
  if (row.effective_from && Date.parse(row.effective_from) > now) return null;
  if (row.effective_until && Date.parse(row.effective_until) <= now) return null;

  return row;
}

/**
 * Loads the signed-in caller's pricing context (profile country + locale).
 * Unauthenticated callers get an empty, not-signed-in context. Locale is used
 * strictly for display formatting; it can never alter the resolved price.
 */
export async function getCallerPricingContext(
  client: PricingClient
): Promise<PriceResolutionContext & { signedIn: boolean }> {
  const { data: auth } = await client.auth.getClaims();
  const userId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : null;

  if (!userId) {
    return { signedIn: false };
  }

  const { data: profile, error } = await client
    .from("profiles")
    .select("country_code,locale")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load profile: ${error.message}`);
  }

  return {
    countryCode: profile?.country_code ?? null,
    locale: profile?.locale ?? null,
    signedIn: true,
  };
}

/** Loads every currently offered product (active = true). */
export async function listActiveProducts(
  client: PricingClient
): Promise<PricingProduct[]> {
  const { data, error } = await client
    .from("pricing_products")
    .select(PRODUCT_COLUMNS)
    .eq("active", true)
    .order("product_key", { ascending: true });

  if (error) {
    throw new Error(`Could not load products: ${error.message}`);
  }
  return (data ?? []) as PricingProduct[];
}

/** Loads a single product regardless of its active flag (for the detail API). */
export async function getProduct(
  client: PricingClient,
  productKey: string
): Promise<PricingProduct | null> {
  const { data, error } = await client
    .from("pricing_products")
    .select(PRODUCT_COLUMNS)
    .eq("product_key", productKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load product: ${error.message}`);
  }
  return (data as PricingProduct) ?? null;
}

/**
 * Builds the API-facing entry for one product. Pure and unit-testable: callers
 * supply the resolved price row (or null) and the reason it should be marked
 * unavailable.
 *
 * The amount is passed through untouched in integer minor units; only the
 * display string is formatted.
 */
export function buildLocalizedPrice(
  product: PricingProduct,
  price: PricingPriceRow | null,
  shownMarketKey: string,
  isFallback: boolean,
  locale = "en-US",
  reasonOverride?: UnavailableReason
): LocalizedPrice {
  const base = {
    product_key: product.product_key,
    display_name: product.display_name,
    family: product.family,
    billing_type: product.billing_type,
    billing_period_days: product.billing_period_days,
    market_key: shownMarketKey,
  };

  if (!product.active) {
    return {
      ...base,
      available: false,
      reason: reasonOverride ?? UNAVAILABLE_REASONS.PRODUCT_INACTIVE,
      currency: "",
      amount_minor: 0,
      formatted_price: "",
      is_fallback: false,
    };
  }

  if (!price) {
    return {
      ...base,
      available: false,
      reason: reasonOverride ?? UNAVAILABLE_REASONS.NO_PRICE,
      currency: "",
      amount_minor: 0,
      formatted_price: "",
      is_fallback: isFallback,
    };
  }

  return {
    ...base,
    available: true,
    currency: price.currency,
    amount_minor: price.amount_minor,
    formatted_price: formatLocalizedPrice(price.amount_minor, price.currency, locale),
    is_fallback: isFallback,
  };
}

/** Resolves the entry for one product against a resolved market (with fallback). */
async function resolveEntryForMarket(
  client: PricingClient,
  product: PricingProduct,
  market: PricingMarket | null,
  locale: string
): Promise<LocalizedPrice> {
  if (!product.active) {
    return buildLocalizedPrice(
      product,
      null,
      market?.market_key ?? "",
      false,
      locale,
      UNAVAILABLE_REASONS.PRODUCT_INACTIVE
    );
  }

  if (!market) {
    return buildLocalizedPrice(
      product,
      null,
      "",
      false,
      locale,
      UNAVAILABLE_REASONS.MARKET_INACTIVE
    );
  }

  const price = await getActivePrice(client, product.product_key, market.market_key);

  if (price) {
    return buildLocalizedPrice(product, price, market.market_key, false, locale);
  }

  // The market exists but has no configured price for this product yet:
  // deterministically fall back to the approved USD_US reference price and
  // flag it so the frontend can label it honestly.
  if (market.market_key !== FALLBACK_MARKET_KEY) {
    const fallbackPrice = await getActivePrice(
      client,
      product.product_key,
      FALLBACK_MARKET_KEY
    );
    return buildLocalizedPrice(
      product,
      fallbackPrice,
      FALLBACK_MARKET_KEY,
      true,
      locale
    );
  }

  return buildLocalizedPrice(product, null, market.market_key, false, locale);
}

/** Localized prices for every active product against a resolved market. */
export async function getLocalizedPrices(
  client: PricingClient,
  market: PricingMarket | null,
  locale = "en-US"
): Promise<LocalizedPrice[]> {
  const products = await listActiveProducts(client);
  const entries: LocalizedPrice[] = [];
  for (const product of products) {
    entries.push(await resolveEntryForMarket(client, product, market, locale));
  }
  return entries;
}

/**
 * Localized price for a single product, or null when the product key is
 * unknown (callers map this to 404). Inactive products still return an entry
 * with `available: false`.
 */
export async function getLocalizedPrice(
  client: PricingClient,
  productKey: string,
  market: PricingMarket | null,
  locale = "en-US"
): Promise<LocalizedPrice | null> {
  const product = await getProduct(client, productKey);
  if (!product) return null;
  return resolveEntryForMarket(client, product, market, locale);
}