import { describe, expect, it } from "vitest";
import { billingCatalog } from "@/lib/billing/catalog";

describe("billingCatalog", () => {
  it("prices one application credit at exactly $0.99", () => {
    expect(billingCatalog.app_1.amountCents).toBe(99);
    expect(billingCatalog.app_1.creditType).toBe("application");
    expect(billingCatalog.app_1.creditDelta).toBe(1);
  });

  it("prices one interview pass at exactly $24.99", () => {
    expect(billingCatalog.interview_1.amountCents).toBe(2499);
    expect(billingCatalog.interview_1.creditType).toBe("interview");
    expect(billingCatalog.interview_1.creditDelta).toBe(1);
  });

  it("prices application credit packs at their bundled rates", () => {
    expect(billingCatalog.app_25).toMatchObject({ amountCents: 2000, creditDelta: 25, creditType: "application" });
    expect(billingCatalog.app_50).toMatchObject({ amountCents: 3500, creditDelta: 50, creditType: "application" });
    expect(billingCatalog.app_100).toMatchObject({ amountCents: 5900, creditDelta: 100, creditType: "application" });
  });

  it("prices the 3-pack interview pass bundle at $59.99 for 3 passes", () => {
    expect(billingCatalog.interview_3).toMatchObject({ amountCents: 5999, creditDelta: 3, creditType: "interview" });
  });

  it("prices Odysseus Live Annual at $499/year", () => {
    expect(billingCatalog.interview_annual.amountCents).toBe(49900);
    expect(billingCatalog.interview_annual.creditType).toBe("interview");
  });

  it("exposes exactly the pay-as-you-go and bundle SKUs (no subscription SKU)", () => {
    expect(Object.keys(billingCatalog).sort()).toEqual([
      "app_1",
      "app_100",
      "app_25",
      "app_50",
      "interview_1",
      "interview_3",
      "interview_annual",
    ]);
  });
});
