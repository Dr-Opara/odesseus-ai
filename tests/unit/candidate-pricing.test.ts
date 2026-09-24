import { describe, expect, it } from "vitest";
import {
  APPLY_TIERS,
  EMPLOYER_PLANS,
  LIVE_PLANS,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  WALLET_TOPUP_AMOUNTS_CENTS,
  formatCents,
} from "@/lib/pricing/candidate-pricing";

describe("candidate apply tiers", () => {
  it("prices Standard Apply at exactly $0.49", () => {
    expect(APPLY_TIERS.standard.priceCents).toBe(49);
    expect(APPLY_TIERS.standard.priceLabel).toBe("$0.49");
    expect(APPLY_TIERS.standard.label).toBe("Standard Apply");
  });

  it("prices Smart Apply at exactly $1.99", () => {
    expect(APPLY_TIERS.smart.priceCents).toBe(199);
    expect(APPLY_TIERS.smart.priceLabel).toBe("$1.99");
    expect(APPLY_TIERS.smart.label).toBe("Smart Apply");
  });

  it("has no stale $0.99 per-application figure anywhere in the candidate tiers", () => {
    for (const info of Object.values(APPLY_TIERS)) {
      expect(info.priceLabel).not.toBe("$0.99");
      expect(info.priceCents).not.toBe(99);
    }
  });

  it("keeps the charged-after-successful-submission rule on the standard tier and the pre-submission check framing on smart", () => {
    expect(APPLY_TIERS.standard.description.toLowerCase()).toMatch(/after a verified successful submission/);
    expect(APPLY_TIERS.smart.description.toLowerCase()).toMatch(/before submission/);
  });
});

describe("wallet top-ups", () => {
  it("offers exactly $10 / $20 / $50 top-ups", () => {
    expect(WALLET_TOPUP_AMOUNTS_CENTS).toEqual([1000, 2000, 5000]);
    expect(WALLET_TOPUP_AMOUNTS_CENTS.map(formatCents)).toEqual(["$10", "$20", "$50"]);
  });
});

describe("formatCents", () => {
  it("omits decimals on whole dollars", () => {
    expect(formatCents(1000)).toBe("$10");
    expect(formatCents(2000)).toBe("$20");
    expect(formatCents(5000)).toBe("$50");
    expect(formatCents(100)).toBe("$1");
  });

  it("keeps two decimals below a dollar", () => {
    expect(formatCents(49)).toBe("$0.49");
    expect(formatCents(199)).toBe("$1.99");
    expect(formatCents(99)).toBe("$0.99");
  });
});

describe("employer plans", () => {
  it("advertises starter/growth/business monthly plans", () => {
    expect(EMPLOYER_PLANS.map((p) => p.name)).toEqual(["Starter", "Growth", "Business"]);
    expect(EMPLOYER_PLANS[0].priceLabel).toBe("$79");
    expect(EMPLOYER_PLANS[1].priceLabel).toBe("$149");
    expect(EMPLOYER_PLANS[2].priceLabel).toBe("$299");
  });

  it("calls out a per-recruiter seat price", () => {
    expect(RECRUITER_SEAT_PRICE_LABEL).toBe("$20");
  });

  it("keeps promotion plans priced per 7/14/30 days", () => {
    expect(PROMOTION_PLANS.map((p) => `${p.priceLabel}${p.unit}`)).toEqual([
      "$29/ 7 days",
      "$49/ 14 days",
      "$129/ 30 days",
    ]);
  });
});

describe("Odesseus Live plans", () => {
  it("keeps the $24.99 single session as the first plan", () => {
    expect(LIVE_PLANS[0].priceLabel).toBe("$24.99");
  });

  it("keeps the 3-pass and annual options", () => {
    expect(LIVE_PLANS[1].priceLabel).toBe("$59.99");
    expect(LIVE_PLANS[2].priceLabel).toBe("$499");
  });
});