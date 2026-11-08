import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AI_STARTER_BILLING_INTERVAL,
  APPLICATION_CREDIT_PRICE_CENTS,
  applicationCreditSkus,
  applyRates,
  billingCatalog,
  type BillingSku,
  employerAddonPost,
  employerPlans,
  employerPlanForAmount,
  employerRecruiterSeat,
  legacyLiveSubscriptions,
  liveSkus,
} from "@/lib/billing/catalog";

describe("employerPlanForAmount", () => {
  it("resolves each catalog price to its own tier", () => {
    // The webhook uses this to learn which plan a subscription is on after a
    // customer changes it, because `odesseus_tier` metadata is written once and
    // does not follow a plan change.
    expect(employerPlanForAmount(10000)?.tier).toBe("ai_starter");
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
    // A $10 add-on is a one-time purchase, never a plan.
    expect(employerPlanForAmount(employerAddonPost.amountCents)).toBeNull();
  });

  it("sells only the AI Starter Bundle: $100 every 30 days with 5 base credits", () => {
    const sellable = Object.values(employerPlans).filter((plan) => plan.sellable);
    expect(sellable).toHaveLength(1);
    expect(sellable[0]).toMatchObject({ tier: "ai_starter", amountCents: 10000, jobPostsIncluded: 5 });
    expect(AI_STARTER_BILLING_INTERVAL).toEqual({ interval: "day", intervalCount: 30 });
    expect(employerAddonPost).toMatchObject({ amountCents: 1000, validDays: 30 });
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
  it("prices every verified successful submission at one application credit ($0.99)", () => {
    expect(APPLICATION_CREDIT_PRICE_CENTS).toBe(99);
    expect(applyRates.standard.amountCents).toBe(99);
    expect(applyRates.smart.amountCents).toBe(99);
    expect(applyRates.standard.credits).toBe(1);
    expect(applyRates.smart.credits).toBe(1);
  });

  it("exposes exactly the two apply modes", () => {
    expect(Object.keys(applyRates).sort()).toEqual(["smart", "standard"]);
  });
});

describe("billingCatalog", () => {
  it("sells application credits: 1 = $0.99, 25 = $20, 50 = $35, 100 = $59", () => {
    expect(billingCatalog.app_1).toMatchObject({ amountCents: 99, creditDelta: 1, creditType: "application" });
    expect(billingCatalog.app_25).toMatchObject({ amountCents: 2000, creditDelta: 25, creditType: "application" });
    expect(billingCatalog.app_50).toMatchObject({ amountCents: 3500, creditDelta: 50, creditType: "application" });
    expect(billingCatalog.app_100).toMatchObject({ amountCents: 5900, creditDelta: 100, creditType: "application" });
  });

  it("sells Odesseus Live: 1 pass = $24.99, 3 passes = $59.99, Annual = $499", () => {
    expect(billingCatalog.interview_1).toMatchObject({ amountCents: 2499, creditDelta: 1, creditType: "interview" });
    expect(billingCatalog.interview_3).toMatchObject({ amountCents: 5999, creditDelta: 3, creditType: "interview" });
    // creditDelta only satisfies billing_events_credit_delta_check: the
    // fulfillment trigger branches on sku = 'interview_annual'.
    expect(billingCatalog.interview_annual).toMatchObject({ amountCents: 49900, creditType: "interview" });
  });

  it("sells only one-time products — no required subscription", () => {
    for (const item of Object.values(billingCatalog)) {
      expect(item).not.toHaveProperty("billing");
      expect(item).not.toHaveProperty("planType");
    }
  });

  it("no longer sells wallet top-ups or Live subscriptions", () => {
    for (const retired of ["wallet_10", "wallet_20", "wallet_50", "live_single", "live_monthly", "live_personal_annual", "live_share_annual"]) {
      expect(billingCatalog).not.toHaveProperty(retired);
    }
  });

  it("exposes exactly the application-credit and Live SKUs", () => {
    expect(Object.keys(billingCatalog).sort()).toEqual([
      "app_1",
      "app_100",
      "app_25",
      "app_50",
      "interview_1",
      "interview_3",
      "interview_annual",
    ]);
    expect([...applicationCreditSkus]).toEqual(["app_1", "app_25", "app_50", "app_100"]);
    expect([...liveSkus]).toEqual(["interview_1", "interview_3", "interview_annual"]);
  });

  it("maps every SKU to the reference product whose price it mirrors", () => {
    const migration = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20261123000000_spec_candidate_pricing.sql"),
      "utf8"
    );
    for (const item of Object.values(billingCatalog)) {
      expect(migration).toMatch(new RegExp(`\\('${item.productKey}',\\s+${item.amountCents}\\)`));
    }
  });

  it("keeps recognising legacy Live subscriptions at the prices they were sold for", () => {
    expect(legacyLiveSubscriptions.live_monthly).toMatchObject({ amountCents: 1999, planType: "monthly" });
    expect(legacyLiveSubscriptions.live_personal_annual).toMatchObject({ amountCents: 9900, planType: "personal_annual" });
    expect(legacyLiveSubscriptions.live_share_annual).toMatchObject({ amountCents: 49900, planType: "share_annual" });
  });
});

/**
 * Keeps the billing page's checkout forms and the sellable catalog from
 * drifting apart: an unknown SKU dead-ends on "Invalid product".
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

  it("binds checkout through the catalog-derived pack and Live lists", () => {
    expect(source).toContain("createCheckoutSession.bind(null, pack.sku)");
    expect(source).toContain("createCheckoutSession.bind(null, sku)");
    expect(source).toContain("APPLICATION_CREDIT_PACKS.map(");
    expect(source).toContain("liveSkus.map(");
  });

  it("only binds literal SKUs that exist in the sellable catalog", () => {
    for (const sku of boundSkus) {
      expect(
        Object.hasOwn(billingCatalog, sku as BillingSku),
        `billing page binds "${sku}", which is not in billingCatalog — the checkout action would reject it`
      ).toBe(true);
    }
  });

  it("never binds a retired wallet top-up SKU", () => {
    expect(source).not.toMatch(/"wallet_(10|20|50)"/);
  });

  it("does not hardcode prices — amounts come from the catalog", () => {
    expect(source).not.toMatch(/\$(0\.99|20|35|59|24\.99|59\.99|499)\b/);
  });
});
