import { describe, expect, it } from "vitest";
import {
  buildLocalizedPrice,
  getActivePrice,
  getLocalizedPrice,
  getLocalizedPrices,
  normalizeCountryCode,
  resolvePricingMarket,
  type PricingClient,
} from "@/lib/pricing/service";
import {
  MARKET_REASONS,
  UNAVAILABLE_REASONS,
  FALLBACK_MARKET_KEY,
} from "@/lib/pricing/config";
import { fakePricingClient, type PricedRow } from "../helpers/fake-pricing-db";
import type { PricingProduct } from "@/lib/pricing/types";

const PRODUCTS: PricedRow[] = [
  {
    product_key: "candidate_application_single",
    family: "candidate",
    display_name: "Single application credit",
    billing_type: "one_time",
    billing_period_days: null,
    active: true,
    metadata: {},
  },
  {
    product_key: "candidate_live_single",
    family: "candidate",
    display_name: "Odesseus Live — single session",
    billing_type: "one_time",
    billing_period_days: null,
    active: true,
    metadata: {},
  },
  {
    product_key: "employer_starter_bundle",
    family: "employer",
    display_name: "Employer starter bundle",
    billing_type: "recurring",
    billing_period_days: 30,
    active: true,
    metadata: {},
  },
];

const USD_PRICES: PricedRow[] = [
  { product_key: "candidate_application_single", market_key: "USD_US", currency: "USD", amount_minor: 99, active: true, effective_from: null, effective_until: null },
  { product_key: "candidate_live_single", market_key: "USD_US", currency: "USD", amount_minor: 2499, active: true, effective_from: null, effective_until: null },
  { product_key: "employer_starter_bundle", market_key: "USD_US", currency: "USD", amount_minor: 10000, active: true, effective_from: null, effective_until: null },
];

const MARKETS: PricedRow[] = [
  { market_key: "USD_US", name: "United States (USD)", currency: "USD", locale: "en-US", region: "NORTH_AMERICA", active: true },
  { market_key: "GBP_UK", name: "United Kingdom (GBP)", currency: "GBP", locale: "en-GB", region: "EUROPE", active: true },
  { market_key: "NGN_NG", name: "Nigeria (NGN)", currency: "NGN", locale: "en-NG", region: "AFRICA", active: true },
  { market_key: "INACTIVE_MARKET", name: "Inactive market", currency: "XXX", locale: "en-US", region: null, active: false },
];

function makeClient(overrides: {
  products?: PricedRow[];
  prices?: PricedRow[];
  markets?: PricedRow[];
  mappings?: PricedRow[];
  userId?: string | null;
}): PricingClient {
  return fakePricingClient({
    userId: overrides.userId ?? null,
    tables: {
      pricing_products: overrides.products ?? PRODUCTS,
      pricing_prices: overrides.prices ?? USD_PRICES,
      pricing_markets: overrides.markets ?? MARKETS,
      pricing_country_markets:
        overrides.mappings ??
        [
          { country_code: "NG", market_key: "NGN_NG" },
          { country_code: "GB", market_key: "GBP_UK" },
          { country_code: "US", market_key: "USD_US" },
          { country_code: "GH", market_key: "INACTIVE_MARKET" },
        ],
    },
  }) as unknown as PricingClient;
}

describe("normalizeCountryCode", () => {
  it("uppercases, trims, and accepts valid ISO alpha-2 codes", () => {
    expect(normalizeCountryCode("us")).toBe("US");
    expect(normalizeCountryCode(" NG ")).toBe("NG");
    expect(normalizeCountryCode("US")).toBe("US");
  });

  it("returns null for missing or malformed input", () => {
    expect(normalizeCountryCode(null)).toBeNull();
    expect(normalizeCountryCode(undefined)).toBeNull();
    expect(normalizeCountryCode("")).toBeNull();
    expect(normalizeCountryCode("USA")).toBeNull();
    expect(normalizeCountryCode("nolocale123")).toBeNull();
  });
});

