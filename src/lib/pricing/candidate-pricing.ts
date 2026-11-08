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

/**
 * Employer pricing for display. The AI Starter Bundle is the only plan sold:
 * $100 USD every 30 days with 5 base job-post credits that must be used in
 * that cycle (no rollover). Additional job posts are $10 each while the bundle
 * is active, and each one is valid for 30 days from purchase.
 *
 * Positioned as AI-powered hiring infrastructure, not "cheap job posts".
 */
export const EMPLOYER_PLANS = [
  {
    id: "ai_starter",
    name: "AI Starter Bundle",
    priceLabel: "$100",
    unit: "/ 30 days",
    jobs: "5 job-post credits every 30 days",
    activeJobLimit: 5,
    features: [
      "5 job-post credits every 30 days",
      "Each post stays live for 30 days",
      "AI candidate matching and Fit Scores",
      "Applicant pipeline and shortlists",
      "Additional posts $10 each",
    ],
  },
] as const;

export const ADDON_JOB_POST_PRICE_LABEL = "$10";
export const ADDON_JOB_POST_UNIT = "per additional job post";
export const EMPLOYER_PRICING_NOTE =
  "Because Odesseus automates candidate matching and distribution, we pass the infrastructure savings directly to employers.";

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
