import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyRates, billingCatalog, type BillingSku, employerPlans, employerPlanForAmount, employerRecruiterSeat } from "@/lib/billing/catalog";

describe("employerPlanForAmount", () => {
  it("resolves each catalog price to its own tier", () => {
    // The webhook uses this to learn which plan a subscription is on after a
    // customer changes it, because `odesseus_tier` metadata is written once and
    // does not follow a plan change.
    expect(employerPlanForAmount(7900)?.tier).toBe("starter");
    expect(employerPlanForAmount(14900)?.tier).toBe("growth");
    expect(employerPlanForAmount(29900)?.tier).toBe("business");
  });

  it("returns null for an amount that is not a catalog price", () => {
    // A discounted or otherwise unrecognised price must fall back to metadata
    // rather than being silently mapped to the nearest plan.
    expect(employerPlanForAmount(7901)).toBeNull();
    expect(employerPlanForAmount(12000)).toBeNull();
    expect(employerPlanForAmount(0)).toBeNull();
  });

  it("returns null rather than a partial match for a near miss", () => {
    // Being off by a cent is a pricing problem, not a rounding question.
    expect(employerPlanForAmount(29901)).toBeNull();
    expect(employerPlanForAmount(14900 - 1)).toBeNull();
  });

  it("never resolves a seat or featured price to a plan", () => {
    // A $20 recruiter seat and a $29 featured listing are not plans. If either
    // resolved to one, a seat invoice would grant job-post credits.
    expect(employerPlanForAmount(employerRecruiterSeat.amountCents)).toBeNull();
    expect(employerPlanForAmount(2900)).toBeNull();
    expect(employerPlanForAmount(4900)).toBeNull();
    expect(employerPlanForAmount(12900)).toBeNull();
  });

  it("rejects non-integer and missing amounts instead of coercing them", () => {
    // `Number(null)` and `Number("")` are both 0, which is not a plan. Anything
    // that is not already a clean integer is not a price we recognise.
    expect(employerPlanForAmount(null)).toBeNull();
    expect(employerPlanForAmount(undefined)).toBeNull();
    expect(employerPlanForAmount(Number.NaN)).toBeNull();
    expect(employerPlanForAmount(14900.5)).toBeNull();
  });

  it("resolves every plan the catalog defines, so a new plan cannot be unreachable", () => {
    // A plan added to the catalog without this working would be sellable but
    // unsyncable, which is the same class of bug as the stale metadata.
    for (const plan of Object.values(employerPlans)) {
      expect(employerPlanForAmount(plan.amountCents)).toBe(plan);
    }
  });

  it("has distinct prices per plan, so an amount identifies exactly one tier", () => {
    // Two plans sharing a price would make the tier ambiguous and the grant
    // arbitrary.
    const prices = Object.values(employerPlans).map((p) => p.amountCents);
    expect(new Set(prices).size).toBe(prices.length);
  });
});

describe("applyRates", () => {
  it("prices Standard Apply at exactly $0.49 per verified successful submission", () => {
    expect(applyRates.standard.amountCents).toBe(49);
    expect(applyRates.standard.creditType).toBe("standard_apply");
  });

  it("prices Smart Apply at exactly $1.99 per verified successful submission", () => {
    expect(applyRates.smart.amountCents).toBe(199);
    expect(applyRates.smart.creditType).toBe("smart_apply");
  });

  it("exposes exactly the two contract apply modes", () => {
    expect(Object.keys(applyRates).sort()).toEqual(["smart", "standard"]);
  });
});

