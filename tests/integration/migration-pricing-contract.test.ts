import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION =
  "supabase/migrations/20260924000000_current_pricing_contract.sql";

const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8");

/** Current-contract product keys seeded by the migration. */
const NEW_PRODUCT_KEYS = [
  "candidate_standard_apply",
  "candidate_smart_apply",
  "wallet_topup_10",
  "wallet_topup_20",
  "wallet_topup_50",
  "employer_starter",
  "employer_growth",
  "employer_business",
  "featured_7d",
  "featured_14d",
  "featured_30d_ai",
  "recruiter_seat_month",
];

/** Legacy products deactivated in place by the migration (never deleted). */
const DEACTIVATED_LEGACY_KEYS = [
  "candidate_application_single",
  "candidate_application_pack_25",
  "candidate_application_pack_50",
  "candidate_application_pack_100",
  "employer_starter_bundle",
  "employer_addon_post",
];

/** Approved new reference USD prices, in integer minor units. */
const NEW_REFERENCE_PRICES: Record<string, number> = {
  candidate_standard_apply: 49,
  candidate_smart_apply: 199,
  wallet_topup_10: 1000,
  wallet_topup_20: 2000,
  wallet_topup_50: 5000,
  employer_starter: 7900,
  employer_growth: 14900,
  employer_business: 29900,
  featured_7d: 2900,
  featured_14d: 4900,
  featured_30d_ai: 12900,
  recruiter_seat_month: 2000,
};

/** Employer / featured / recruiter tables with org-scoped RLS. */
const EMPLOYER_TABLES = [
  "employer_organizations",
  "employer_members",
  "employer_subscriptions",
  "employer_job_post_credits",
  "job_post_credit_ledger",
  "featured_listings",
  "recruiter_seats",
];