describe("resolvePricingMarket", () => {
  it("resolves an active mapped market for a known country", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: "NG",
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.MARKET_OK);
    expect(resolution.market?.market_key).toBe("NGN_NG");
  });

  it("falls back to USD_US for a valid but unmapped country", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: "IN",
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.COUNTRY_UNMAPPED);
    expect(resolution.market?.market_key).toBe(FALLBACK_MARKET_KEY);
  });

  it("falls back when the mapped market is inactive", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: "GH",
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.MARKET_INACTIVE);
    expect(resolution.market?.market_key).toBe(FALLBACK_MARKET_KEY);
  });

  it("falls back for a signed-in caller with no country", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: null,
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.COUNTRY_MISSING);
    expect(resolution.market?.market_key).toBe(FALLBACK_MARKET_KEY);
  });

  it("falls back for an unauthenticated visitor", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: null,
      signedIn: false,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.UNAUTHENTICATED);
    expect(resolution.market?.market_key).toBe(FALLBACK_MARKET_KEY);
  });

  it("falls back for a malformed country code", async () => {
    const client = makeClient({});
    const resolution = await resolvePricingMarket(client, {
      countryCode: "USAX",
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.MALFORMED_COUNTRY);
    expect(resolution.market?.market_key).toBe(FALLBACK_MARKET_KEY);
  });

  it("reports fallback_inactive when even the fallback market is unusable", async () => {
    const client = makeClient({
      markets: MARKETS.map((m) =>
        m.market_key === FALLBACK_MARKET_KEY ? { ...m, active: false } : m
      ),
    });
    const resolution = await resolvePricingMarket(client, {
      countryCode: "IN",
      signedIn: true,
    });

    expect(resolution.reason).toBe(MARKET_REASONS.FALLBACK_INACTIVE);
    expect(resolution.market).toBeNull();
  });
});

describe("buildLocalizedPrice (pure)", () => {
  const product = PRODUCTS[0] as unknown as PricingProduct;
  const price = USD_PRICES[0] as unknown as NonNullable<
    Awaited<ReturnType<typeof getActivePrice>>
  >;

  it("builds an available entry with integer minor units", () => {
    const entry = buildLocalizedPrice(product, price, "USD_US", false, "en-US");

    expect(entry.available).toBe(true);
    expect(entry.amount_minor).toBe(99);
    expect(Number.isInteger(entry.amount_minor)).toBe(true);
    expect(entry.currency).toBe("USD");
    expect(entry.formatted_price).toBe("$0.99");
    expect(entry.is_fallback).toBe(false);
  });

  it("marks an inactive product unavailable", () => {
    const entry = buildLocalizedPrice(
      { ...product, active: false },
      price,
      "USD_US",
      false,
      "en-US"
    );

    expect(entry.available).toBe(false);
    expect(entry.reason).toBe(UNAVAILABLE_REASONS.PRODUCT_INACTIVE);
  });

  it("marks a missing price unavailable instead of inventing one", () => {
    const entry = buildLocalizedPrice(product, null, "USD_US", false, "en-US");

    expect(entry.available).toBe(false);
    expect(entry.reason).toBe(UNAVAILABLE_REASONS.NO_PRICE);
  });

  it("flags fallback-sourced entries", () => {
    const entry = buildLocalizedPrice(product, price, FALLBACK_MARKET_KEY, true, "en-US");

    expect(entry.available).toBe(true);
    expect(entry.is_fallback).toBe(true);
    expect(entry.market_key).toBe(FALLBACK_MARKET_KEY);
  });
});

