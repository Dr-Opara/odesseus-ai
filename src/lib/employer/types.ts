/**
 * Shared employer data contracts (Phase 5).
 *
 * These are the shapes the desktop employer surfaces and the mobile employer
 * portal both render, so there is exactly one answer per question: the same
 * `EmployerOverview` drives the desktop dashboard, the mobile portal and the
 * billing/team pages.
 *
 * The vocabulary types (`EmployerTier`, `FeaturedTier`, ...) live in
 * `./plans` because they are the stored check-constraint values, not a
 * presentation choice.
 */

import type { EmployerJobStatus, EmployerMemberRole } from "./plans";

/** The signed-in account, as far as the employer surfaces need it. */
export type EmployerAccount = {
  userId: string;
  email: string | null;
  /** The company name captured at signup, when present. */
  companyName: string | null;
  /**
   * True when the auth record carries `account_type = "employer"`. A false
   * value here is the "signed in as a candidate" case, which must be sent back
   * to the candidate app rather than shown an empty employer dashboard.
   */
  isEmployerAccount: boolean;
};

/** The organization the signed-in user belongs to. */
export type EmployerOrganization = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string | null;
};

export type EmployerMembership = {
  userId: string;
  role: EmployerMemberRole | string;
  joinedAt: string | null;
  isYou: boolean;
};

export type EmployerInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
};

/** One job the organization owns. */
export type EmployerJob = {
  id: string;
  title: string;
  description?: string | null;
  location: string | null;
  requirementsText?: string | null;
  preferredText?: string | null;
  workArrangement?: string | null;
  /**
   * The approved job form's four additional fields, each on its own column.
   *
   * All nullable: a job may leave any of them blank and nothing here is ever
   * defaulted. `employmentType` is the stored vocabulary (`full_time`), not the
   * form's label (`Full-time`); `toFormEmploymentType` converts for display.
   */
  department?: string | null;
  employmentType?: string | null;
  compensationText?: string | null;
  responsibilitiesText?: string | null;
  status: EmployerJobStatus | string;
  postedAt: string | null;
  createdAt: string | null;
  /** The promotion currently running on this job, when any. */
  featured: {
    tier: string;
    isActive: boolean;
    startsAt: string | null;
    expiresAt: string | null;
  } | null;
};

export type EmployerSubscription = {
  tier: string;
  status: string;
  /** Job posts included in the current period, as stored on the subscription. */
  jobPostsIncluded: number;
  periodStart: string | null;
  periodEnd: string | null;
};

/** Granted job-post allowance for the current period. */
export type EmployerJobPostAllowance = {
  total: number;
  used: number;
  remaining: number;
  grantedAt: string | null;
  expiresAt: string | null;
};

/** Recruiter seat state, merged from the `recruiter_seats` row and the RPCs. */
export type EmployerSeats = {
  /** Seats the subscription is entitled to (always at least the included one). */
  required: number;
  /** Seats currently paid for and live. */
  active: number;
  /** The paid seat record's expiry, when it has one. */
  activeUntil: string | null;
  /** The number of extra seats beyond the entitlement, priced per seat. */
  extraSeats: number;
  /** True when a paid seat subscription exists but the org is over entitlement. */
  isOverEntitled: boolean;
};

/**
 * The quota an employer can act on right now.
 *
 * The included job posts are the honest number to show: a
 * `past_due`/`canceled`/`incomplete` subscription entitles nothing, and the
 * UI must not imply it does.
 */
export type EmployerJobQuota = {
  included: number;
  used: number;
  remaining: number;
  /** True when the remaining allowance is what gates publishing another job. */
  canPublishJob: boolean;
};

/**
 * Everything the employer dashboard, the mobile portal, the team page and the
 * billing page render, from one read.
 *
 * `needsOrganization` is the honest empty state for an employer who has signed
 * up but whose organization row was never provisioned. The employer signup
 * action creates the auth user only, so this state is reachable in practice and
 * must be explained rather than rendered as "0 of 0".
 */
export type EmployerOverview = {
  account: EmployerAccount;
  organization: EmployerOrganization | null;
  /** True when the account is valid but has no organization row yet. */
  needsOrganization: boolean;
  /** The signed-in user's own role in the organization, when known. */
  yourRole: string | null;
  subscription: EmployerSubscription | null;
  allowance: EmployerJobPostAllowance | null;
  quota: EmployerJobQuota | null;
  seats: EmployerSeats | null;
  jobs: EmployerJob[];
  jobCounts: {
    total: number;
    published: number;
    draft: number;
    closed: number;
  };
  members: EmployerMembership[];
  invitations: EmployerInvitation[];
  /**
   * Server-side read failures, surfaced as a quiet notice. A missing plan
   * grant is not a reason to render a fabricated number, and it is not a
   * reason to blank the whole dashboard either.
   */
  notices: string[];
};