function executableStatements(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("current pricing contract migration — static SQL review", () => {
  it("is additive: deactivates legacy pricing, never deletes it", () => {
    // Header comments may mention forbidden words (e.g. "TRUNCATE") for
    // documentation; only the executable body must be additive.
    const executables = executableStatements(sql).join("\n");
    expect(executables).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executables).not.toMatch(/\bTRUNCATE\b/i);
    expect(executables).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executables).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(executables).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(executables).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(executables).not.toMatch(/UPDATE\s+public\.(profiles|countries)/i);
    // Deactivation is done via active = false, never row removal.
    expect(executables).toMatch(/UPDATE public\.pricing_products\s+SET active = false/i);
    expect(executables).toMatch(/UPDATE public\.pricing_prices\s+SET active = false/i);
  });

  it("deactivates exactly the six legacy products and their prices", () => {
    const productsUpdate = sql.match(
      /UPDATE public\.pricing_products\s+SET active = false, updated_at = now\(\)\s+WHERE product_key IN \(([\s\S]*?)\);/i
    )![1];
    for (const key of DEACTIVATED_LEGACY_KEYS) {
      expect(productsUpdate, `missing deactivation of ${key}`).toContain(`'${key}'`);
    }

    const pricesUpdate = sql.match(
      /UPDATE public\.pricing_prices\s+SET active = false, updated_at = now\(\)\s+WHERE product_key IN \(([\s\S]*?)\);/i
    )![1];
    for (const key of DEACTIVATED_LEGACY_KEYS) {
      expect(pricesUpdate, `missing price deactivation of ${key}`).toContain(`'${key}'`);
    }

    // Live products must never appear in a deactivation.
    expect(productsUpdate).not.toMatch(/candidate_live_/);
    expect(pricesUpdate).not.toMatch(/candidate_live_/);
  });

  it("seeds the twelve current-contract products with approved metadata", () => {
    const block = sql.match(
      /INSERT INTO public\.pricing_products\s+\(([\s\S]*?)\)\s+VALUES\s+([\s\S]*?)\s+ON CONFLICT \(product_key\) DO NOTHING;/i
    )![2];

    for (const key of NEW_PRODUCT_KEYS) {
      expect(block, `missing product ${key}`).toContain(`'${key}'`);
    }

    expect(block).toMatch(/'candidate_standard_apply'\s*,\s*'candidate'\s*,\s*'Standard Apply'/);
    expect(block).toMatch(/'candidate_smart_apply'\s*,\s*'candidate'\s*,\s*'Smart Apply'/);
    expect(block).toMatch(/'wallet_topup_10'\s*,\s*'candidate'/);
    expect(block).toMatch(/'employer_starter'\s*,\s*'employer'\s*,\s*'Employer Starter'\s*,\s*'recurring',\s*30/);
    expect(block).toMatch(/'employer_business'\s*,\s*'employer'/);
    expect(block).toMatch(/'recruiter_seat_month'\s*,\s*'employer'\s*,\s*'Recruiter seat — monthly'\s*,\s*'recurring',\s*30/);
  });

  it("stores the current-contract reference USD prices in minor units", () => {
    const priceRows = new Map<string, number>();
    const re = /\(\s*'([a-z0-9_]+)'\s*,\s*'USD_US'\s*,\s*'USD'\s*,\s*(\d+)\s*,/g;
    for (const match of sql.matchAll(re)) {
      priceRows.set(match[1], Number(match[2]));
    }

    expect(priceRows.size).toBe(12);
    for (const [key, amount] of Object.entries(NEW_REFERENCE_PRICES)) {
      expect(priceRows.get(key), `reference price for ${key}`).toBe(amount);
    }
    // No floating-point money in the seed.
    expect(sql).not.toMatch(/\(\s*'[a-z0-9_]+'\s*,\s*'USD_US'\s*,\s*'USD'\s*,\s*[0-9]+\.[0-9]+\s*,/);
  });

  it("adds the wallet balance and ledger audit columns", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.credit_balances\s+ADD COLUMN wallet_balance_cents integer NOT NULL DEFAULT 0;/i
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT credit_balances_wallet_non_negative CHECK \(wallet_balance_cents >= 0\)/
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.credit_transactions\s+ADD COLUMN balance_cents_after integer;/i
    );
  });

  it("widens credit-type CHECKs to the wallet credit types without touching rows", () => {
    // constraint rewrites preserve the legacy application/interview values.
    expect(sql).toMatch(/credit_type = ANY \(ARRAY\['application'::text, 'interview'::text,/);
    expect(sql).toMatch(/'wallet_topup'::text, 'standard_apply'::text, 'smart_apply'::text\]\)/);
    expect(sql).toMatch(/credit_transactions_credit_type_check/);
    expect(sql).toMatch(/credit_ledger_credit_type_check/);
    expect(sql).toMatch(/billing_events_credit_type_check/);
    // Wallet displays must be pinned to the delta magnitude.
    expect(sql).toMatch(/credit_transactions_wallet_amount_check/);
    expect(sql).toMatch(/amount_cents = abs\(delta\)/);
  });

  it("rewires the trigger: wallet branch guards balance and records audit trail", () => {
    const trigger = sql.match(
      /CREATE OR REPLACE FUNCTION odesseus_private\.apply_credit_transaction[\s\S]*?\$function\$;/
    )![0];

    expect(trigger).toMatch(/'wallet_topup', 'standard_apply', 'smart_apply'/);
    expect(trigger).toMatch(/raise exception 'insufficient wallet balance'/i);
    expect(trigger).toMatch(/set wallet_balance_cents = v_wallet_after/i);
    expect(trigger).toMatch(/set balance_cents_after = v_wallet_after/i);
    // Existing application/interview paths are preserved.
    expect(trigger).toMatch(/if new\.credit_type = 'application' then/i);
    expect(trigger).toMatch(/insert into odesseus_private\.credit_ledger/i);
  });

  it("keeps the legacy finalization RPC untouched (Phase 3 changes it in lockstep)", () => {
    // The file header mentions the RPC for documentation; only the executable
    // body must not invoke or redefine it.
    expect(executableStatements(sql).join("\n")).not.toMatch(
      /odesseus_finalize_successful_application/
    );
  });

  it("creates all seven employer/featured/seat tables with RLS enabled", () => {
    for (const table of EMPLOYER_TABLES) {
      expect(sql).toContain(`CREATE TABLE public.${table} (`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
    const created = (sql.match(/CREATE TABLE public\.([a-z_]+) \(/g) ?? []).map(
      (m) => m.split("public.")[1].replace(/\s*\(\s*$/, "")
    );
    expect(created.sort()).toEqual([...EMPLOYER_TABLES].sort());
  });

  it("scopes employer RLS by org membership helpers, never anon", () => {
    // No policy on the new tables targets the anonymous role.
    expect(sql).not.toMatch(
      /CREATE POLICY "[a-z_]+" ON public\.(employer_|featured_|job_post_|recruiter_).*FOR SELECT TO anon/i
    );
    // Membership checks go through SECURITY DEFINER helpers (no RLS recursion).
    for (const helper of [
      "odesseus_private.is_org_member",
      "odesseus_private.is_org_owner",
      "odesseus_private.is_org_admin_or_owner",
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${helper}`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${helper}(uuid) TO authenticated;`);
    }
    // Writes on billing-owned tables are service-role-only via grants.
    for (const table of [
      "employer_subscriptions",
      "employer_job_post_credits",
      "job_post_credit_ledger",
      "featured_listings",
      "recruiter_seats",
    ]) {
      expect(sql).toContain(
        `GRANT SELECT ON TABLE public.${table} TO authenticated;`
      );
      expect(sql).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO postgres, service_role;`
      );
    }
  });

  it("does not FK featured_listings.job_id to a nonexistent job_postings table", () => {
    // employer job postings do not exist yet — job_id stays a bare uuid.
    expect(sql).not.toMatch(/job_id[\s\S]*?REFERENCES public\.job_postings/i);
    expect(sql).toMatch(/job_id\s+uuid NOT NULL,/);
    // RLS scoping is via org_id instead.
    expect(sql).toMatch(/org_id\s+uuid NOT NULL REFERENCES public\.employer_organizations\(id\)/);
  });

  it("adds the tier-grant and featured-expiry RPCs as service-role-only", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.grant_employer_tier_job_posts/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.expire_ended_featured_listings/);
    for (const fn of [
      "public.grant_employer_tier_job_posts(uuid, text)",
      "public.expire_ended_featured_listings()",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO postgres, service_role;`);
    }
  });

  it("does not build the legacy conversion path (Path A: zero balances)", () => {
    // Header comments mention the rejected path for documentation; the
    // executable body must not define or call it or its credit type.
    const executables = executableStatements(sql).join("\n");
    expect(executables).not.toMatch(/convert_legacy_application_credits/i);
    expect(executables).not.toMatch(/'legacy_conversion'/);
  });
});