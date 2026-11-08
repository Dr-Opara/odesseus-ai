// Candidate billing surface for the current pricing contract.
//
// Applications: $0.99 USD per verified successful submission, paid with
// prepaid application credits (1 credit = 1 submission). Credits are sold
// singly or in discounted packs. The credit is spent server-side by
// `odesseus_finalize_application` only after the submission is verified;
// failed, unsupported, cancelled, closed-role or unconfirmed applications
// consume nothing. Apply and Smart Apply cost the same — they differ in
// automation depth, not price.
//
// Odesseus Live: $24.99 per interview, 3 passes for $59.99, or Annual at
// $499 for 12 months (fair use). All one-time purchases — no required
// subscription. A pass is consumed only when a Live session activates.
//
// Every SKU below maps onto a product the database already fulfills through
// `odesseus_private.fulfill_billing_event` (see
// supabase/migrations/20261123000000_spec_candidate_pricing.sql), and its
// amount mirrors the USD_US reference price for `productKey`. A static test
// pins this file to those rows so the advertised and charged prices cannot
// drift.
//
// Employer products (plans, featured listings, recruiter seats) are NOT part
// of `billingCatalog`: they are sold through Stripe subscription/one-time
// checkouts and are exported below as `employerPlans`,
// `employerRecruiterSeat`, and `employerFeaturedTiers` so the webhook can
// verify paid amounts server-side before granting entitlements.
//
// Odesseus Live is NOT advertised on the public marketing site. Its SKUs exist
// for the authenticated interview workflow only.

/** Price of one application credit — one verified successful submission. */
export const APPLICATION_CREDIT_PRICE_CENTS = 99;

export const applyRates = {
  standard: {
    label: "Apply",
    description: "One verified successful submission across supported job boards and employer career sites",
    amountCents: APPLICATION_CREDIT_PRICE_CENTS,
    credits: 1,
  },
  smart: {
    label: "Smart Apply",
    description: "One verified successful submission with deeper automation for multi-page applications",
    amountCents: APPLICATION_CREDIT_PRICE_CENTS,
    credits: 1,
  },
} as const;

export type ApplyMode = keyof typeof applyRates;

export type BillingSku = keyof typeof billingCatalog;

export const billingCatalog = {
  app_1: { label: "1 application credit", description: "One verified successful application submission", amountCents: 99, creditType: "application" as const, creditDelta: 1, productKey: "candidate_application_single" },
  app_25: { label: "25 application credits", description: "25 verified successful application submissions", amountCents: 2000, creditType: "application" as const, creditDelta: 25, productKey: "candidate_application_pack_25" },
  app_50: { label: "50 application credits", description: "50 verified successful application submissions", amountCents: 3500, creditType: "application" as const, creditDelta: 50, productKey: "candidate_application_pack_50" },
  app_100: { label: "100 application credits", description: "100 verified successful application submissions", amountCents: 5900, creditType: "application" as const, creditDelta: 100, productKey: "candidate_application_pack_100" },
  interview_1: { label: "Odesseus Live — 1 interview", description: "One Odesseus Live interview pass", amountCents: 2499, creditType: "interview" as const, creditDelta: 1, productKey: "candidate_live_single" },
  interview_3: { label: "Odesseus Live — 3 interviews", description: "Three Odesseus Live interview passes", amountCents: 5999, creditType: "interview" as const, creditDelta: 3, productKey: "candidate_live_pack_3" },
  // creditDelta is only there to satisfy billing_events_credit_delta_check:
  // fulfill_billing_event branches on sku = 'interview_annual' and grants a
  // 12-month live_unlimited_until window instead of passes.
  interview_annual: { label: "Odesseus Live Annual", description: "12 months of Odesseus Live, subject to fair use", amountCents: 49900, creditType: "interview" as const, creditDelta: 1, productKey: "candidate_live_annual" },
} as const;

/** Application-credit SKUs, in display order. */
export const applicationCreditSkus = ["app_1", "app_25", "app_50", "app_100"] as const satisfies readonly BillingSku[];

/** Live SKUs, in the order the interview workflow presents them. */
export const liveSkus = ["interview_1", "interview_3", "interview_annual"] as const satisfies readonly BillingSku[];

export type LiveSku = (typeof liveSkus)[number];

/**
 * Live subscriptions sold under the earlier contract. They are no longer
 * offered, but existing subscribers keep renewing, so the webhook must still
 * recognise their invoices at the amounts they signed up for.
 */
export const legacyLiveSubscriptions = {
  live_monthly: { label: "Live — monthly", amountCents: 1999, planType: "monthly" as const },
  live_personal_annual: { label: "Live — personal annual", amountCents: 9900, planType: "personal_annual" as const },
  live_share_annual: { label: "Live Share — annual", amountCents: 49900, planType: "share_annual" as const },
} as const;

export type LegacyLiveSubscriptionSku = keyof typeof legacyLiveSubscriptions;

/*
 * There is deliberately no guest allowance constant here. Live Share has no
 * guest cap: what authorizes guest link generation is the entitlement
 * (has_access && is_owner && plan === 'share_annual'), and per-token rate
 * limits on the guest routes are abuse protection, not a commercial quota.
 */

/**
 * Fair-use ceiling for time-boxed Live access (Annual).
 *
 * The authoritative values live in the database; this is the mirror used for
 * display and pre-flight checks only.
 */
export const LIVE_FAIR_USE = {
  sessions: 20,
  windowDays: 30,
} as const;

// Employer plans are recurring subscriptions. The AI Starter Bundle is the
// plan for sale: $100 every 30 days, 5 base job-post credits per cycle that
// expire at the cycle end (no rollover). Starter / Growth / Business are the
// earlier plans; they are no longer sold, but existing subscribers keep
// renewing, so the webhook must still recognise their invoices.
//
// jobPostsIncluded is the per-cycle base-credit grant. The webhook verifies
// the paid invoice amount against this catalog before granting a cycle.
export const employerPlans = {
  employer_ai_starter: {
    label: "AI Starter Bundle",
    description: "5 job-post credits every 30 days, with AI candidate matching",
    amountCents: 10000,
    tier: "ai_starter" as const,
    jobPostsIncluded: 5,
    sellable: true,
  },
  employer_starter: {
    label: "Employer Starter",
    description: "3 active job postings per month",
    amountCents: 7900,
    tier: "starter" as const,
    jobPostsIncluded: 3,
    sellable: false,
  },
  employer_growth: {
    label: "Employer Growth",
    description: "10 active job postings per month",
    amountCents: 14900,
    tier: "growth" as const,
    jobPostsIncluded: 10,
    sellable: false,
  },
  employer_business: {
    label: "Employer Business",
    description: "25 active job postings per month",
    amountCents: 29900,
    tier: "business" as const,
    jobPostsIncluded: 25,
    sellable: false,
  },
} as const;

/** Billing cadence of the AI Starter Bundle: every 30 days, not monthly. */
export const AI_STARTER_BILLING_INTERVAL = { interval: "day" as const, intervalCount: 30 };

/**
 * Additional job posts: $10 each, one-time, sold only while the org has an
 * active AI Starter Bundle. Each purchase gets its own 30-day credit clock.
 */
export const employerAddonPost = {
  label: "Additional job post",
  description: "One job-post credit, valid for 30 days from purchase",
  amountCents: 1000,
  maxQuantity: 50,
  validDays: 30,
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