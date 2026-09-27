/**
 * Employer organization service (M5/M6 + Phase 7A/8A Live backend).
 *
 * The pricing contract already models the paid side of an employer account as
 * three org-scoped tables that the billing webhook writes and members read:
 * employer_subscriptions (plan + job-post cycle), recruiter_seats (paid seat
 * quota), and featured_listings (paid visibility). This module is the read and
 * invitation side a signed-in org admin actually calls.
 *
 * Authorization model, deliberately two-layered:
 *
 *   1. RLS is the real boundary. Every query here runs on the caller's own
 *      session client, so a non-member cannot see an org at all, and only an org
 *      admin/owner passes the invitation write policies. There is no service-role
 *      read of employer data anywhere in this module.
 *   2. `requireOrgAdmin` is a courtesy check on top, so the API can answer 403
 *      with a calm message instead of surfacing a raw RLS error string, and so
 *      the intent ("admins manage seats") is visible in the route rather than
 *      only in a policy.
 *
 * Seat capacity is never computed here. The paid seat count lives in a table
 * clients may not read, and the meter is enforced inside
 * `odesseus_accept_employer_invitation` where it can be made atomic. What this
 * module exposes is the summary an admin needs to decide whether to buy more:
 * seats paid, seats used, seats available.
 *
 * Which team roles consume a seat is a single decision, `METERED_ROLES`, which
 * mirrors `public.odesseus_metered_org_roles()`. Plan tiers price job posts, not
 * seats, so the included allowance is 0 and a recruiter needs a paid seat.
 *
 * Phase 5 (frontend) API compatibility: this module also exports the
 * `getEmployerOverview` function and supporting types used by the desktop
 * employer surfaces and the mobile employer portal. Both call the same
 * authenticated Supabase client so the two renderings cannot drift.
 *
 * The owner is excluded by identity (employer_organizations.owner_user_id), not
 * by role, so this list does not need an 'owner' entry.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { employerFeaturedTiers, type EmployerFeaturedTier } from "@/lib/billing/catalog";
import {
  isActiveSubscriptionStatus,
  isEmployerJobStatus,
  isEmployerMemberRole,
  planForTier,
} from "./plans";
import type {
  EmployerAccount,
  EmployerInvitation,
  EmployerJob,
  EmployerJobPostAllowance,
  EmployerJobQuota,
  EmployerMembership,
  EmployerOrganization,
  EmployerOverview,
  EmployerSeats,
  EmployerSubscription,
} from "./types";

export type EmployerClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Types (from live backend - more comprehensive)
// ---------------------------------------------------------------------------

/**
 * Team roles that consume one paid seat each.
 *
 * Every role an invitation can grant. The approved policy is that the
 * organization owner is included and every additional active member costs
 * $20/month, whatever their role -- otherwise a user could dodge seat billing
 * by handing a teammate the admin or viewer role, which grants nearly the same
 * access. Mirrors `public.odesseus_metered_org_roles()`, which is where the
 * database enforces it; the two must agree.
 *
 * The owner is excluded by identity (employer_organizations.owner_user_id), not
 * by role, so this list does not need an 'owner' entry.
 */
export const METERED_ROLES = ["admin", "recruiter", "viewer"] as const;
export type MeteredRole = (typeof METERED_ROLES)[number];

