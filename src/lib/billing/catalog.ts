// Candidate billing surface for the current pricing contract.
//
// Apply submissions are wallet debits at a per-mode rate — Standard Apply
// 49¢ and Smart Apply 199¢ per verified successful submission — never a
// checkout SKU. Candidates preload a monetary wallet through the wallet_*
// top-up SKUs below; the debit is applied server-side by the atomic
// finalization RPC only after the submission is verified as successful.
//
// Employer products (plans, featured listings, recruiter seats) are sold
// through Stripe subscriptions in a later milestone and deliberately do not
// appear in this one-time checkout catalog yet. Odesseus Live SKUs are
// unchanged from the legacy catalog.

export const applyRates = {
  standard: {
    label: "Standard Apply",
    description: "One verified successful submission across supported job boards and employer career sites",
    amountCents: 49,
    creditType: "standard_apply" as const,
  },
  smart: {
    label: "Smart Apply",
    description: "One verified successful submission with deeper automation for multi-page applications",
    amountCents: 199,
    creditType: "smart_apply" as const,
  },
} as const;

export type ApplyMode = keyof typeof applyRates;

export type BillingSku = keyof typeof billingCatalog;

export const billingCatalog = {
  wallet_10: { label: "Wallet top-up — $10", description: "Add $10 to your wallet for Standard and Smart Apply submissions", amountCents: 1000, creditType: "wallet_topup" as const, creditDelta: 1000 },
  wallet_20: { label: "Wallet top-up — $20", description: "Add $20 to your wallet for Standard and Smart Apply submissions", amountCents: 2000, creditType: "wallet_topup" as const, creditDelta: 2000 },
  wallet_50: { label: "Wallet top-up — $50", description: "Add $50 to your wallet for Standard and Smart Apply submissions", amountCents: 5000, creditType: "wallet_topup" as const, creditDelta: 5000 },
  interview_1: { label: "1 live interview pass", description: "One Odesseus Live interview session", amountCents: 2499, creditType: "interview" as const, creditDelta: 1 },
  interview_3: { label: "3 live interview passes", description: "Three Odesseus Live interview sessions", amountCents: 5999, creditType: "interview" as const, creditDelta: 3 },
  // Time-boxed entitlement, not a discrete-pass grant: fulfillment (see the
  // add_live_annual_entitlement migration) sets credit_balances.live_unlimited_until
  // instead of applying creditDelta to interview_passes. creditDelta stays a
  // positive placeholder only to satisfy billing_events_credit_delta_check.
  interview_annual: { label: "Odesseus Live Annual", description: "Odesseus Live access for 12 months, subject to fair use", amountCents: 49900, creditType: "interview" as const, creditDelta: 1 },
} as const;

// Employer plans are recurring subscriptions: the recurring plan price is the
// monthly charge, and jobPostsIncluded is the per-cycle job-post credit grant
// (Starter 3 / Growth 10 / Business 25). These are not one-time checkout SKUs:
// they are sold through a subscription checkout, and the webhook verifies the
// paid invoice amount against this catalog before granting a cycle's credits.
export const employerPlans = {
  employer_starter: {
    label: "Employer Starter",
    description: "3 active job postings per month",
    amountCents: 7900,
    tier: "starter" as const,
    jobPostsIncluded: 3,
  },
  employer_growth: {
    label: "Employer Growth",
    description: "10 active job postings per month",
    amountCents: 14900,
    tier: "growth" as const,
    jobPostsIncluded: 10,
  },
  employer_business: {
    label: "Employer Business",
    description: "25 active job postings per month",
    amountCents: 29900,
    tier: "business" as const,
    jobPostsIncluded: 25,
  },
} as const;

export type EmployerPlanSku = keyof typeof employerPlans;

export type EmployerPlan = (typeof employerPlans)[EmployerPlanSku];

/**
 * The catalog entry for a recurring employer plan charged `amountCents`.
 *
 * This is how the webhook learns which plan a subscription is *on* when a
 * customer upgrades or downgrades. `odesseus_tier` in Stripe metadata is set once
 * at subscription creation and does not follow a plan change made in the Stripe
 * dashboard or the customer portal, so trusting it after an upgrade means
 * recording the old tier, the old job-post quota, and -- worse -- rejecting the
 * upgrade's own invoice as an amount mismatch.
 *
 * The money is the authority. It is also self-verifying: a plan is only returned
 * when the charged amount is exactly that plan's catalog price, so this cannot
 * widen what the webhook accepts. It is still keyed on metadata for *which org*
 * the subscription belongs to, which Stripe does not change on a plan change.
 *
 * Returns null for an amount that is not a catalog price, so a discounted or
 * otherwise unrecognised price can fall back to metadata rather than being
 * silently mapped to the wrong tier.
 */
export function employerPlanForAmount(
  amountCents: number | null | undefined
): EmployerPlan | null {
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) return null;
  return (
    Object.values(employerPlans).find(
      (plan) => plan.amountCents === amountCents
    ) ?? null
  );
}

// Recruiter seats are billed per seat per month ($20). Each seat is a line on
// an employer subscription; a subscription's seat_count x 2000 must match the
// paid invoice before the webhook syncs recruiter_seats.
export const employerRecruiterSeat = {
  label: "Recruiter Seat",
  description: "Additional employer-team seat, billed monthly per seat",
  amountCents: 2000,
} as const;

// Featured listings are one-time purchases: boosted visibility for a fixed
// window. tier values match public.featured_listings.tier exactly (the webhook
// passes them through to odesseus_create_featured_listing after verifying the
// paid checkout amount against this catalog).
export const employerFeaturedTiers = {
  featured_7d: {
    label: "Featured — 7 days",
    description: "Boosted visibility for 7 days",
    amountCents: 2900,
    days: 7,
  },
  featured_14d: {
    label: "Featured — 14 days",
    description: "Boosted visibility for 14 days",
    amountCents: 4900,
    days: 14,
  },
  ai_30d: {
    label: "AI Featured — 30 days",
    description: "AI-assisted boosted visibility for 30 days",
    amountCents: 12900,
    days: 30,
  },
} as const;

export type EmployerFeaturedTier = keyof typeof employerFeaturedTiers;