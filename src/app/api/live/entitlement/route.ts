import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LIVE_FAIR_USE } from "@/lib/billing/catalog";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";

export const runtime = "nodejs";

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
 * The row shape and the fail-closed behaviour both live in
 * `@/lib/billing/live-entitlement`, which is the single reader of the
 * contract. The response uses its own field names (source/plan/
 * sessionsRemaining/...) rather than spreading the raw RPC row, so a future
 * rename of the database function's OUT parameters cannot silently change this
 * public contract.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const read = await readLiveEntitlement(userId);

  // A failed check is reported as a failure, not as "you have no access". The
  // two look identical to the user and are not identical at all: answering 200
  // with hasAccess false would invite somebody to buy a product the system
  // merely failed to look up. Fail closed either way, but say which happened.
  if (!read.ok) {
    return NextResponse.json(
      { error: "Odesseus could not check Live access." },
      { status: 500 }
    );
  }

  const { row } = read;

  return NextResponse.json({
    hasAccess: row.has_access,
    source: row.source,
    plan: row.plan,
    // Uniformly meaningful across every entitlement kind, including the legacy
    // annual window: the headroom left in the current fair-use window, or the
    // unspent passes when a discrete pass was bought.
    sessionsRemaining: row.sessions_remaining,
    periodEnd: row.period_end,
    isOwner: row.is_owner,
    isGuest: row.is_guest,
    membershipId: row.membership_id,
    // No guest allowance, no guest count, no "places remaining". Live Share has
    // no guest cap: a holder generates Guest Live Access links and shares them.
    // The underlying function still returns the two historical columns, and
    // nothing authorizes on them -- they are simply not forwarded, so no client
    // can read a limit the product does not sell.
    //
    // The database is the authority for the cap and the fair-use ceiling; the
    // catalog mirrors are only echoed for display. When they disagree the
    // database value above is what this route returns.
    fairUse: LIVE_FAIR_USE,
  });
}