describe("billingCatalog", () => {
  it("offers wallet top-ups at $10 / $20 / $50 in minor units, matching their credit deltas", () => {
    expect(billingCatalog.wallet_10).toMatchObject({ amountCents: 1000, creditDelta: 1000, creditType: "wallet_topup" });
    expect(billingCatalog.wallet_20).toMatchObject({ amountCents: 2000, creditDelta: 2000, creditType: "wallet_topup" });
    expect(billingCatalog.wallet_50).toMatchObject({ amountCents: 5000, creditDelta: 5000, creditType: "wallet_topup" });
  });

  it("no longer sells pay-as-you-go application credits — Apply runs are wallet debits", () => {
    expect(billingCatalog).not.toHaveProperty("app_1");
    expect(billingCatalog).not.toHaveProperty("app_25");
    expect(billingCatalog).not.toHaveProperty("app_50");
    expect(billingCatalog).not.toHaveProperty("app_100");
  });

  it("prices one interview pass at exactly $24.99", () => {
    expect(billingCatalog.interview_1.amountCents).toBe(2499);
    expect(billingCatalog.interview_1.creditType).toBe("interview");
    expect(billingCatalog.interview_1.creditDelta).toBe(1);
  });

  it("prices the 3-pack interview pass bundle at $59.99 for 3 passes", () => {
    expect(billingCatalog.interview_3).toMatchObject({ amountCents: 5999, creditDelta: 3, creditType: "interview" });
  });

  it("prices Odesseus Live Annual at $499/year", () => {
    expect(billingCatalog.interview_annual.amountCents).toBe(49900);
    expect(billingCatalog.interview_annual.creditType).toBe("interview");
  });

  it("exposes exactly the wallet top-up and Live SKUs (no legacy application or employer SKUs yet)", () => {
    expect(Object.keys(billingCatalog).sort()).toEqual([
      "interview_1",
      "interview_3",
      "interview_annual",
      "wallet_10",
      "wallet_20",
      "wallet_50",
    ]);
  });
});

/**
 * Regression guard for a real M11 defect: the billing page still bound
 * `createCheckoutSession` to the retired `app_1` / `app_25` / `app_50` /
 * `app_100` SKUs after those products left the sellable catalog. The action
 * fails closed, so nothing could be charged — but every wallet top-up was
 * unreachable and all four forms dead-ended on "Invalid product". These
 * assertions keep the UI and the catalog from drifting apart again.
 */
describe("billing page checkout wiring", () => {
  const pagePath = path.resolve(
    import.meta.dirname,
    "../../src/app/billing/page.tsx"
  );
  const source = readFileSync(pagePath, "utf8");

  const boundSkus = [
    ...source.matchAll(/createCheckoutSession\.bind\(null,\s*"([^"]+)"\)/g),
  ].map((m) => m[1]);

  it("binds at least one checkout form to the action", () => {
    expect(boundSkus.length).toBeGreaterThan(0);
  });

  it("only binds SKUs that exist in the sellable catalog", () => {
    for (const sku of boundSkus) {
      expect(
        Object.hasOwn(billingCatalog, sku),
        `billing page binds "${sku}", which is not in billingCatalog — the checkout action would reject it`
      ).toBe(true);
    }
  });

  it("never binds a retired pay-as-you-go application credit SKU", () => {
    for (const sku of boundSkus) {
      expect(sku).not.toMatch(/^app_/);
    }
  });

  it("offers every wallet top-up so the wallet funding path is reachable", () => {
    const walletSkus = Object.keys(billingCatalog).filter((sku) =>
      sku.startsWith("wallet_")
    );
    for (const sku of walletSkus) {
      // WALLET_TOPUPS entries are bound via the mapped variable, so assert on
      // the declared list plus the top-up amounts being catalog-derived.
      expect(source).toContain(sku);
      expect(billingCatalog[sku as BillingSku].creditType).toBe("wallet_topup");
    }
    expect(walletSkus.sort()).toEqual(["wallet_10", "wallet_20", "wallet_50"]);
  });

  it("does not display a hardcoded per-application price that the catalog no longer sells", () => {
    // Amounts must come from the catalog so copy cannot drift from the charge.
    expect(source).not.toMatch(/\$0\.99/);
  });
});