/**
 * Employer plan, quota and promotion data (Phase 5).
 *
 * This module is the single source of truth for the *approved* employer
 * commercial terms and for the vocabulary the database actually stores. It is
 * deliberately a sibling of `src/lib/pricing/candidate-pricing.ts` (which owns
 * the public, display-only catalogue) rather than a copy of it: the employer
 * dashboard has to map a stored `employer_subscriptions.tier` string onto a
 * plan, and that mapping is a data question, not a marketing one.
 *
 * Two rules govern this file:
 *
 * 1. The tier / promotion keys are exactly the check-constraint values in the
 *    live schema (`ai_starter|starter|growth|business` and
 *    `featured_7d|featured_14d|ai_30d`). A new stored tier that is not mapped
 *    here must degrade to an honest "unrecognised plan" state rather than
 *    silently inherit some other plan's numbers.
 * 2. Prices and included job posts are approved commercial terms. They are
 *    never derived from user input and never adjusted in the client. The
 *    `tests/unit/employer-pricing.test.ts` guard pins them so a marketing edit
 *    cannot quietly desynchronise from the numbers a signed-in employer sees.
 */

/**
 * Subscription tiers as stored in `employer_subscriptions.tier`.
 *
 * `ai_starter` is the AI Starter Bundle — the plan for sale. `starter`,
 * `growth` and `business` are earlier plans kept so existing subscribers keep
 * resolving to the terms they bought.
 */
export const EMPLOYER_TIERS = ["ai_starter", "starter", "growth", "business"] as const;

/** The only tier offered for new purchases. */
export const SELLABLE_EMPLOYER_TIER = "ai_starter" as const;
export type EmployerTier = (typeof EMPLOYER_TIERS)[number];

/** Member roles as stored in `employer_members.role`. */
export const EMPLOYER_MEMBER_ROLES = ["owner", "admin", "recruiter", "viewer"] as const;
export type EmployerMemberRole = (typeof EMPLOYER_MEMBER_ROLES)[number];

/** Job statuses as stored in `employer_jobs.status`. */
export const EMPLOYER_JOB_STATUSES = ["draft", "published", "paused", "closed", "expired"] as const;
export type EmployerJobStatus = (typeof EMPLOYER_JOB_STATUSES)[number];

/** Subscription statuses as stored in `employer_subscriptions.status`. */
export const EMPLOYER_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "active",
  "past_due",
  "canceled",
  "trialing",
] as const;
export type EmployerSubscriptionStatus = (typeof EMPLOYER_SUBSCRIPTION_STATUSES)[number];

/** Promotion tiers as stored in `featured_listings.tier`. */
export const FEATURED_TIERS = ["featured_7d", "featured_14d", "ai_30d"] as const;
export type FeaturedTier = (typeof FEATURED_TIERS)[number];

export type EmployerPlan = {
  tier: EmployerTier;
  name: string;
  /** Price per billing cycle in whole US dollars, as approved. */
  priceUsd: number;
  priceLabel: string;
  unit: string;
  /** Job posts included in the subscription period, as approved. */
  jobPostsIncluded: number;
  /** Copy for the included quota. */
  jobsLabel: string;
  /** False for earlier plans that existing subscribers keep but nobody can buy. */
  sellable: boolean;
};

/**
 * The approved employer subscriptions. `jobPostsIncluded` is the same number
 * the public pricing page advertises as "N active jobs", kept here as a real
 * integer so the dashboard can show remaining quota without parsing copy.
 */
export const EMPLOYER_PLAN_BY_TIER: Record<EmployerTier, EmployerPlan> = {
  ai_starter: {
    tier: "ai_starter",
    name: "AI Starter Bundle",
    priceUsd: 100,
    priceLabel: "$100",
    unit: "/ 30 days",
    jobPostsIncluded: 5,
    jobsLabel: "5 job-post credits every 30 days",
    sellable: true,
  },
  starter: {
    tier: "starter",
    name: "Starter",
    priceUsd: 79,
    priceLabel: "$79",
    unit: "/mo",
    jobPostsIncluded: 3,
    jobsLabel: "3 active jobs",
    sellable: false,
  },
  growth: {
    tier: "growth",
    name: "Growth",
    priceUsd: 149,
    priceLabel: "$149",
    unit: "/mo",
    jobPostsIncluded: 10,
    jobsLabel: "10 active jobs",
    sellable: false,
  },
  business: {
    tier: "business",
    name: "Business",
    priceUsd: 299,
    priceLabel: "$299",
    unit: "/mo",
    jobPostsIncluded: 25,
    jobsLabel: "25 active jobs",
    sellable: false,
  },
};

/**
 * Additional job posts: $10 each, only while the AI Starter Bundle is active.
 * Each one expires 30 days after its own purchase.
 */
