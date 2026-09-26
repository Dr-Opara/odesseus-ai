/**
 * Employer organization service (M5/M6).
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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { employerFeaturedTiers, type EmployerFeaturedTier } from "@/lib/billing/catalog";

export type EmployerClient = SupabaseClient<Database>;

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
    throw new Error(`Could not load the organization: ${orgError.message}`);
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
    throw new Error(`Could not load your team membership: ${memberError.message}`);
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
// Reads
// ---------------------------------------------------------------------------

type SeatRow = { count: number; active_until: string | null };

/**
 * Seat arithmetic for the caller's own view of an org.
 *
 * Both numbers come from SECURITY DEFINER RPCs rather than from table reads:
 * `odesseus_org_live_seat_count` for what has been paid for (recruiter_seats is
 * webhook-written, so re-deriving `count > 0 and active_until > now()` in
 * TypeScript could drift from the SQL the accept path enforces) and
 * `odesseus_org_required_seat_count` for what the roster needs. The required
 * count excludes the organization owner, which a client-side head-count over
 * employer_members cannot do correctly -- the owner is not required to hold a
 * member row, and may hold one in a metered role.
 */
export async function getSeatSummary(
  client: EmployerClient,
  orgId: string
): Promise<SeatSummary> {
  const [
    { data: seatsPaid, error: seatError },
    { data: seatsRequired, error: requiredError },
  ] = await Promise.all([
    client.rpc("odesseus_org_live_seat_count", { p_org_id: orgId }),
    client.rpc("odesseus_org_required_seat_count", { p_org_id: orgId }),
  ]);

  if (seatError) {
    throw new Error(`Could not load seat capacity: ${seatError.message}`);
  }
  if (requiredError) {
    throw new Error(`Could not load required seats: ${requiredError.message}`);
  }

  const paid = typeof seatsPaid === "number" ? seatsPaid : 0;
  const required = typeof seatsRequired === "number" ? seatsRequired : 0;
  // Usage is the required count by definition: a metered member is an active
  // member, and the owner is not metered.
  const used = required;

  return {
    seatsPaid: paid,
    seatsUsed: used,
    seatsRequired: required,
    seatsAvailable: Math.max(paid - used, 0),
  };
}

/**
 * Team roster. RLS scopes this to the caller's own org, and a non-member simply
 * gets an empty list rather than another org's roster.
 */
export async function listOrgMembers(
  client: EmployerClient,
  orgId: string
): Promise<OrgMembership[]> {
  const { data, error } = await client
    .from("employer_members")
    .select("user_id,role,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load the team: ${error.message}`);
  }
  return (data ?? []) as OrgMembership[];
}

/**
 * Outstanding invitations for an admin. RLS returns nothing to a non-admin, so
 * this is empty for anyone else even if it is called.
 */
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
    throw new Error(`Could not load invitations: ${error.message}`);
  }
  return (data ?? []) as OrgInvitation[];
}

/**
 * The full team screen payload in one call, so the page does not fan out into
 * five requests that each independently re-check authorization.
 */