describe("getLocalizedPrices", () => {
  it("resolves every product against the USD market with reference amounts", async () => {
    const client = makeClient({});
    const market = { market_key: "USD_US", name: "United States (USD)", currency: "USD", locale: "en-US", region: null, active: true };
    const prices = await getLocalizedPrices(client, market, "en-US");

    expect(prices).toHaveLength(3);
    expect(prices.every((p) => p.available)).toBe(true);
    expect(prices.every((p) => p.is_fallback)).toBe(false);
    expect(prices.map((p) => [p.product_key, p.amount_minor])).toEqual([
      ["candidate_application_single", 99],
      ["candidate_live_single", 2499],
      ["employer_starter_bundle", 10000],
    ]);
  });

  it("falls back to USD reference prices for a market with no configured prices", async () => {
    const client = makeClient({});
    const market = { market_key: "NGN_NG", name: "Nigeria (NGN)", currency: "NGN", locale: "en-NG", region: null, active: true };
    const prices = await getLocalizedPrices(client, market, "en-NG");

    expect(prices).toHaveLength(3);
    expect(prices.every((p) => p.available)).toBe(true);
    expect(prices.every((p) => p.is_fallback)).toBe(true);
    expect(prices.every((p) => p.market_key === FALLBACK_MARKET_KEY)).toBe(true);
    expect(prices.every((p) => p.currency === "USD")).toBe(true);
  });

  it("returns no_price when even the fallback market lacks a price for a product", async () => {
    const client = makeClient({
      prices: USD_PRICES.filter((p) => p.product_key !== "employer_starter_bundle"),
    });
    const market = { market_key: "NGN_NG", name: "Nigeria (NGN)", currency: "NGN", locale: "en-NG", region: null, active: true };
    const prices = await getLocalizedPrices(client, market, "en-NG");

    const employer = prices.find((p) => p.product_key === "employer_starter_bundle");
    expect(employer?.available).toBe(false);
    expect(employer?.reason).toBe(UNAVAILABLE_REASONS.NO_PRICE);
  });

  it("treats a price outside its effective window as unavailable", async () => {
    const client = makeClient({
      prices: USD_PRICES.map((p) =>
        p.product_key === "employer_starter_bundle"
          ? { ...p, effective_from: "2999-01-01T00:00:00.000Z" }
          : p
      ),
    });
    const market = { market_key: FALLBACK_MARKET_KEY, name: "US", currency: "USD", locale: "en-US", region: null, active: true };
    const prices = await getLocalizedPrices(client, market, "en-US");

    const employer = prices.find((p) => p.product_key === "employer_starter_bundle");
    expect(employer?.available).toBe(false);
    expect(employer?.reason).toBe(UNAVAILABLE_REASONS.NO_PRICE);
  });

  it("never emits floating-point amounts", async () => {
    const client = makeClient({});
    const market = { market_key: "USD_US", name: "US", currency: "USD", locale: "en-US", region: null, active: true };
    const prices = await getLocalizedPrices(client, market, "en-US");

    for (const entry of prices) {
      expect(Number.isInteger(entry.amount_minor)).toBe(true);
      expect(typeof entry.currency).toBe("string");
    }
  });
});

describe("getLocalizedPrice", () => {
  it("returns the resolved entry for a known product", async () => {
    const client = makeClient({});
    const market = { market_key: "USD_US", name: "US", currency: "USD", locale: "en-US", region: null, active: true };
    const entry = await getLocalizedPrice(client, "candidate_live_single", market, "en-US");

    expect(entry).not.toBeNull();
    expect(entry?.available).toBe(true);
    expect(entry?.amount_minor).toBe(2499);
  });

  it("returns null for an unknown product key", async () => {
    const client = makeClient({});
    const market = { market_key: "USD_US", name: "US", currency: "USD", locale: "en-US", region: null, active: true };
    const entry = await getLocalizedPrice(client, "not_a_real_product", market, "en-US");

    expect(entry).toBeNull();
  });

  it("reports an inactive product as unavailable with a reason", async () => {
    const client = makeClient({
      products: [
        ...PRODUCTS,
        { product_key: "retired_product", family: "candidate", display_name: "Retired", billing_type: "one_time", billing_period_days: null, active: false, metadata: {} },
      ],
    });
    const market = { market_key: "USD_US", name: "US", currency: "USD", locale: "en-US", region: null, active: true };
    const entry = await getLocalizedPrice(client, "retired_product", market, "en-US");

    expect(entry?.available).toBe(false);
    expect(entry?.reason).toBe(UNAVAILABLE_REASONS.PRODUCT_INACTIVE);
  });
});