/**
 * What each admin role is allowed to do (Phase 9A).
 *
 * `admin_users.role` has always been one of three values, and every admin route
 * accepted all three -- so `marketing_admin` could read a candidate's wallet
 * and `finance_admin` could dismiss a job report. The roles were names, not
 * permissions. This is the map that makes them permissions.
 *
 * The map lives here rather than in SQL because it is a policy decision about
 * what a job title may do, and TypeScript is where it can be asserted directly.
 * The database's narrower and harder-to-bypass job is unchanged: browser roles
 * can reach none of this. A capability list in SQL would be a second copy of the
 * same policy with nothing keeping the two in step.
 *
 * Two rules govern additions:
 *
 *   - A route asks for a capability, never for a role. `requireCapability("...")`
 *     survives someone renaming a role; `if (role === "finance_admin")` does not.
 *   - A capability that grants a write that moves money or settles a dispute is
 *     listed under `finance_admin` and `admin` only. Adding it to
 *     `marketing_admin` should require a deliberate argument, not a default.
 */

export const ADMIN_ROLES = ["admin", "marketing_admin", "finance_admin"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Every admin surface, as a capability rather than a route path. Grouped by what
 * is being administered, not by HTTP method, so a capability read and a
 * capability write stay visibly distinct.
 */
export const ADMIN_CAPABILITIES = [
  // Candidate support
  "users:read",
  "wallet:read",
  "wallet:adjust",
  "wallet_ledger:read",
  "applications:read",
  // Apply operations
  "apply_runs:read",
  "apply_failures:read",
  // Employer support
  "employers:read",
  "employer_subscriptions:read",
  "employer_seats:read",
  "employer_jobs:read",
  "featured_listings:read",
  "featured_listings:manage",
  // Moderation
  "job_reports:read",
  "job_reports:moderate",
  // Platform operations
  "billing_failures:read",
  "notifications:read",
  // Whole-platform administration
  "admin_users:manage",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

/**
 * Capabilities every admin role has. Deliberately tiny: read-your-own-queue and
 * nothing else. Anything that touches a candidate's money, a live posting, or
 * another admin's access has to be named explicitly below.
 */
const BASELINE: readonly AdminCapability[] = [
  "users:read",
  "applications:read",
  "employers:read",
];

/**
 * Finance owns money. Wallet balances, the ledger, why a payment failed, and
 * employer subscription state.
 */
const FINANCE: readonly AdminCapability[] = [
  "wallet:read",
  "wallet:adjust",
  "wallet_ledger:read",
  "employer_subscriptions:read",
  "employer_seats:read",
  "billing_failures:read",
];

/**
 * Marketing owns the public surface. The moderation queue and job visibility.
 * Note what is absent: `wallet:*`, because a campaign budget conversation is not
 * a reason to read an individual's balance, and `featured_listings:manage`
 * grants no money.
 */
const MARKETING: readonly AdminCapability[] = [
  "employer_jobs:read",
  "featured_listings:read",
  "featured_listings:manage",
  "job_reports:read",
  "job_reports:moderate",
  "notifications:read",
];

export const ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  admin: ADMIN_CAPABILITIES,
  finance_admin: [...BASELINE, ...FINANCE],
  marketing_admin: [...BASELINE, ...MARKETING],
};

// Frozen, not copied. `capabilitiesForRole` is called on every admin request, so
// handing back a fresh array each time is waste; freezing makes the shared
// reference safe instead. The `readonly` type stops an accidental `push` at
// compile time, and the freeze stops one that arrives through `as any` or from
// plain JavaScript at runtime. A policy map a stray mutation can widen is worse
// than no policy map, because it looks correct.
for (const role of ADMIN_ROLES) Object.freeze(ROLE_CAPABILITIES[role]);
Object.freeze(ROLE_CAPABILITIES);

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function capabilitiesForRole(role: AdminRole): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role];
}

export function roleHasCapability(
  role: AdminRole,
  capability: AdminCapability
): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Capabilities an admin role does *not* have, for the "why can I not do this"
 * case. An admin console that just says "forbidden" is indistinguishable from a
 * bug, and a finance admin watching a page grey out has no way to tell whether
 * they are misconfigured or simply not their job.
 */
export function missingCapabilities(
  role: AdminRole,
  required: readonly AdminCapability[]
): AdminCapability[] {
  return required.filter((capability) => !roleHasCapability(role, capability));
}

/** Narrow a raw database value to a role, or null if it is not a current one. */
export function parseAdminRole(value: unknown): AdminRole | null {
  return isAdminRole(value) ? value : null;
}
