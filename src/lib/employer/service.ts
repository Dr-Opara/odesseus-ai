/**
 * Shared employer read services (Phase 5).
 *
 * These are the single source of truth for everything an employer dashboard
 * shows. The desktop employer surfaces and the mobile employer portal both
 * call `getEmployerOverview` with the same authenticated Supabase client, so
 * the two renderings cannot drift: there is no mobile-only query and no
 * desktop-only copy of the numbers.
 *
 * Authorisation is entirely delegated to row-level security. This module never
 * filters by a user id the caller supplied for a *different* user: it resolves
 * the signed-in user from the auth claims and then reads through the
 * organization that user is a member of. Every employer table is scoped by
 * `odesseus_private.is_org_member(org_id)` (or admin/owner), so an
 * organization id resolved from `employer_members` is already the widest id
 * this user may read. RLS is never relaxed to make a query work.
 *
 * Note on employer applicants: `applications` is candidate-owned
 * (`user_id = auth.uid()`) and `applications.job_id` points at the
 * candidate's `job_opportunities`, not at `employer_jobs`, so there is no
 * employer -> applicant link in the schema. Nothing here invents one. See
 * `docs/phase-5-employer-blockers.md`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  isActiveSubscriptionStatus,
  isEmployerJobStatus,
  isEmployerMemberRole,
  isFeaturedTier,
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
