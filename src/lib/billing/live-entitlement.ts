/**
 * The one place the Live entitlement contract is read on the server.
 *
 * Odesseus has one authoritative answer to "may this person start a Live
 * session right now": the `odesseus_get_live_entitlement` database function.
 * That is deliberate and load-bearing — an interview screen and the billing
 * screen must never disagree about whether a session may start, which is only
 * guaranteed if exactly one function decides.
 *
 * What this module adds is the TypeScript half of that single source. Before,
 * the RPC's return shape was untyped in the generated types and each of the
 * three callers re-declared it locally, so the contract existed in four places:
 * the SQL, the generated types, and two local type literals. This is the one
 * that is read.
 *
 * The contract, exactly as the SQL defines it:
 *
 *   has_access             may start a Live session now
 *   source                 'membership' | 'guest' | 'passes' | 'annual' | 'none'
 *   plan                   'monthly' | 'personal_annual' | 'share_annual' when
 *                          source is 'membership'; 'guest' for an activated
 *                          guest; null otherwise
 *   sessions_remaining     uniformly meaningful: unspent discrete passes, or the
 *                          fair-use headroom left on a time-boxed plan
 *   period_end             when time-boxed access runs out; null for passes
 *   is_owner / is_guest    which side of a Live Share arrangement the caller is
 *   membership_id          the owner's membership, for both sides
 *   guest_limit            the plan's cap
 *   activated_guest_count  slots consumed in the current membership period
 *
 * Note what is NOT here: a `fair_use_count`, a `fair_use_reset`, or an
 * `unlimited_until`. Those described a rolling-window mechanism that the
 * membership architecture replaced with a ceiling copied from the catalog onto
 * the membership row, and `unlimited_until` conflated a membership's period end
 * with the legacy annual window. Their presence in a caller is the signal that
 * somebody is reading a superseded shape.
 *
 * Resolution order in the database is membership -> guest -> discrete pass ->
 * legacy annual window, so a membership always outranks a leftover pass, and a
 * guest is served by the owner's fair-use window rather than their own.
 */

import { createServiceClient } from "@/lib/supabase/service";

/** Where the access came from, in resolution order. */
export const LIVE_ENTITLEMENT_SOURCES = [
  "membership",
  "guest",
  "passes",
  "annual",
  "none",
] as const;

export type LiveEntitlementSource = (typeof LIVE_ENTITLEMENT_SOURCES)[number];

/** A plan name, or null when the access is not a plan. */
export type LivePlan = "monthly" | "personal_annual" | "share_annual" | "guest" | null;

/**
 * The database function's row, as the ten columns it actually returns.
 *
 * Kept structurally identical to the `Returns` in `src/types/database.ts`
 * rather than derived from `Database`. Deriving it is the better idea and is
 * deliberately not done, for a reason worth stating: a derived type would make
 * the app compile against whatever the generated file happens to say, which is
 * how a stale regeneration quietly renames a product's access contract with no
 * error anywhere. Two hand-checked declarations that disagree fail loudly.
 */
export type LiveEntitlementRow = {
  has_access: boolean;
  source: LiveEntitlementSource;
  plan: LivePlan;
  sessions_remaining: number;
  period_end: string | null;
  is_owner: boolean;
  is_guest: boolean;
  membership_id: string | null;
  guest_limit: number;
  activated_guest_count: number;
};

/**
 * The answer for somebody with no Live access at all.
 *
 * Fail-closed is the whole point. A dropped connection, a redeploy mid-request,
 * or a function that raises must never read downstream as "you have access" —
 * the alternative is showing somebody a Live button that then fails to start.
 */
export const NO_LIVE_ENTITLEMENT: LiveEntitlementRow = {
  has_access: false,
  source: "none",
  plan: null,
  sessions_remaining: 0,
  period_end: null,
  is_owner: false,
  is_guest: false,
  membership_id: null,
  guest_limit: 0,
  activated_guest_count: 0,
};

/**
 * PostgREST returns a function with named OUT parameters as a single composite
 * object, but a `RETURNS TABLE` variant of the same signature as an array. The
 * function is reached only through this reader, so the ambiguity is resolved
 * once here rather than in every caller.
 */
function normalize(data: unknown): LiveEntitlementRow | null {
  const candidate = (Array.isArray(data) ? data[0] : data) as
    | Partial<LiveEntitlementRow>
    | null
    | undefined;

  if (!candidate || typeof candidate.has_access !== "boolean") return null;

  return {
    has_access: candidate.has_access,
    source: (candidate.source as LiveEntitlementSource) ?? "none",
    plan: (candidate.plan as LivePlan) ?? null,
    sessions_remaining: candidate.sessions_remaining ?? 0,
    period_end: candidate.period_end ?? null,
    is_owner: candidate.is_owner ?? false,
    is_guest: candidate.is_guest ?? false,
    membership_id: candidate.membership_id ?? null,
    guest_limit: candidate.guest_limit ?? 0,
    activated_guest_count: candidate.activated_guest_count ?? 0,
  };
}

export type LiveEntitlementRead =
  /** `ok: true` and `row` is the answer. Check `row.has_access`. */
  | { ok: true; row: LiveEntitlementRow }
  /**
   * The check could not be performed. `row` is `NO_LIVE_ENTITLEMENT`, so a
   * caller that ignores `ok` still fails closed rather than crashing.
   */
  | { ok: false; row: LiveEntitlementRow; reason: "rpc_error" | "unreadable" };

/**
 * Resolve the caller's Live access.
 *
 * Service-role only: the function is not granted to `authenticated`, because
 * its result can reveal another user's membership and guest relationships. That
 * is why this is not a client call, and why `userId` must come from a verified
 * session rather than from anything the caller sent.
 */
export async function readLiveEntitlement(userId: string): Promise<LiveEntitlementRead> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("odesseus_get_live_entitlement", {
    p_user_id: userId,
  });

  if (error) {
    return { ok: false, row: NO_LIVE_ENTITLEMENT, reason: "rpc_error" };
  }

  const row = normalize(data);
  if (!row) {
    return { ok: false, row: NO_LIVE_ENTITLEMENT, reason: "unreadable" };
  }

  return { ok: true, row };
}

/**
 * Whether this access is time-boxed, and therefore not spent one session at a
 * time.
 *
 * A member, an activated guest, and a legacy annual holder all draw on a
 * fair-use window rather than a balance. Activation must not decrement them; a
 * single `$14.99` pass must. Conflating the two is how a customer pays for a
 * subscription and is then told they ran out.
 */
export function isTimeBoxed(row: LiveEntitlementRow): boolean {
  return row.source === "membership" || row.source === "guest" || row.source === "annual";
}
