import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION =
  "supabase/migrations/20260923000000_localized_pricing_engine.sql";

const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8");

const PRODUCT_TABLES = [
  "pricing_products",
  "pricing_markets",
  "pricing_prices",
  "pricing_country_markets",
];

const PRODUCT_KEYS = [
  "candidate_application_single",
  "candidate_application_pack_25",
  "candidate_application_pack_50",
  "candidate_application_pack_100",
  "candidate_live_single",
  "candidate_live_pack_3",
  "candidate_live_annual",
  "employer_starter_bundle",
  "employer_addon_post",
];

const MARKET_KEYS = [
  "USD_US",
  "GBP_UK",
  "CAD_CA",
  "NGN_NG",
  "GHS_GH",
  "KES_KE",
  "ZAR_ZA",
  "EUR_EUROZONE",
  "AUD_AU",
  "JPY_JP",
];

/** Approved reference USD prices, in integer minor units. */
const REFERENCE_PRICES: Record<string, number> = {
  candidate_application_single: 99,
  candidate_application_pack_25: 2000,
  candidate_application_pack_50: 3500,
  candidate_application_pack_100: 5900,
  candidate_live_single: 2499,
  candidate_live_pack_3: 5999,
  candidate_live_annual: 49900,
  employer_starter_bundle: 10000,
  employer_addon_post: 1000,
};

