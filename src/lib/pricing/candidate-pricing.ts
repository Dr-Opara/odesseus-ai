/**
 * Display-only candidate pricing.
 *
 * These are presentation constants for UI copy. They are NOT the billing
 * engine — the application credit is spent server-side by
 * `odesseus_finalize_application`, which reads the price from
 * `pricing_prices`.
 *
 * What matters is that the advertised price and the charged price cannot
 * drift apart, so every number here is *derived* from the backend-owned
 * catalog (`src/lib/billing/catalog.ts`, itself pinned to the USD_US
 * reference prices by a test) rather than written out again.
 *
 * Official prices are USD for now, so labels carry the currency explicitly
 * ("$0.99 USD") for international readers.
 */

import {
  APPLICATION_CREDIT_PRICE_CENTS,
  applicationCreditSkus,
  applyRates,
  billingCatalog,
} from "@/lib/billing/catalog";

export type ApplyTier = "standard" | "smart";

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "$0.99 USD" — the currency is explicit because prices are USD worldwide for now. */
export function formatUsd(cents: number): string {
  return `${formatCents(cents)} USD`;
}

export const APPLICATION_PRICE_LABEL = formatUsd(APPLICATION_CREDIT_PRICE_CENTS);

export const APPLY_TIERS: Record<
  ApplyTier,
  { label: string; priceCents: number; priceLabel: string; description: string }
> = {
  standard: {
    // "Apply", not the internal "Standard Apply" — product-locked display copy.
    label: applyRates.standard.label,
    priceCents: applyRates.standard.amountCents,
    priceLabel: APPLICATION_PRICE_LABEL,
    description:
      "Odesseus tailors your resume and submits the application after you approve it. One credit is used only after a verified successful submission.",
  },
  smart: {
    label: applyRates.smart.label,
    priceCents: applyRates.smart.amountCents,
    priceLabel: APPLICATION_PRICE_LABEL,
    description:
      "Everything in Apply, plus deeper automation for multi-page applications. Still needs your approval before submission, and uses one credit only on success.",
  },
};

/** Application credit packs as the billing UI shows them. */
export const APPLICATION_CREDIT_PACKS = applicationCreditSkus.map((sku) => {
  const item = billingCatalog[sku];
  const perCreditCents = Math.round(item.amountCents / item.creditDelta);
  return {
    sku,
    credits: item.creditDelta,
    priceCents: item.amountCents,
    priceLabel: formatUsd(item.amountCents),
    perCreditLabel: `${formatCents(perCreditCents)} per application`,
    savingsPercent:
      item.creditDelta > 1
        ? Math.round((1 - item.amountCents / (item.creditDelta * APPLICATION_CREDIT_PRICE_CENTS)) * 100)
        : 0,
  };
});

export const PREP_AGENT_LABEL = "Interview Prep";
export const PREP_AGENT_DESCRIPTION = "Practice from your job and application context.";
export const FAILED_SUBMISSION_LABEL = "Failed submission";
export const FAILED_SUBMISSION_PRICE_LABEL = "0 credits";
export const FAILED_SUBMISSION_DESCRIPTION =
  "Failed, unsupported, cancelled, closed-role or unconfirmed applications never use a credit.";

/** The two balances that can pay for an application. */
export type ApplyBalance =
  | { application_credits?: number | null; wallet_balance_cents?: number | null }
  | null
  | undefined;

/**
 * Whether a candidate can START an application: one prepaid credit, or — for
 * balances bought under the earlier wallet contract — the single-credit price
 * in the wallet. Nothing is charged at start; the settlement RPC spends the
 * credit only after a verified successful submission.
 */
export function canStartApply(balance: ApplyBalance): boolean {
  return (
    (balance?.application_credits ?? 0) >= 1 ||
    (balance?.wallet_balance_cents ?? 0) >= APPLICATION_CREDIT_PRICE_CENTS
  );
}

/** Applications the candidate can pay for right now (credits + legacy wallet). */
export function applicationsAvailable(balance: ApplyBalance): number {
  return (
    (balance?.application_credits ?? 0) +
    Math.floor((balance?.wallet_balance_cents ?? 0) / APPLICATION_CREDIT_PRICE_CENTS)
  );
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