export const ADDON_JOB_POST = {
  name: "Additional job post",
  priceUsd: 10,
  priceLabel: "$10",
  validDays: 30,
  maxPerPurchase: 50,
} as const;

/** A posted job stays live for 30 days from the moment its credit is used. */
export const JOB_POST_LIFESPAN_DAYS = 30;

export const PAUSE_TOOLTIP =
  "Pausing hides your listing from candidates, but does not pause or extend the original 30-day lifespan of the post.";
export const CLOSE_TOOLTIP =
  "Closing this job will permanently end the listing and archive candidate data. The credit used for this post cannot be refunded or reused.";
export const AUTO_RENEW_LABEL =
  "Automatically consume a credit to renew this job for another 30 days when it expires.";

export const EXTRA_RECRUITER_SEAT_PRICE_USD = 20;
export const EXTRA_RECRUITER_SEAT_PRICE_LABEL = "$20";
export const EXTRA_RECRUITER_SEAT_UNIT = "/month per additional seat";

export type FeaturedOption = {
  tier: FeaturedTier;
  name: string;
  priceUsd: number;
  priceLabel: string;
  unit: string;
  days: number;
};

export const FEATURED_OPTION_BY_TIER: Record<FeaturedTier, FeaturedOption> = {
  featured_7d: {
    tier: "featured_7d",
    name: "Featured",
    priceUsd: 29,
    priceLabel: "$29",
    unit: "/ 7 days",
    days: 7,
  },
  featured_14d: {
    tier: "featured_14d",
    name: "Featured",
    priceUsd: 49,
    priceLabel: "$49",
    unit: "/ 14 days",
    days: 14,
  },
  ai_30d: {
    tier: "ai_30d",
    name: "AI Featured",
    priceUsd: 129,
    priceLabel: "$129",
    unit: "/ 30 days",
    days: 30,
  },
};

/** Narrowing guard for a `employer_subscriptions.tier` string. */
export function isEmployerTier(value: string): value is EmployerTier {
  return (EMPLOYER_TIERS as readonly string[]).includes(value);
}

/** Narrowing guard for an `employer_members.role` string. */
export function isEmployerMemberRole(value: string): value is EmployerMemberRole {
  return (EMPLOYER_MEMBER_ROLES as readonly string[]).includes(value);
}

/** Narrowing guard for an `employer_jobs.status` string. */
export function isEmployerJobStatus(value: string): value is EmployerJobStatus {
  return (EMPLOYER_JOB_STATUSES as readonly string[]).includes(value);
}

/** Narrowing guard for a `featured_listings.tier` string. */
export function isFeaturedTier(value: string): value is FeaturedTier {
  return (FEATURED_TIERS as readonly string[]).includes(value);
}

/**
 * The plan for a stored tier, or null when the database holds a tier this
 * build does not know. Callers must render an explicit unrecognised state
 * rather than falling back to a default plan — a wrong price and a wrong
 * included-quota number are both worse than an honest "ask us" message.
 */
export function planForTier(tier: string | null | undefined): EmployerPlan | null {
  return tier && isEmployerTier(tier) ? EMPLOYER_PLAN_BY_TIER[tier] : null;
}

/** The promotion for a stored featured tier, or null when unrecognised. */
export function featuredOptionForTier(tier: string | null | undefined): FeaturedOption | null {
  return tier && isFeaturedTier(tier) ? FEATURED_OPTION_BY_TIER[tier] : null;
}

/**
 * Only these statuses are a live, payable subscription. `incomplete` means
 * checkout never finished, `past_due` means a payment failed and `canceled`
 * means the plan ended; none of them entitle an org to the included job posts.
 */
export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  incomplete: "Checkout incomplete",
  active: "Active",
  past_due: "Payment past due",
  canceled: "Canceled",
  trialing: "Trial",
};

/** Human, non-alarming copy for a stored subscription status. */
export function subscriptionStatusLabel(status: string | null | undefined): string {
  if (!status) return "No subscription";
  return SUBSCRIPTION_STATUS_LABELS[status] ?? "Unrecognised status";
}

const JOB_STATUS_LABELS: Record<EmployerJobStatus, string> = {
  draft: "Draft",
  published: "Active",
  paused: "Paused",
  closed: "Closed",
  expired: "Expired",
};

/** Human label for a stored job status; unknown values are shown verbatim. */
export function jobStatusLabel(status: string | null | undefined): string {
  return status && isEmployerJobStatus(status) ? JOB_STATUS_LABELS[status] : (status || "Unknown");
}

const MEMBER_ROLE_LABELS: Record<EmployerMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
};

/** Human label for a stored member role; unknown values are shown verbatim. */
export function memberRoleLabel(role: string | null | undefined): string {
  return role && isEmployerMemberRole(role) ? MEMBER_ROLE_LABELS[role] : (role || "Unknown");
}
