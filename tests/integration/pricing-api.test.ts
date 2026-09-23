import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePricingClient, type PricedRow } from "../helpers/fake-pricing-db";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

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
];

const PRICES: PricedRow[] = [
  {
    product_key: "candidate_application_single",
    market_key: "USD_US",
    currency: "USD",
    amount_minor: 99,
    active: true,
    effective_from: null,
    effective_until: null,
    // Stripe identifiers must never appear in API responses.
    stripe_price_id: "price_secret_x",
    stripe_product_id: "prod_secret_x",
  },
  {
    product_key: "candidate_live_single",
    market_key: "USD_US",
    currency: "USD",
    amount_minor: 2499,
    active: true,
    effective_from: null,
    effective_until: null,
    stripe_price_id: "price_secret_y",
    stripe_product_id: "prod_secret_y",
  },
];

const MARKETS: PricedRow[] = [
  { market_key: "USD_US", name: "United States (USD)", currency: "USD", locale: "en-US", region: "NORTH_AMERICA", active: true },
  { market_key: "NGN_NG", name: "Nigeria (NGN)", currency: "NGN", locale: "en-NG", region: "AFRICA", active: true },
];

const MAPPINGS: PricedRow[] = [
  { country_code: "US", market_key: "USD_US" },
  { country_code: "NG", market_key: "NGN_NG" },
];

const PROFILES: PricedRow[] = [
  { id: "user-1", country_code: "US", locale: "en-US" },
  { id: "user-ng", country_code: "NG", locale: "en-NG" },
];

function clientFor(overrides: {
  userId?: string | null;
  products?: PricedRow[];
  prices?: PricedRow[];
  markets?: PricedRow[];
  mappings?: PricedRow[];
  profiles?: PricedRow[];
  failTables?: string[];
}) {
  return fakePricingClient({
    userId: overrides.userId ?? null,
    failTables: overrides.failTables,
    tables: {
      pricing_products: overrides.products ?? PRODUCTS,
      pricing_prices: overrides.prices ?? PRICES,
      pricing_markets: overrides.markets ?? MARKETS,
      pricing_country_markets: overrides.mappings ?? MAPPINGS,
      profiles: overrides.profiles ?? PROFILES,
    },
  });
}

describe("GET /api/pricing", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("serves USD reference pricing to anonymous visitors", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: null }));

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.market_reason).toBe("unauthenticated");
    expect(body.market.market_key).toBe("USD_US");
    expect(body.prices).toHaveLength(2);
    expect(body.prices.every((p: { available: boolean }) => p.available)).toBe(true);
    // The USD_US market has its own configured prices, so even though the
    // visitor was resolved to it as a fallback market, the prices themselves
    // are not "fallback" rows — they are the approved reference prices.
    expect(body.prices.every((p: { is_fallback: boolean }) => p.is_fallback)).toBe(false);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("resolves a signed-in user's market from their profile country", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: "user-ng" }));

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.market_reason).toBe("market_ok");
    expect(body.market.market_key).toBe("NGN_NG");
    expect(body.prices[0].is_fallback).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns exact reference amounts for the USD market", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: "user-1" }));

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();
    const body = await response.json();

    expect(body.market.market_key).toBe("USD_US");
    expect(body.prices.map((p: { amount_minor: number }) => p.amount_minor)).toEqual([99, 2499]);
    expect(body.prices.map((p: { formatted_price: string }) => p.formatted_price)).toEqual([
      "$0.99",
      "$24.99",
    ]);
  });

  it("does not leak Stripe identifiers anywhere in the response", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: null }));

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();
    const raw = await response.text();

    expect(raw).not.toContain("stripe_price_id");
    expect(raw).not.toContain("stripe_product_id");
    expect(raw).not.toContain("price_secret");
    expect(raw).not.toContain("prod_secret");
  });

  it("answers 500 when a profile read fails instead of guessing a price", async () => {
    createClientMock.mockResolvedValue(
      clientFor({ userId: "user-1", failTables: ["profiles"] })
    );

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/pricing/i);
  });
});

describe("GET /api/pricing/[productKey]", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns the localized price for a known product", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: "user-1" }));

    const { GET } = await import("@/app/api/pricing/[productKey]/route");
    const response = await GET(new Request("http://localhost/api/pricing/candidate_live_single"), {
      params: Promise.resolve({ productKey: "candidate_live_single" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.price.product_key).toBe("candidate_live_single");
    expect(body.price.amount_minor).toBe(2499);
    expect(body.price.formatted_price).toBe("$24.99");
    expect(body.price.market_key).toBe("USD_US");
  });

  it("resolves to the fallback market for anonymous visitors", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: null }));

    const { GET } = await import("@/app/api/pricing/[productKey]/route");
    const response = await GET(new Request("http://localhost/api/pricing/candidate_application_single"), {
      params: Promise.resolve({ productKey: "candidate_application_single" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.market.market_key).toBe("USD_US");
    // Named product has its own configured USD price, so not a fallback row.
    expect(body.price.is_fallback).toBe(false);
  });

  it("answers 404 for an unknown product key", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: null }));

    const { GET } = await import("@/app/api/pricing/[productKey]/route");
    const response = await GET(new Request("http://localhost/api/pricing/nope"), {
      params: Promise.resolve({ productKey: "nope" }),
    });

    expect(response.status).toBe(404);
  });

  it("answers 404 for a malformed product key", async () => {
    createClientMock.mockResolvedValue(clientFor({ userId: null }));

    const { GET } = await import("@/app/api/pricing/[productKey]/route");
    const response = await GET(new Request("http://localhost/api/pricing/BAD-KEY!"), {
      params: Promise.resolve({ productKey: "BAD-KEY!" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns available:false for an inactive product instead of a price", async () => {
    createClientMock.mockResolvedValue(
      clientFor({
        userId: null,
        products: [
          ...PRODUCTS,
          {
            product_key: "retired_bundle",
            family: "candidate",
            display_name: "Retired bundle",
            billing_type: "one_time",
            billing_period_days: null,
            active: false,
            metadata: {},
          },
        ],
      })
    );

    const { GET } = await import("@/app/api/pricing/[productKey]/route");
    const response = await GET(new Request("http://localhost/api/pricing/retired_bundle"), {
      params: Promise.resolve({ productKey: "retired_bundle" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.price.available).toBe(false);
    expect(body.price.reason).toBe("product_inactive");
  });
});