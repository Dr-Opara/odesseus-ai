import { describe, expect, it } from "vitest";
import { applyRates, billingCatalog } from "@/lib/billing/catalog";

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