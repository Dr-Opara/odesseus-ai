/**
 * Display-only candidate pricing for the wallet/pay-per-apply contract.
 *
 * These are presentation constants for UI copy. They are NOT the billing
 * engine — the wallet debit is performed server-side by
 * `odesseus_finalize_application`, which reads the rate from `pricing_prices`.
 *
 * What matters is that the advertised rate and the charged rate cannot drift
 * apart, so the numbers here are *derived* from the backend-owned catalog
 * (`src/lib/billing/catalog.ts`, itself pinned to the USD_US reference prices
 * by a test) rather than written out again. This module used to hardcode
 * 49c/199c while the catalog and the database had already moved to 39c/99c,
 * which meant the site quoted a price the candidate was never charged.
 */

import { applyRates } from "@/lib/billing/catalog";

export type ApplyTier = "standard" | "smart";

export const APPLY_TIERS: Record<
  ApplyTier,
  { label: string; priceCents: number; priceLabel: string; description: string }
> = {
  standard: {
    // Label is the Figma/product-locked display copy ("Apply", not the
    // catalog's internal "Standard Apply") — amount is derived from the
    // billing catalog so the advertised rate can never drift from the
    // charged rate (see this file's header comment for why that matters).
    label: "Apply",
    priceCents: applyRates.standard.amountCents,
    priceLabel: `$${(applyRates.standard.amountCents / 100).toFixed(2)}`,
    description:
      "Odesseus tailors your resume and submits the application. Charged only after a verified successful submission.",
  },
  smart: {
    label: "Smart Apply",
    priceCents: applyRates.smart.amountCents,
    priceLabel: `$${(applyRates.smart.amountCents / 100).toFixed(2)}`,
    description:
      "Everything in Apply, plus deeper role-specific tailoring and a closer pass on hard requirements before submission.",
  },
};

export const PREP_AGENT_LABEL = "Interview Prep";
export const PREP_AGENT_DESCRIPTION = "Practice from your job and application context.";
export const FAILED_SUBMISSION_LABEL = "Failed submission";
export const FAILED_SUBMISSION_PRICE_LABEL = "$0";
export const FAILED_SUBMISSION_DESCRIPTION = "No verified success means no application charge.";

export const WALLET_TOPUP_AMOUNTS_CENTS = [1000, 2000, 5000] as const;
export type WalletTopUpAmountCents = (typeof WALLET_TOPUP_AMOUNTS_CENTS)[number];

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Minimum wallet balance (cents) required to START any apply. The cheapest
 * tier is Apply, so no candidate with less than this can begin an
 * application — charging only happens on verified successful submission, but
 * the start gate uses the tier price so no one burns an assisted run they
 * cannot pay for.
 */
export const MIN_APPLY_PRICE_CENTS = APPLY_TIERS.standard.priceCents;

/**
 * Wallet-based eligibility for a single apply tier, at the tier's real rate.
 * Application-credit balances never participate in apply eligibility.
 */
export function canAffordTier(tier: ApplyTier, walletBalanceCents: number): boolean {
  return walletBalanceCents >= APPLY_TIERS[tier].priceCents;
}

export const PREP_AGENT_PRICE_LABEL = "Free";

export const EMPLOYER_PLANS = [
  {
    name: "Starter",
    priceLabel: "$79",
    unit: "/mo",
    jobs: "3 active jobs",
    activeJobLimit: 3,
    features: ["3 active jobs", "Applicant pipeline", "Employer dashboard"],
  },
  {
    name: "Growth",
    priceLabel: "$149",
    unit: "/mo",
    jobs: "10 active jobs",
    activeJobLimit: 10,
    features: ["10 active jobs", "Basic analytics", "Applicant pipeline", "Employer dashboard"],
  },
  {
    name: "Business",
    priceLabel: "$299",
    unit: "/mo",
    jobs: "25 active jobs",
    activeJobLimit: 25,
    features: [
      "25 active jobs",
      "AI candidate matching",
      "Multiple recruiter seats",
      "Applicant pipeline",
      "Employer dashboard",
    ],
  },
] as const;

export const PROMOTION_PLANS = [
  { name: "Featured", priceLabel: "$29", unit: "/ 7 days" },
  { name: "Featured", priceLabel: "$49", unit: "/ 14 days" },
  { name: "AI Featured", priceLabel: "$129", unit: "/ 30 days" },
] as const;

export const RECRUITER_SEAT_PRICE_LABEL = "$20";
export const RECRUITER_SEAT_UNIT = "/month per additional seat";

// Odesseus Live pricing is intentionally NOT part of this module.
//
// Odesseus Live is private to signed-in applicants and must never appear on a
// public surface (see tests/e2e/live-visibility.spec.ts and
// tests/unit/live-public-surface.test.ts). This file is the display-only
// pricing catalogue that every public and candidate pricing page imports, so
// keeping the Live session/pass/annual figures here made it a one-import leak
// away from a public page. The live prices remain in the billing catalogue
// (`src/lib/billing/catalog.ts`), which is backend-owned, auth-gated, and not
// reachable from any public route.