/** Every role an invitation may grant. 'owner' is set on the org row instead. */
export const INVITABLE_ROLES = ["admin", "recruiter", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type OrgRole = "owner" | "admin" | "recruiter" | "viewer";

/** How long an invitation stays redeemable. */
/** How long an invitation stays redeemable. */
export const INVITATION_TTL_DAYS = 7;

/** Bounds a caller-supplied seat quantity. Stripe prices the product per seat. */
export const SEATS_PER_CHECKOUT_MIN = 1;
export const SEATS_PER_CHECKOUT_MAX = 100;

export type OrgMembership = {
  user_id: string;
  role: OrgRole;
  created_at: string;
};

export type OrgInvitation = {
  id: string;
  org_id: string;
  email: string;
  role: InvitableRole;
  status: "pending" | "accepted" | "revoked";
  invited_by: string;
  expires_at: string;
  created_at: string;
};

export type SeatSummary = {
  /** Seats currently paid for and unexpired. */
  seatsPaid: number;
  /** Active metered members consuming a seat. */
  seatsUsed: number;
  /** seatsPaid - seatsUsed, floored at 0. */
  seatsAvailable: number;
  /**
   * Seats the roster needs right now (one per non-owner member).
   *
   * Distinct from seatsUsed: this is the number the billing system should be
   * charging for, which is what makes a post-removal Stripe sync able to tell
   * "already correct" from "overpaying".
   */
  seatsRequired: number;
};

export type OrgTeamView = {
  orgId: string;
  orgName: string;
  /** The caller's own role in this org. */
  callerRole: OrgRole | null;
  isCallerAdmin: boolean;
  seats: SeatSummary;
  members: OrgMembership[];
  invitations: OrgInvitation[];
};

export type OrgAuthorization =
  | { ok: true; role: OrgRole }
  | { ok: false; reason: "not_a_member" | "not_an_admin" };

// ---------------------------------------------------------------------------
// Types (Phase 5 frontend compatibility - different shape, coexisting)
// ---------------------------------------------------------------------------

const ORG_COLUMNS = "id,name,owner_user_id,created_at";
const MEMBER_COLUMNS = "user_id,role,created_at";
const INVITATION_COLUMNS = "id,email,role,status,expires_at,created_at";
const JOB_COLUMNS = "id,title,location,status,posted_at,created_at";
const SUBSCRIPTION_COLUMNS =
  "tier,status,job_posts_included,period_start,period_end";
const ALLOWANCE_COLUMNS = "total,used,granted_at,expires_at";
const SEAT_COLUMNS = "count,active_until";
const FEATURED_COLUMNS = "job_id,tier,is_active,starts_at,expires_at";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Resolves the caller's role in an org.
 *
 * Ownership is checked against employer_organizations.owner_user_id as well as
 * employer_members, because an org owner is not required to also hold an
 * employer_members row.
 */
export async function getOrgRole(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgRole | null> {
  const { data: org, error: orgError } = await client
    .from("employer_organizations")
    .select("id,owner_user_id")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError) {
    throw new Error("Could not load the organization: " + orgError.message);
  }
  if (!org) return null;
  if (org.owner_user_id === userId) return "owner";

  const { data: membership, error: memberError } = await client
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    throw new Error("Could not load your team membership: " + memberError.message);
  }
  return (membership?.role as OrgRole | undefined) ?? null;
}

/**
 * Gate for every org-admin mutation. A non-member and a non-admin are
 * distinguished so the route can answer 404 and 403 respectively: telling an
 * outsider "404, no such org" avoids confirming that an org exists.
 */