function executableStatements(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("pricing engine migration — static SQL review", () => {
  it("is purely additive: no drops, deletes, truncates, or column rewrites", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.(profiles|countries)/i);
  });

  it("never touches Phase 1 tables or their RLS policies", () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.countries\b/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.profiles\b/i);
    for (const statement of executableStatements(sql)) {
      if (/(CREATE|ALTER|DROP)\s+POLICY/i.test(statement)) {
        expect(statement).toMatch(/public\.pricing_/);
      }
    }
  });

  it("creates exactly the four pricing tables", () => {
    for (const table of PRODUCT_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
    }
    const created = (
      sql.match(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+)/g) ?? []
    ).map((m) => m.split("public.")[1]);
    expect(created.sort()).toEqual([...PRODUCT_TABLES].sort());
  });

  it("stores prices as integer minor units with a positive CHECK", () => {
    const table = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.pricing_prices \(([\s\S]*?)\n\);/i
    )![1];
    expect(table).toMatch(/"amount_minor"\s+integer\s+NOT NULL/);
    expect(table).toMatch(/CHECK \("amount_minor" > 0\)/);
    // No floating-point money in the price seed itself (amounts are integer
    // literals only). Documentation comments may mention e.g. "$24.99".
    const priceInsert = sql.match(
      /INSERT INTO public\.pricing_prices\s+\(([\s\S]*?)\)\s+VALUES\s+([\s\S]*?)\s+ON CONFLICT \(product_key, market_key\) DO NOTHING;/i
    )![2];
    expect(priceInsert).not.toMatch(/[0-9]\.[0-9]/);
  });

  it("pins each price's currency to its market's currency with a composite FK", () => {
    expect(sql).toContain(
      'CONSTRAINT "pricing_prices_currency_market_fkey"'
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("market_key", "currency"\)\s+REFERENCES public\.pricing_markets \("market_key", "currency"\)/i
    );
    expect(sql).toContain(
      'CONSTRAINT "pricing_markets_currency_uniq"'
    );
    expect(sql).toMatch(/UNIQUE \("market_key", "currency"\)/);
  });

  it("keeps optional Stripe identifiers as nullable, non-secret storage columns", () => {
    expect(sql).toMatch(/"stripe_price_id"\s+text,/);
    expect(sql).toMatch(/"stripe_product_id"\s+text,/);
    expect(sql).not.toMatch(/"stripe_price_id"\s+text\s+NOT NULL/);
    expect(sql).not.toMatch(/"stripe_price_id"\s+text\s+.*'pi_|"stripe_product_id"\s+text\s+.*'prod_/i);
  });

  it("seeds all nine canonical product keys with the approved families and billing types", () => {
    const block = sql.match(
      /INSERT INTO public\.pricing_products\s+\(([\s\S]*?)\)\s+VALUES\s+([\s\S]*?)\s+ON CONFLICT \(product_key\) DO NOTHING;/i
    )![2];

    for (const key of PRODUCT_KEYS) {
      expect(block, `missing product ${key}`).toContain(`'${key}'`);
    }

    expect(block).toMatch(/'candidate_application_single'\s*,\s*'candidate'/);
    expect(block).toMatch(/'employer_starter_bundle'\s*,\s*'employer'\s*,\s*'Employer starter bundle'\s*,\s*'recurring',\s*30/);
    expect(block).toMatch(/'employer_addon_post'\s*,\s*'employer'/);
    // Products ship active by default (no active column in the insert).
    const productsTable = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.pricing_products \(([\s\S]*?)\n\);/i
    )![1];
    expect(productsTable).toMatch(/"active"\s+boolean\s+NOT NULL DEFAULT true/);
    expect(block).not.toContain("active");
  });

  it("stores the approved reference USD prices in integer minor units", () => {
    const priceRows = new Map<string, number>();
    const re = /\(\s*'([a-z0-9_]+)'\s*,\s*'USD_US'\s*,\s*'USD'\s*,\s*(\d+)\s*,/g;
    for (const match of sql.matchAll(re)) {
      priceRows.set(match[1], Number(match[2]));
    }

    expect(priceRows.size).toBe(9);
    for (const [key, amount] of Object.entries(REFERENCE_PRICES)) {
      expect(priceRows.get(key), `reference price for ${key}`).toBe(amount);
    }

    // No other market carries a price: reference prices exist for USD_US only.
    const otherMarkets = sql.match(
      /\(\s*'(?:candidate|employer)_[a-z0-9_]+'\s*,\s*'(?!USD_US)[A-Z0-9_]+'/g
    );
    expect(otherMarkets ?? []).toHaveLength(0);
  });

  it("seeds all ten launch markets with the right currencies", () => {
    const block = sql.match(
      /INSERT INTO public\.pricing_markets\s+\(([\s\S]*?)\)\s+VALUES\s+([\s\S]*?)\s+ON CONFLICT \(market_key\) DO NOTHING;/i
    )![2];

    for (const key of MARKET_KEYS) {
      expect(block, `missing market ${key}`).toContain(`'${key}'`);
    }
    expect(block).toMatch(/'JPY_JP'\s*,\s*'Japan \(JPY\)'\s*,\s*'JPY'\s*,\s*'ja-JP'/);
    expect(block).toMatch(/'USD_US'\s*,\s*'United States \(USD\)'\s*,\s*'USD'\s*,\s*'en-US'/);
    expect(block).toMatch(/'EUR_EUROZONE'\s*,\s*'Eurozone \(EUR\)'\s*,\s*'EUR'/);
  });

  it("maps countries to markets, including a data-driven Eurozone block", () => {
    expect(sql).toMatch(/SELECT code, 'EUR_EUROZONE'/i);
    expect(sql).toMatch(/FROM public\.countries\s+WHERE default_currency = 'EUR'/i);
    for (const [country, market] of [
      ["US", "USD_US"],
      ["GB", "GBP_UK"],
      ["CA", "CAD_CA"],
      ["NG", "NGN_NG"],
      ["GH", "GHS_GH"],
      ["KE", "KES_KE"],
      ["ZA", "ZAR_ZA"],
      ["AU", "AUD_AU"],
      ["JP", "JPY_JP"],
    ]) {
      expect(sql, `mapping ${country}→${market}`).toContain(
        `('${country}', '${market}')`
      );
    }
  });

  it("enables RLS on every pricing table with exactly one public SELECT policy", () => {
    for (const table of PRODUCT_TABLES) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);

      const policies = executableStatements(sql).filter((statement) =>
        statement.includes(`CREATE POLICY "${table}_select_public"`)
      );
      expect(policies, `${table} policy`).toHaveLength(1);
      expect(policies[0]).toMatch(new RegExp(`ON public\\.${table}`));
      expect(policies[0]).toMatch(/FOR SELECT/);
      expect(policies[0]).toMatch(/TO anon, authenticated/);
      expect(policies[0]).toMatch(/USING \(true\)/);
    }

    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)\b/i);
  });

  it("scopes grants so clients can read but never mutate pricing", () => {
    for (const table of PRODUCT_TABLES) {
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM anon;`
      );
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM authenticated;`
      );
      expect(sql).toContain(
        `GRANT SELECT ON TABLE public.${table} TO anon, authenticated;`
      );
      expect(sql).toContain(
        `GRANT ALL ON TABLE public.${table} TO postgres, service_role;`
      );
    }
    expect(sql).not.toMatch(
      /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*pricing_[a-z_]+[^;]*(anon|authenticated)/i
    );
  });

  it("keeps the code-level fallback market aligned with the seed", () => {
    const config = readFileSync(
      path.join(repoRoot, "src/lib/pricing/config.ts"),
      "utf8"
    );
    expect(config).toContain('export const FALLBACK_MARKET_KEY = "USD_US";');
    expect(sql).toContain("'USD_US'");
  });
});