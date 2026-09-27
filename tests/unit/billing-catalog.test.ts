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
  it("prices Standard Apply at exactly $0.39 per verified successful submission", () => {
    expect(applyRates.standard.amountCents).toBe(39);
    expect(applyRates.standard.creditType).toBe("standard_apply");
  });

  it("prices Smart Apply at exactly $0.99 per verified successful submission", () => {
    expect(applyRates.smart.amountCents).toBe(99);
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

  // Every Live SKU records creditType "interview": billing_events_credit_type_check
  // admits only application/interview/wallet_topup, and odesseus_private.fulfill_billing_event
  // branches on the product key (sku), not credit_type, to decide whether a
  // purchase becomes a discrete pass or a live_memberships row. Widening the
  // CHECK constraint to carry per-plan credit types is unneeded complexity
  // this contract deliberately avoids.
  it("prices Live Single at exactly $14.99 per session", () => {
    expect(billingCatalog.live_single.amountCents).toBe(1499);
    expect(billingCatalog.live_single.creditType).toBe("interview");
    expect(billingCatalog.live_single.creditDelta).toBe(1);
  });

  it("prices Live Monthly at exactly $19.99/month", () => {
    expect(billingCatalog.live_monthly.amountCents).toBe(1999);
    expect(billingCatalog.live_monthly.creditType).toBe("interview");
    expect(billingCatalog.live_monthly.creditDelta).toBe(1);
  });

  it("prices Live Personal Annual at exactly $99/year", () => {
    expect(billingCatalog.live_personal_annual.amountCents).toBe(9900);
    expect(billingCatalog.live_personal_annual.creditType).toBe("interview");
    expect(billingCatalog.live_personal_annual.creditDelta).toBe(1);
  });

  it("prices Live Share Annual at exactly $499/year", () => {
    expect(billingCatalog.live_share_annual.amountCents).toBe(49900);
    expect(billingCatalog.live_share_annual.creditType).toBe("interview");
    expect(billingCatalog.live_share_annual.creditDelta).toBe(1);
  });

  it("exposes exactly the wallet top-up and Live SKUs (no legacy application or employer SKUs yet)", () => {
    expect(Object.keys(billingCatalog).sort()).toEqual([
      "live_monthly",
      "live_personal_annual",
      "live_share_annual",
      "live_single",
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