export async function authorizeOrgAdmin(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgAuthorization> {
  const role = await getOrgRole(client, orgId, userId);
  if (role === null) return { ok: false, reason: "not_a_member" };
  if (role === "owner" || role === "admin") return { ok: true, role };
  return { ok: false, reason: "not_an_admin" };
}

/** Gate for org-admin reads. Same role set as mutations. */
export async function requireOrgAdmin(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgAuthorization> {
  return authorizeOrgAdmin(client, orgId, userId);
}

// ---------------------------------------------------------------------------
// Phase 5 Frontend API Compatibility Layer
// ---------------------------------------------------------------------------

/** Resolves the signed-in user id from the auth claims, or null. */
export async function getEmployerUserId(client: EmployerClient): Promise<string | null> {
  const { data: auth } = await client.auth.getClaims();
  const sub = auth?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/**
 * The signed-in account's email and signup company name.
 *
 * Both come from the auth record the user already owns; nothing is invented.
 * `account_type` is the same claim the employer login and post-job guards use,
 * so a candidate account landing here is detected rather than shown an empty
 * organization.
 */
export async function getEmployerAccount(client: EmployerClient): Promise<EmployerAccount | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const companyName =
    typeof metadata.company_name === "string" && metadata.company_name.trim()
      ? metadata.company_name.trim()
      : null;

  return {
    userId: data.user.id,
    email: typeof data.user.email === "string" ? data.user.email : null,
    companyName,
    isEmployerAccount: metadata.account_type === "employer",
  };
}

/**
 * The organization for a user id, resolved through `employer_members`.
 *
 * `employer_organizations` is selectable when the caller owns the row or is an
 * org member, and `employer_members` is selectable for your own row, so this
 * two-step read is the narrowest path that works. The `org_id` used downstream
 * is the one Postgres itself authorised.
 */
export async function getEmployerOrganization(
  client: EmployerClient,
  userId: string
): Promise<EmployerOrganization | null> {
  const membership = await client
    .from("employer_members")
    .select("org_id,role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ org_id: string; role: string }>();

  if (membership.error || !membership.data?.org_id) return null;

  const org = await client
    .from("employer_organizations")
    .select(ORG_COLUMNS)
    .eq("id", membership.data.org_id)
    .maybeSingle<Row>();

  if (org.error || !org.data) return null;

  const row = org.data as {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string | null;
  };
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
  };
}

/** The signed-in user's role in their organization, when they are a member. */
export async function getEmployerRole(
  client: EmployerClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await client
    .from("employer_members")
    .select("role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ role: string }>();

  if (error || !data) return null;
  return data.role;
}

/** Everyone in the organization, for the team surface. */
export async function getEmployerMembers(
  client: EmployerClient,
  orgId: string,
  viewerUserId: string
): Promise<EmployerMembership[]> {
  const { data, error } = await client
    .from("employer_members")
    .select(MEMBER_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) return [];

  return ((data ?? []) as Array<{ user_id: string; role: string; created_at: string | null }>).map(
    (row) => ({
      userId: row.user_id,
      role: isEmployerMemberRole(row.role) ? row.role : row.role,
      joinedAt: row.created_at,
      isYou: row.user_id === viewerUserId,
    })
  );
}

/**
 * Pending (and recently resolved) invitations.
 *
 * `employer_member_invitations` is admin/owner-only, so for a plain recruiter
 * or viewer this legitimately returns an empty list. That is an access
 * boundary, not a bug, and the team page hides the section for those roles.
 */
export async function getEmployerInvitations(
  client: EmployerClient,
  orgId: string
): Promise<EmployerInvitation[]> {
  const { data, error } = await client
    .from("employer_member_invitations")
    .select(INVITATION_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) return [];

  return ((data ?? []) as Array<{
    id: string;
    email: string;
    role: string;
    status: string;
    expires_at: string | null;
    created_at: string | null;
  }>).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * The organization's jobs, newest first, each annotated with any promotion
 * that is currently active on it.
 */
export async function getEmployerJobs(
  client: EmployerClient,
  orgId: string
): Promise<EmployerJob[]> {
  const { data, error } = await client
    .from("employer_jobs")
    .select(JOB_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) return [];
  const jobs = (data ?? []) as Array<{
    id: string;
    title: string;
    location: string | null;
    status: string;
    posted_at: string | null;
    created_at: string | null;
  }>;

  const featured = await getFeaturedListings(client, orgId);
  const byJobId = new Map(featured.map((listing) => [listing.job_id, listing]));

  return jobs.map((job) => {
    const listing = byJobId.get(job.id);
    return {
      id: job.id,
      title: job.title,
      location: job.location,
      status: isEmployerJobStatus(job.status) ? job.status : job.status,
      postedAt: job.posted_at,
      createdAt: job.created_at,
      featured: listing
        ? {
            tier: listing.tier,
            isActive: listing.is_active,
            startsAt: listing.starts_at,
            expiresAt: listing.expires_at,
          }
        : null,
    };
  });
}

/** Raw featured-listing rows for the organization. */
async function getFeaturedListings(
  client: EmployerClient,
  orgId: string
): Promise<
  Array<{ job_id: string; tier: string; is_active: boolean; starts_at: string | null; expires_at: string | null }>
> {
  const { data, error } = await client
    .from("featured_listings")
    .select(FEATURED_COLUMNS)
    .eq("org_id", orgId);

  if (error) return [];
  return (data ?? []) as Array<{
    job_id: string;
    tier: string;
    is_active: boolean;
    starts_at: string | null;
    expires_at: string | null;
  }>;
}

/** Promotions with an unrecognised tier, which the UI must not guess at. */
export async function getUnrecognisedFeaturedTiers(
  client: EmployerClient,
  orgId: string
): Promise<string[]> {
  const listings = await getFeaturedListings(client, orgId);
  return [...new Set(listings.map((l) => l.tier).filter((tier) => !isFeaturedTier(tier)))];
}

/** The organization's current subscription, if any. */
export async function getEmployerSubscription(
  client: EmployerClient,
  orgId: string
): Promise<EmployerSubscription | null> {
  const { data, error } = await client
    .from("employer_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle<Row>();

  if (error || !data) return null;

  const row = data as {
    tier: string;
    status: string;
    job_posts_included: number;
    period_start: string | null;
    period_end: string | null;
  };
  return {
    tier: row.tier,
    status: row.status,
    jobPostsIncluded: row.job_posts_included,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

/**
 * The granted job-post allowance for the current period.
 *
 * `total` and `used` come from `employer_job_post_credits`, which is written by
 * the subscription sync; the remaining count is derived here and clamped at
 * zero so a `used` value that overshot (for example a job published just as a
 * period closed) can never render as negative quota.
 */
export async function getJobPostAllowance(
  client: EmployerClient,
  orgId: string
): Promise<EmployerJobPostAllowance | null> {
  const { data, error } = await client
    .from("employer_job_post_credits")
    .select(ALLOWANCE_COLUMNS)
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle<Row>();

  if (error || !data) return null;

  const row = data as { total: number; used: number; granted_at: string | null; expires_at: string | null };
  return {
    total: row.total ?? 0,
    used: row.used ?? 0,
    remaining: Math.max(0, (row.total ?? 0) - (row.used ?? 0)),
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Recruiter seat state.
 *
 * The paid seat record is read from `recruiter_seats` (member-selectable).
 * The entitlement count comes from `odesseus_org_required_seat_count`, which
 * the backend uses to decide when a paid extra seat is required. That RPC is
 * `security definer` and executable by `authenticated`, but it is still passed
 * only the org id Postgres already authorised for this session.
 */
export async function getEmployerSeats(
  client: EmployerClient,
  orgId: string
): Promise<EmployerSeats | null> {
  const { data, error } = await client
    .from("recruiter_seats")
    .select(SEAT_COLUMNS)
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle<Row>();

  const paid = !error && data
    ? (data as { count: number; active_until: string | null })
    : null;

  const required = await readRequiredSeatCount(client, orgId);

  if (!paid && required === null) return null;

  const active = paid?.count ?? 0;
  const entitled = required ?? 1;
  return {
    required: entitled,
    active,
    activeUntil: paid?.active_until ?? null,
    extraSeats: Math.max(0, active - entitled),
    isOverEntitled: active < entitled,
  };
}

/**
 * `odesseus_org_required_seat_count`, or null when the RPC is unavailable.
 *
 * Returning null (rather than 0 or 1) lets the caller say "seat count
 * unavailable" instead of asserting a number the backend did not confirm.
 */
async function readRequiredSeatCount(
  client: EmployerClient,
  orgId: string
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc("odesseus_org_required_seat_count", {
      p_org_id: orgId,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/** `odesseus_org_live_seat_count`, or null when unavailable. */
export async function getActiveSeatCount(
  client: EmployerClient,
  orgId: string
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc("odesseus_org_live_seat_count", {
      p_org_id: orgId,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * The publishable job quota.
 *
 * The included allowance is only meaningful while the subscription is live, so
 * a `past_due` / `canceled` / `incomplete` row contributes nothing. When there
 * is no allowance row at all the subscription's own included count is used,
 * which is what the plan promises on paper.
 */
export function resolveJobQuota(
  subscription: EmployerSubscription | null,
  allowance: EmployerJobPostAllowance | null
): EmployerJobQuota | null {
  if (!subscription) return null;

  const entitled = isActiveSubscriptionStatus(subscription.status);
  const included = allowance?.total ?? subscription.jobPostsIncluded ?? 0;
  const used = allowance?.used ?? 0;

  return {
    included: entitled ? included : 0,
    used,
    remaining: entitled ? Math.max(0, included - used) : 0,
    canPublishJob: entitled && Math.max(0, included - used) > 0,
  };
}

/** Counts by stored job status, so the dashboard never hardcodes a total. */
export function countJobsByStatus(jobs: EmployerJob[]): EmployerOverview["jobCounts"] {
  return jobs.reduce(
    (counts, job) => {
      counts.total += 1;
      if (job.status === "published") counts.published += 1;
      else if (job.status === "draft") counts.draft += 1;
      else if (job.status === "closed") counts.closed += 1;
      return counts;
    },
    { total: 0, published: 0, draft: 0, closed: 0 }
  );
}

/**
 * The complete employer read, used by every employer surface.
 *
 * Nothing here fabricates. When a table is unreadable the dashboard keeps
 * working and reports which card is incomplete, because a dashboard that
 * invents "156 applicants" is worse than one that says it could not read the
 * pipeline.
 */
export async function getEmployerOverview(
  client: EmployerClient,
  userId: string
): Promise<EmployerOverview> {
  const notices: string[] = [];

  const account: EmployerAccount = {
    userId,
    email: null,
    companyName: null,
    isEmployerAccount: false,
  };

  const readAccount = await getEmployerAccount(client);
  if (readAccount) {
    account.email = readAccount.email;
    account.companyName = readAccount.companyName;
    account.isEmployerAccount = readAccount.isEmployerAccount;
  } else {
    notices.push("Could not load your account details.");
  }

  const organization = await getEmployerOrganization(client, userId);

  if (!organization) {
    return {
      account,
      organization: null,
      needsOrganization: true,
      yourRole: null,
      subscription: null,
      allowance: null,
      quota: null,
      seats: null,
      jobs: [],
      jobCounts: { total: 0, published: 0, draft: 0, closed: 0 },
      members: [],
      invitations: [],
      notices,
    };
  }

  const orgId = organization.id;

  const [role, subscription, allowance, seats, jobs, members] = await Promise.all([
    getEmployerRole(client, userId),
    getEmployerSubscription(client, orgId),
    getJobPostAllowance(client, orgId),
    getEmployerSeats(client, orgId),
    getEmployerJobs(client, orgId),
    getEmployerMembers(client, orgId, userId),
  ]);

  if (planForTier(subscription?.tier) === null) {
    notices.push("Your stored plan is not one this build recognises.");
  }

  const invitations = await getEmployerInvitations(client, orgId);

  return {
    account,
    organization,
    needsOrganization: false,
    yourRole: role,
    subscription,
    allowance,
    quota: resolveJobQuota(subscription, allowance),
    seats,
    jobs,
    jobCounts: countJobsByStatus(jobs),
    members,
    invitations,
    notices,
  };
}

// ---------------------------------------------------------------------------
// Reads (Live backend - team view, seat summary, featured listings)
// ---------------------------------------------------------------------------

/**
 * An org's display name, for messages that name the team.
 *
 * Returns null rather than throwing when the org is missing or unreadable: a
 * name is presentational, and failing to obtain one must not block the action
 * the caller actually asked for.
 */
export async function getOrgName(
  client: EmployerClient,
  orgId: string
): Promise<string | null> {
  const { data, error } = await client
    .from("employer_organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { name: string }).name;
}

/**
 * Computes the seat summary for an org.
 *
 * `seatsPaid` is read from `recruiter_seats` (what Stripe billed for).
 * `seatsUsed` counts non-owner members with metered roles.
 * `seatsRequired` is the same as `seatsUsed` in the current policy.
 * The backend RPC `odesseus_org_required_seat_count` is the canonical source
 * for what the subscription should cover; we read it when available.
 */
export async function getSeatSummary(
  client: EmployerClient,
  orgId: string
): Promise<SeatSummary> {
  const [paidResult, membersResult] = await Promise.all([
    client
      .from("recruiter_seats")
      .select("count,active_until")
      .eq("org_id", orgId)
      .maybeSingle(),
    client
      .from("employer_members")
      .select("user_id,role")
      .eq("org_id", orgId),
  ]);

  const seatError = paidResult.error;
  const requiredError = null; // We don't fetch required seats in this query, it's done via RPC later

  if (seatError) {
    throw new Error("Could not load seat capacity: " + seatError.message);
  }

  const seatsPaid = paidResult.data?.count ?? 0;

  const members = (membersResult.data ?? []) as Array<{
    user_id: string;
    role: string;
  }>;

  const orgResult = await client
    .from("employer_organizations")
    .select("owner_user_id")
    .eq("id", orgId)
    .maybeSingle();

  const ownerId = orgResult.data?.owner_user_id ?? "";
  const nonOwner = members.filter((m) => m.user_id !== ownerId);
  const seatsUsed = nonOwner.filter((m) => METERED_ROLES.includes(m.role as MeteredRole)).length;

  let seatsRequired = seatsUsed;
  try {
    const { data, error } = await client.rpc("odesseus_org_required_seat_count", {
      p_org_id: orgId,
    });
    if (!error && typeof data === "number") seatsRequired = data;
  } catch {
    // RPC unavailable; fall back to counted value.
  }

  return {
    seatsPaid,
    seatsUsed,
    seatsAvailable: Math.max(0, seatsPaid - seatsUsed),
    seatsRequired,
  };
}

/** Lists all members of an org, newest first. */
export async function listOrgMembers(
  client: EmployerClient,
  orgId: string
): Promise<OrgMembership[]> {
  const { data, error } = await client
    .from("employer_members")
    .select("user_id,role,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not list org members: ${error.message}`);
  }
  return (data ?? []) as OrgMembership[];
}

/** Lists all invitations for an org, newest first. */
export async function listOrgInvitations(
  client: EmployerClient,
  orgId: string
): Promise<OrgInvitation[]> {
  const { data, error } = await client
    .from("employer_member_invitations")
    .select("id,org_id,email,role,status,invited_by,expires_at,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not list org invitations: ${error.message}`);
  }
  return (data ?? []) as OrgInvitation[];
}

/**
 * Complete team view for the org dashboard.
 */
export async function getOrgTeamView(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgTeamView> {
  const [orgResult, role] = await Promise.all([
    client
      .from("employer_organizations")
      .select("id,name,owner_user_id")
      .eq("id", orgId)
      .maybeSingle(),
    getOrgRole(client, orgId, userId),
  ]);

  if (orgResult.error) {
    throw new Error("Could not load the organization: " + orgResult.error.message);
  }
  const org = orgResult.data;
  if (!org || role === null) {
    throw new OrgAccessError();
  }

  const [seats, members, invitations, orgName] = await Promise.all([
    getSeatSummary(client, orgId),
    listOrgMembers(client, orgId),
    // A non-admin gets no invitations from RLS, so the field is simply empty.
    role === "owner" || role === "admin"
      ? listOrgInvitations(client, orgId)
      : Promise.resolve([]),
    getOrgName(client, orgId),
  ]);

  return {
    orgId,
    orgName: orgName ?? "Unnamed organization",
    callerRole: role,
    isCallerAdmin: role === "owner" || role === "admin",
    seats,
    members,
    invitations,
  };
}

// ---------------------------------------------------------------------------
// Invitations (Live backend)
// ---------------------------------------------------------------------------

export type CreateInvitationInput = {
  orgId: string;
  email: string;
  role: InvitableRole;
  invitedBy: string;
};

export type CreateInvitationResult =
  | { ok: true; token: string; invitation: OrgInvitation }
  | { ok: false; code: "invalid" | "duplicate" | "not_an_admin" | "rate_limited" | "unknown" };

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export async function createInvitation(
  client: EmployerClient,
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  const auth = await authorizeOrgAdmin(client, input.orgId, input.invitedBy);
  if (!auth.ok) {
    return { ok: false, code: auth.reason === "not_a_member" ? "not_an_admin" : "invalid" };
  }

  if (!isPlausibleEmail(input.email)) return { ok: false, code: "invalid" };
  if (!INVITABLE_ROLES.includes(input.role)) return { ok: false, code: "invalid" };

  const normalized = normalizeInviteEmail(input.email);

  const { data: existingMember } = await client
    .from("employer_members")
    .select("user_id")
    .eq("org_id", input.orgId)
    .eq("user_id", normalized)
    .maybeSingle();
  if (existingMember) return { ok: false, code: "duplicate" };

  const { data: existingInvite } = await client
    .from("employer_member_invitations")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("email", normalized)
    .eq("status", "pending")
    .maybeSingle();
  if (existingInvite) return { ok: false, code: "duplicate" };

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

  const token = crypto.randomUUID();

  const { data, error } = await client
    .from("employer_member_invitations")
    .insert({
      org_id: input.orgId,
      email: normalized,
      role: input.role,
      status: "pending",
      invited_by: input.invitedBy,
      expires_at: expiresAt.toISOString(),
      token,
    })
    .select("id,org_id,email,role,status,invited_by,expires_at,created_at,token")
    .single();

  if (error) {
    // A unique violation is a duplicate, not a fault. Two admins inviting the
    // same address at once both pass the read above, and the loser must be told
    // "already invited" (409) rather than being handed a generic failure.
    if (error.code === "23505") return { ok: false, code: "duplicate" };
    return { ok: false, code: "unknown" };
  }
  return { ok: true, token, invitation: data as OrgInvitation };
}

export async function revokeInvitation(
  client: EmployerClient,
  orgId: string,
  invitationId: string
): Promise<{ ok: true; revoked: boolean }> {
  // Scoped to pending rows on purpose. An invitation that has already been
  // accepted is the record of a person who joined the team; rewriting it to
  // "revoked" would erase that fact and re-open a seat they are occupying.
  const { data, error } = await client
    .from("employer_member_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not revoke invitation: ${error.message}`);
  }

  // maybeSingle resolves to the row or null; a plain select would resolve to an
  // array, so both shapes are read rather than assuming one.
  const revoked = Array.isArray(data) ? data.length > 0 : data !== null;
  return { ok: true, revoked };
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; orgName: string; role: string; invitationId: string }
  | { ok: false; code: "no_seats" | "invalid" | "expired" | "already_member" | "unknown" };

/** Accept an invitation by token (for the email-verified acceptance flow). */
export async function acceptInvitation(
  client: EmployerClient,
  token: string
): Promise<AcceptInvitationResult> {
  const { data, error } = await client.rpc("odesseus_accept_employer_invitation", {
    p_token: token,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("invalid invitation link")) return { ok: false, code: "invalid" };
    if (msg.includes("expired") || msg.includes("revoked")) return { ok: false, code: "expired" };
    if (msg.includes("no recruiter seats")) return { ok: false, code: "no_seats" };
    if (msg.includes("already a member") || msg.includes("conflict") || msg.includes("different email")) return { ok: false, code: "already_member" };
    return { ok: false, code: "unknown" };
  }

  // The RPC returns the joined org info
  const row = data?.[0] as { joined_org_id: string; org_name: string; joined_role: string; invitation_id: string } | undefined;
  if (!row) return { ok: false, code: "invalid" };

  return {
    ok: true,
    orgId: row.joined_org_id,
    orgName: row.org_name,
    role: row.joined_role,
    invitationId: row.invitation_id,
  };
}

export class OrgAccessError extends Error {
  constructor() {
    super("Not a member of this organization");
    this.name = "OrgAccessError";
  }
}

export function isValidSeatCount(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= SEATS_PER_CHECKOUT_MIN &&
    value <= SEATS_PER_CHECKOUT_MAX
  );
}

// ---------------------------------------------------------------------------
// Featured listings (Live backend)
// ---------------------------------------------------------------------------

export type FeatureableJob = {
  id: string;
  title: string;
  location: string | null;
  status: string;
};

export type FeaturedListing = {
  id: string;
  jobId: string;
  jobTitle: string | null;
  tier: string;
  isActive: boolean;
  isBoosted: boolean;
  startsAt: string | null;
  expiresAt: string | null;
};

export type OrgFeaturedView = {
  orgId: string;
  orgName: string;
  listings: FeaturedListing[];
  jobs: Array<{ id: string; title: string; location: string | null; status: string; isBoosted: boolean }>;
  tiers: FeaturedTierOffer[];
};

export type FeaturedTierOffer = {
  tier: EmployerFeaturedTier;
  label: string;
  /** Authoritative price in integer minor units. Never a float. */
  amountCents: number;
  priceLabel: string;
  durationDays: number;
};

export function isFeaturedTier(tier: string): tier is EmployerFeaturedTier {
  return tier in employerFeaturedTiers;
}

export function getFeaturedTierOffers(): FeaturedTierOffer[] {
  return Object.entries(employerFeaturedTiers).map(([tier, t]) => ({
    tier: tier as EmployerFeaturedTier,
    label: t.label,
    // The catalog's integer cents travel with the payload so the amount the
    // page shows is provably the amount checkout charges. priceLabel is derived
    // from it here purely for display.
    amountCents: t.amountCents,
    priceLabel: `$${(t.amountCents / 100).toFixed(2)}`,
    durationDays: t.days,
  }));
}

/** One job that can be featured (published, not already featured). */
export async function getFeatureableJob(
  client: EmployerClient,
  orgId: string,
  jobId: string
): Promise<{ job: FeatureableJob } | { reason: "not_found" | "closed" }> {
  const { data, error } = await client
    .from("employer_jobs")
    .select("id,title,location,status")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .eq("status", "published")
    .maybeSingle();

if (error) throw new Error(`Could not load job: ${error.message}`);
  if (!data) return { reason: "not_found" };
  if ((data as { status: string }).status === "closed") return { reason: "closed" };
  return { job: data as FeatureableJob };
}

/** Complete featured view for an org. */
export async function getOrgFeaturedView(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgFeaturedView> {
  const [orgResult, role] = await Promise.all([
    client
      .from("employer_organizations")
      .select("id,name,owner_user_id")
      .eq("id", orgId)
      .maybeSingle(),
    getOrgRole(client, orgId, userId),
  ]);

  if (orgResult.error) {
    throw new Error("Could not load the organization: " + orgResult.error.message);
  }
  const org = orgResult.data;
  if (!org || role === null) {
    throw new OrgAccessError();
  }

  const [{ data: listingRows, error: listingError }, { data: jobRows, error: jobError }] =
    await Promise.all([
      client
        .from("featured_listings")
        .select("id,job_id,tier,starts_at,expires_at,is_active")
        .eq("org_id", orgId)
        .order("starts_at", { ascending: false }),
      client
        .from("employer_jobs")
        .select("id,title,location,status")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]);

  if (listingError) {
    throw new Error("Could not load featured listings: " + listingError.message);
  }
  if (jobError) {
    throw new Error("Could not load your jobs: " + jobError.message);
  }

  const jobs = (jobRows ?? []) as Array<{
    id: string;
    title: string;
    location: string | null;
    status: string;
  }>;
  const titles = new Map(jobs.map((job) => [job.id, job.title]));
  const now = Date.now();

  const listings: FeaturedListing[] = (listingRows ?? [])
    .map((row) => {
      const expiresAtMs = Date.parse(row.expires_at);
      const boosted = row.is_active && Number.isFinite(expiresAtMs) && expiresAtMs > now;
      return {
        id: row.id,
        jobId: row.job_id,
        jobTitle: titles.get(row.job_id) ?? null,
        tier: isFeaturedTier(row.tier) ? row.tier : (row.tier as EmployerFeaturedTier),
        startsAt: row.starts_at,
        expiresAt: row.expires_at,
        isActive: row.is_active,
        isBoosted: boosted,
      };
    })
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  const boostedJobIds = new Set(listings.filter((l) => l.isBoosted).map((l) => l.jobId));

  return {
    orgId: org.id,
    orgName: org.name,
    listings,
    jobs: jobs.map((job) => ({
      ...job,
      isBoosted: boostedJobIds.has(job.id),
    })),
    tiers: getFeaturedTierOffers(),
  };
}

// ---------------------------------------------------------------------------
// Job CRUD (Phase 14B)
// ---------------------------------------------------------------------------

export type CreateJobInput = {
  title: string;
  description?: string | null;
  location?: string | null;
};

export type CreateJobResult =
  | { ok: true; job: EmployerJob }
  | { ok: false; reason: string };

export type ListJobsResult = {
  items: EmployerJob[];
  total: number;
};

/**
 * Create a new job posting for the organization.
 *
 * The job starts in 'draft' status and does not consume a job-post credit.
 * Credits are only consumed when the job is published (triggered by the
 * claim_job_post_credit database trigger when status becomes 'published').
 */
export async function createJob(
  client: EmployerClient,
  orgId: string,
  input: CreateJobInput
): Promise<EmployerJob> {
  const { data, error } = await client
    .from("employer_jobs")
    .insert({
      org_id: orgId,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      location: input.location?.trim() ?? null,
      status: "draft",
    })
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
    )
    .single();

  if (error) {
    throw new Error("Could not create job: " + error.message);
  }

  return data as unknown as EmployerJob;
}

/**
 * List all jobs for an organization, with pagination.
 */
export async function listJobs(
  client: EmployerClient,
  orgId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ items: EmployerJob[]; total: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  const { data, error, count } = await client
    .from("employer_jobs")
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at",
      { count: "exact" }
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error("Could not load jobs: " + error.message);
  }

  return {
    items: (data ?? []).map(d => d as unknown as EmployerJob),
    total: count ?? 0,
  };
}

/**
 * Get a single job by ID, ensuring it belongs to the organization.
 */
export async function getJob(
  client: EmployerClient,
  orgId: string,
  jobId: string
): Promise<EmployerJob | null> {
  const { data, error } = await client
    .from("employer_jobs")
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
    )
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load job: " + error.message);
  }

  return data ? (data as unknown as EmployerJob) : null;
}

export type UpdateJobInput = {
  title?: string;
  description?: string | null;
  location?: string | null;
};

export async function updateJob(
  client: EmployerClient,
  orgId: string,
  jobId: string,
  input: UpdateJobInput
): Promise<EmployerJob | { reason: "not_found" | "wrong_status" }> {
  const { data: job, error: fetchError } = await client
    .from("employer_jobs")
    .select("status")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    throw new Error("Could not load job: " + fetchError.message);
  }
  if (!job) return { reason: "not_found" };

  if (job.status !== "draft") {
    return { reason: "wrong_status" };
  }

  const updates: Partial<{
    title: string;
    description: string | null;
    location: string | null;
  }> = {};

  if (input.title !== undefined) updates.title = input.title.trim();
  if (input.description !== undefined) updates.description = input.description?.trim() ?? null;
  if (input.location !== undefined) updates.location = input.location?.trim() ?? null;

  if (Object.keys(updates).length === 0) {
    const { data, error } = await client
      .from("employer_jobs")
      .select(
        "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
      )
      .eq("id", jobId)
      .eq("org_id", orgId)
      .single();
    if (error) throw new Error("Could not load job: " + error.message);
    return data as unknown as EmployerJob;
  }

  const { data, error } = await client
    .from("employer_jobs")
    .update(updates)
    .eq("id", jobId)
    .eq("org_id", orgId)
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
    )
    .single();

  if (error) {
    throw new Error("Could not update job: " + error.message);
  }

  return data as unknown as EmployerJob;
}

/**
 * Publish a draft job.
 *
 * This transitions the job from 'draft' to 'published', which triggers the
 * claim_job_post_credit database trigger to consume a job-post credit from
 * the organization's available credits. The operation is atomic and idempotent:
 * re-publishing an already-published job is a no-op and does not consume a
 * second credit.
 */
export async function publishJob(
  client: EmployerClient,
  orgId: string,
  jobId: string
): Promise<{ ok: true; job: EmployerJob } | { ok: false; reason: "not_found" | "wrong_status" | "no_credits" }> {
  const { data: job, error: fetchError } = await client
    .from("employer_jobs")
    .select("status")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    throw new Error("Could not load job: " + fetchError.message);
  }
  if (!job) return { ok: false, reason: "not_found" };

  if (job.status !== "draft") {
    return { ok: false, reason: "wrong_status" };
  }

  const { data, error } = await client
    .from("employer_jobs")
    .update({ status: "published", posted_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("org_id", orgId)
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
    )
    .maybeSingle();

  if (error) {
    if (error.message.includes("no_credits")) {
      return { ok: false, reason: "no_credits" };
    }
    throw new Error("Could not publish job: " + error.message);
  }

  if (!data) {
    return { ok: false, reason: "no_credits" };
  }

  return { ok: true, job: data as unknown as EmployerJob };
}

/**
 * Close a published job.
 */
export async function closeJob(
  client: EmployerClient,
  orgId: string,
  jobId: string
): Promise<{ ok: true; job: EmployerJob } | { ok: false; reason: "not_found" | "wrong_status" }> {
  const { data: job, error: fetchError } = await client
    .from("employer_jobs")
    .select("status")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    throw new Error("Could not load job: " + fetchError.message);
  }
  if (!job) return { ok: false, reason: "not_found" };

  if (job.status !== "published") {
    return { ok: false, reason: "wrong_status" };
  }

  const { data, error } = await client
    .from("employer_jobs")
    .update({ status: "closed" })
    .eq("id", jobId)
    .eq("org_id", orgId)
    .select(
      "id,org_id,title,description,location,status,posted_at,created_at,updated_at"
    )
    .single();

  if (error) {
    throw new Error("Could not close job: " + error.message);
  }

  return { ok: true, job: data as unknown as EmployerJob };
}

/**
 * Delete a job.
 *
 * Only draft jobs can be deleted. Published jobs must be closed first.
 * Deleting a draft job does not consume any job-post credits.
 */
export async function deleteJob(
  client: EmployerClient,
  orgId: string,
  jobId: string
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "wrong_status" }> {
  const { data: job, error: fetchError } = await client
    .from("employer_jobs")
    .select("status")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (fetchError) {
    throw new Error("Could not load job: " + fetchError.message);
  }
  if (!job) return { ok: false, reason: "not_found" };

  if (job.status !== "draft") {
    return { ok: false, reason: "wrong_status" };
  }

  const { error } = await client
    .from("employer_jobs")
    .delete()
    .eq("id", jobId)
    .eq("org_id", orgId);

  if (error) {
    throw new Error("Could not delete job: " + error.message);
  }

  return { ok: true };
}