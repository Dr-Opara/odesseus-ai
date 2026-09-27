import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { LIVE_FAIR_USE, LIVE_SHARE_GUEST_LIMIT } from "@/lib/billing/catalog";

export const runtime = "nodejs";

/** The raw row shape odesseus_get_live_entitlement actually returns.
 *
 * Kept as an explicit type rather than trusting the generated Database type
 * because this is the product's most load-bearing contract: the UI decides
 * whether to offer Live at all from exactly these fields. The first six are
 * the original Phase 7A shape (also read by
 * /api/interviews/[id]/live/eligibility, which this route's RPC and result
 * row are shared with); the rest were added when memberships and guests were
 * layered in. `plan` names the specific plan behind entitlement_type
 * "membership" ("monthly" | "personal_annual" | "share_annual") or is
 * "guest" for an activated guest; null for passes/annual/none. */
type LiveEntitlementRow = {
  has_entitlement: boolean;
  entitlement_type: "membership" | "guest" | "passes" | "annual" | "none";
  passes_remaining: number;
  unlimited_until: string | null;
  fair_use_count: number;
  fair_use_reset: string;
  is_owner: boolean;
  is_guest: boolean;
  membership_id: string | null;
  guest_limit: number;
  activated_guest_count: number;
  plan: string | null;
};

const NO_ACCESS: LiveEntitlementRow = {
  has_entitlement: false,
  entitlement_type: "none",
  passes_remaining: 0,
  unlimited_until: null,
  fair_use_count: 0,
  fair_use_reset: new Date().toISOString(),
  is_owner: false,
  is_guest: false,
  membership_id: null,
  guest_limit: 0,
  activated_guest_count: 0,
  plan: null,
};

/**
 * The single authoritative Live access check.
 *
 * All access rules live in the database function; this route only decides who
 * is asking. It deliberately does not re-derive entitlement from
 * credit_balances, and it never trusts anything the client sends about the
 * caller's identity — the user id comes from the verified session, and the
 * function is reached with the service role because it is not exposed to
 * authenticated callers.
 *
 * The response uses its own field names (source/plan/sessionsRemaining/...)
 * rather than spreading the raw RPC row, so a future rename of the database
 * function's OUT parameters cannot silently change this public contract.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("odesseus_get_live_entitlement", {
    p_user_id: userId,
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not check Live access." },
      { status: 500 }
    );
  }

  // Fail closed: an unresolvable check must never read as "you have access".
  const row =
    ((Array.isArray(data) ? data[0] : data) as LiveEntitlementRow | undefined) ?? NO_ACCESS;

  return NextResponse.json({
    hasAccess: row.has_entitlement,
    source: row.entitlement_type,
    plan: row.plan,
    // Uniformly meaningful across every entitlement kind, including the
    // legacy annual window: the headroom left in the current fair-use
    // window, or the unspent passes when a discrete pass was bought.
    sessionsRemaining: row.passes_remaining,
    periodEnd: row.unlimited_until,
    isOwner: row.is_owner,
    isGuest: row.is_guest,
    membershipId: row.membership_id,
    guestLimit: row.guest_limit,
    activatedGuestCount: row.activated_guest_count,
    // The database is the authority for the cap and the fair-use ceiling; the
    // catalog mirrors are only echoed for display. When they disagree the
    // database value above is what this route returns.
    fairUse: LIVE_FAIR_USE,
    maxGuestsPerYear: LIVE_SHARE_GUEST_LIMIT,
  });
}
