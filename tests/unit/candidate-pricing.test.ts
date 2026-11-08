import { describe, expect, it } from "vitest";
import {
  APPLICATION_CREDIT_PACKS,
  APPLICATION_PRICE_LABEL,
  APPLY_TIERS,
  EMPLOYER_PLANS,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  applicationsAvailable,
  canStartApply,
  formatCents,
  formatUsd,
} from "@/lib/pricing/candidate-pricing";
import { applyRates } from "@/lib/billing/catalog";
import * as candidatePricing from "@/lib/pricing/candidate-pricing";

describe("candidate apply tiers", () => {
  it("prices Apply and Smart Apply the same: $0.99 USD per successful application", () => {
    expect(APPLY_TIERS.standard.priceCents).toBe(99);
    expect(APPLY_TIERS.smart.priceCents).toBe(99);
    expect(APPLY_TIERS.standard.priceLabel).toBe("$0.99 USD");
    expect(APPLY_TIERS.smart.priceLabel).toBe("$0.99 USD");
    expect(APPLICATION_PRICE_LABEL).toBe("$0.99 USD");
    expect(APPLY_TIERS.standard.label).toBe("Apply");
    expect(APPLY_TIERS.smart.label).toBe("Smart Apply");
  });

  it("derives every advertised amount from the backend billing catalog", () => {
    expect(APPLY_TIERS.standard.priceCents).toBe(applyRates.standard.amountCents);
    expect(APPLY_TIERS.smart.priceCents).toBe(applyRates.smart.amountCents);
  });

  it("keeps the approval and success-only rules in the tier copy", () => {
    expect(APPLY_TIERS.standard.description.toLowerCase()).toMatch(/after you approve/);
    expect(APPLY_TIERS.standard.description.toLowerCase()).toMatch(/after a verified successful submission/);
    expect(APPLY_TIERS.smart.description.toLowerCase()).toMatch(/approval before submission/);
  });
});

describe("application credit packs", () => {
  it("offers 1 / 25 / 50 / 100 credits at $0.99 / $20 / $35 / $59 USD", () => {
    expect(APPLICATION_CREDIT_PACKS.map((p) => [p.credits, p.priceLabel])).toEqual([
      [1, "$0.99 USD"],
      [25, "$20 USD"],
      [50, "$35 USD"],
      [100, "$59 USD"],
    ]);
  });

  it("shows the discount against the single-credit price", () => {
    expect(APPLICATION_CREDIT_PACKS.map((p) => p.savingsPercent)).toEqual([0, 19, 29, 40]);
    expect(APPLICATION_CREDIT_PACKS.map((p) => p.perCreditLabel)).toEqual([
      "$0.99 per application",
      "$0.80 per application",
      "$0.70 per application",
      "$0.59 per application",
    ]);
  });
});

describe("apply eligibility", () => {
  it("allows a start with one application credit", () => {
    expect(canStartApply({ application_credits: 1, wallet_balance_cents: 0 })).toBe(true);
    expect(canStartApply({ application_credits: 0, wallet_balance_cents: 0 })).toBe(false);
    expect(canStartApply(null)).toBe(false);
  });

  it("keeps legacy wallet balances spendable at the single-credit price", () => {
    expect(canStartApply({ application_credits: 0, wallet_balance_cents: 98 })).toBe(false);
    expect(canStartApply({ application_credits: 0, wallet_balance_cents: 99 })).toBe(true);
  });

  it("counts applications available across credits and legacy wallet", () => {
    expect(applicationsAvailable({ application_credits: 3, wallet_balance_cents: 250 })).toBe(5);
    expect(applicationsAvailable({ application_credits: 0, wallet_balance_cents: 98 })).toBe(0);
    expect(applicationsAvailable(undefined)).toBe(0);
  });
});

describe("formatCents / formatUsd", () => {
  it("omits decimals on whole dollars", () => {
    expect(formatCents(2000)).toBe("$20");
    expect(formatCents(5900)).toBe("$59");
    expect(formatCents(100)).toBe("$1");
  });

  it("keeps two decimals below a dollar", () => {
    expect(formatCents(99)).toBe("$0.99");
  });

  it("labels the currency explicitly", () => {
    expect(formatUsd(99)).toBe("$0.99 USD");
    expect(formatUsd(3500)).toBe("$35 USD");
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

describe("Odesseus Live stays out of the public pricing module", () => {
  it("exports no Live plan list at all", () => {
    // Odesseus Live is private to signed-in applicants. This module is the
    // display catalogue every public pricing page imports, so the Live
    // session/pass/annual figures must not live here (they stay in the
    // auth-gated billing catalogue).
    expect("LIVE_PLANS" in candidatePricing).toBe(false);
  });

  it("carries none of the banned Live price figures as an export value", () => {
    const banned = ["$24.99", "$59.99", "$499"];
    const exported = Object.values(candidatePricing).map((value) => {
      if (value === null || value === undefined) return "";
      return typeof value === "function" ? "" : JSON.stringify(value);
    });
    for (const token of banned) {
      expect(exported.some((text) => text.includes(token))).toBe(false);
    }
  });
});