export async function getOrgTeamView(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgTeamView> {
  const [{ data: org, error: orgError }, role] = await Promise.all([
    client
      .from("employer_organizations")
      .select("id,name")
      .eq("id", orgId)
      .maybeSingle(),
    getOrgRole(client, orgId, userId),
  ]);

  if (orgError) {
    throw new Error(`Could not load the organization: ${orgError.message}`);
  }
  if (!org || role === null) {
    throw new OrgAccessError();
  }

  const [seats, members, invitations] = await Promise.all([
    getSeatSummary(client, orgId),
    listOrgMembers(client, orgId),
    // A non-admin gets no invitations from RLS, so the field is simply empty.
    role === "owner" || role === "admin"
      ? listOrgInvitations(client, orgId)
      : Promise.resolve([]),
  ]);

  return {
    orgId: org.id,
    orgName: org.name,
    callerRole: role,
    isCallerAdmin: role === "owner" || role === "admin",
    seats,
    members,
    invitations,
  };
}

/** Raised when the caller cannot see the org at all. */
export class OrgAccessError extends Error {
  constructor() {
    super("Not a member of this organization");
    this.name = "OrgAccessError";
  }
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type CreateInvitationInput = {
  orgId: string;
  invitedBy: string;
  email: string;
  role: InvitableRole;
  /** Injected so token generation and expiry are testable. */
  now?: Date;
  /** Injected so a test can assert on the exact token. */
  token?: string;
};

export type CreateInvitationResult =
  | { ok: true; invitation: OrgInvitation; token: string }
  | { ok: false; code: "invalid" | "duplicate" | "error" };

/**
 * Normalises an address the same way the accept RPC compares it: lowercase and
 * trimmed. Storing the normalised form is what makes the partial unique index on
 * `lower(email)` agree with the lookup.
 */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A real-looking address check, not a full RFC validator. The accept RPC is the
 * authority on whether a redemption is legitimate; this only catches typos before
 * an invitation is written.
 */
export function isPlausibleEmail(email: string): boolean {
  const value = normalizeInviteEmail(email);
  if (value.length < 5 || value.length > 254) return false;
  if (value.includes(" ")) return false;
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value);
}

/**
 * 32 hex characters of `crypto.randomUUID()`-grade randomness, base64url-free so
 * the token is safe to drop into a URL unescaped.
 *
 * Not a bearer credential for money: it only redeems a team invitation, and the
 * accept RPC additionally requires the caller's verified email to match.
 */
function generateInvitationToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createInvitation(
  client: EmployerClient,
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  const email = normalizeInviteEmail(input.email);
  if (!isPlausibleEmail(email)) return { ok: false, code: "invalid" };
  if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, code: "invalid" };
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  const token = input.token ?? generateInvitationToken();

  // No "already a member" pre-check is possible here: employer_members is keyed
  // by user id and does not carry an email, so there is nothing to match an
  // address against. The case is harmless anyway — acceptance upserts onto the
  // existing (org_id, user_id) row rather than duplicating it — and the
  // accept RPC is the only thing that can change membership.
  const { data, error } = await client
    .from("employer_member_invitations")
    .insert({
      org_id: input.orgId,
      email,
      role: input.role,
      token,
      status: "pending",
      invited_by: input.invitedBy,
      expires_at: expiresAt.toISOString(),
    })
    .select("id,org_id,email,role,status,invited_by,expires_at,created_at")
    .maybeSingle();

  if (error) {
    // 23505 is the partial unique index on (org_id, lower(email)) where pending.
    const duplicate =
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505";
    if (duplicate) return { ok: false, code: "duplicate" };
    return { ok: false, code: "error" };
  }

  if (!data) return { ok: false, code: "error" };
  return { ok: true, invitation: data as OrgInvitation, token };
}

/**
 * Withdraws an outstanding invitation. Scoped to the org and to pending rows, so
 * an admin cannot rewrite the audit trail of an already-accepted invitation, and
 * a request for another org's invitation simply matches nothing.
 */
export async function revokeInvitation(
  client: EmployerClient,
  orgId: string,
  invitationId: string
): Promise<{ ok: boolean; revoked: boolean }> {
  const { data, error } = await client
    .from("employer_member_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    throw new Error(`Could not revoke that invitation: ${error.message}`);
  }
  return { ok: true, revoked: (data ?? []).length > 0 };
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; orgName: string; role: InvitableRole }
  | { ok: false; code: "invalid" | "no_seats" | "error" };

/**
 * Redeems an invitation for the signed-in caller.
 *
 * All the real work is in `odesseus_accept_employer_invitation`, which owns the
 * email match, the org lock, and the seat meter. This wrapper only translates
 * the database error into a product message, so the seat-cap and
 * single-connection rules cannot be bypassed by calling the RPC from elsewhere.
 */
export async function acceptInvitation(
  client: EmployerClient,
  token: string
): Promise<AcceptInvitationResult> {
  const value = token.trim();
  if (value.length < 16) return { ok: false, code: "invalid" };

  const { data, error } = await client.rpc("odesseus_accept_employer_invitation", {
    p_token: value,
  });

  if (error) {
    const message = String(error.message ?? "");
    // Matched loosely on purpose: the RPC wording is a product-facing sentence
    // that has changed once (it used to say "recruiter seats" before every role
    // became metered). A stricter match would start reporting a seat-cap refusal
    // as an opaque 500 the next time the wording moves.
    if (message.includes("no paid seats left") || message.includes("no recruiter seats left")) {
      return { ok: false, code: "no_seats" };
    }
    if (
      message.includes("invalid invitation link") ||
      message.includes("has expired") ||
      message.includes("has already been") ||
      message.includes("different email address")
    ) {
      return { ok: false, code: "invalid" };
    }
    return { ok: false, code: "error" };
  }

  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { ok: false, code: "invalid" };

  return {
    ok: true,
    orgId: String(row.joined_org_id),
    orgName: String(row.org_name ?? ""),
    role: String(row.joined_role) as InvitableRole,
  };
}

