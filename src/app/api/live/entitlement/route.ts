import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { LIVE_FAIR_USE, LIVE_SHARE_GUEST_LIMIT } from "@/lib/billing/catalog";

export const runtime = "nodejs";

/** The entitlement response shape, mirrored from odesseus_get_live_entitlement.
 *
 * Kept as an explicit type rather than trusting the generated Database type
 * because this is the product's most load-bearing contract: the UI decides
 * whether to offer Live at all from exactly these fields. */
type LiveEntitlement = {
  has_access: boolean;
  source: "membership" | "guest" | "single_purchase" | "legacy_annual" | "none";
  plan: string;
  sessions_remaining: number;
  period_end: string | null;
  is_owner: boolean;
  is_guest: boolean;
  membership_id: string | null;
  guest_limit: number;
  activated_guest_count: number;
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

  const row = (Array.isArray(data) ? data[0] : data) as LiveEntitlement | undefined;
  if (!row) {
    // Fail closed: an unresolvable check must never read as "you have access".
    return NextResponse.json(
      {
        has_access: false,
        source: "none",
        plan: "none",
        sessions_remaining: 0,
        period_end: null,
        is_owner: false,
        is_guest: false,
        membership_id: null,
        guest_limit: 0,
        activated_guest_count: 0,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ...row,
    // The database is the authority for the cap and the fair-use ceiling; the
    // catalog mirrors are only echoed for display. When they disagree the
    // database value is what this route returns.
    guest_limit: row.guest_limit,
    fair_use: LIVE_FAIR_USE,
    max_guests_per_year: LIVE_SHARE_GUEST_LIMIT,
  });
}