// ---------------------------------------------------------------------------
// Seat purchase
// ---------------------------------------------------------------------------

export function isValidSeatCount(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= SEATS_PER_CHECKOUT_MIN &&
    value <= SEATS_PER_CHECKOUT_MAX
  );
}

// ---------------------------------------------------------------------------
// Featured listings
// ---------------------------------------------------------------------------

/** A job the org could put in front of a featured purchase. */
export type FeatureableJob = {
  id: string;
  title: string;
  location: string | null;
  status: string;
  /** True when a paid boost is currently covering this posting. */
  isBoosted: boolean;
};

export type FeaturedListing = {
  id: string;
  jobId: string;
  /** Null when the posting was deleted after the purchase. */
  jobTitle: string | null;
  tier: EmployerFeaturedTier;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  /**
   * Whether the paid window is actually running right now.
   *
   * Deliberately not the same as `is_active`: that flag is cleared by the
   * scheduled expire_ended_featured_listings() sweep, so between a listing
   * lapsing and the sweep running, `is_active` would still say true. The
   * timestamp is the honest answer, so the UI cannot advertise visibility that
   * has already ended.
   */
  isBoosted: boolean;
};

export type OrgFeaturedView = {
  orgId: string;
  orgName: string;
  /** Every listing this org has bought, newest window first. */
  listings: FeaturedListing[];
  /** The org's own postings, so a buyer can choose one to boost. */
  jobs: FeatureableJob[];
  /** Catalog tiers with prices, so the page cannot display a stale amount. */
  tiers: FeaturedTierOffer[];
};

export type FeaturedTierOffer = {
  tier: EmployerFeaturedTier;
  label: string;
  description: string;
  amountCents: number;
  days: number;
};

const FEATURED_TIER_KEYS = Object.keys(employerFeaturedTiers) as EmployerFeaturedTier[];

export function isFeaturedTier(value: unknown): value is EmployerFeaturedTier {
  return typeof value === "string" && FEATURED_TIER_KEYS.includes(value as EmployerFeaturedTier);
}

/** Catalog tiers shaped for the client. Prices come from the catalog, not a copy. */
export function getFeaturedTierOffers(): FeaturedTierOffer[] {
  return FEATURED_TIER_KEYS.map((tier) => {
    const item = employerFeaturedTiers[tier];
    return {
      tier,
      label: item.label,
      description: item.description,
      amountCents: item.amountCents,
      days: item.days,
    };
  });
}

/**
 * Confirms a job belongs to the org and can be boosted.
 *
 * This is a fail-fast check before a card is presented, not the security
 * boundary: `odesseus_create_featured_listing` re-verifies ownership at
 * fulfilment and fails closed, so forged checkout metadata still cannot boost
 * another employer's posting. Rejecting here just avoids charging someone for a
 * purchase that was never going to be granted.
 */
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
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load that job: ${error.message}`);
  }
  if (!data) return { reason: "not_found" };
  if (data.status === "closed") return { reason: "closed" };

  return {
    job: {
      id: data.id,
      title: data.title,
      location: data.location,
      status: data.status,
      isBoosted: false,
    },
  };
}

/**
 * The featured-listings screen in one payload: what this org has already paid
 * for, what it can boost, and what each tier costs.
 *
 * The tiers are included so the page renders the same figures the checkout
 * charges. A hardcoded amount in the UI is how a $49 tier ends up advertised
 * at $39 while the backend takes $49.
 */
export async function getOrgFeaturedView(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<OrgFeaturedView> {
  const [{ data: org, error: orgError }, role] = await Promise.all([
    client
      .from("employer_organizations")
      .select("id,name")
      .eq("id", orgId)
      .maybeSingle(),
    getOrgRole(client, orgId, userId),
  ]);

  if (orgError) {
    throw new Error(`Could not load the organization: ${orgError.message}`);
  }
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
    throw new Error(`Could not load featured listings: ${listingError.message}`);
  }
  if (jobError) {
    throw new Error(`Could not load your jobs: ${jobError.message}`);
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
        // A stored tier the catalog no longer sells is surfaced as-is rather
        // than coerced, so history stays readable if a tier is ever retired.
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
