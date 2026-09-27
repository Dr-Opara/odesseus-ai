import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Where an invitation link currently stands, so the recipient can be told
 * whether to sign in, ask for a new link, or accept.
 *
 * Deliberately unauthenticated — someone opening a link has not signed in yet
 * — and deliberately narrow: it returns the invitation state, the recipient's
 * own email domain, the plan label and the period end. It returns no owner
 * identity, no other guest, and nothing from the owner's workspace. A wrong or
 * guessed token is answered identically to a used one, so this endpoint cannot
 * be used to probe which tokens exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 32 || token.length > 256) {
    return NextResponse.json({ result: "invalid" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("odesseus_live_guest_invite_status", {
    p_token: token,
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not check this invitation." },
      { status: 500 }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { result: string; guest_email: string | null; owner_label: string | null; period_end: string | null }
    | null;

  if (!row || row.result === "invalid") {
    return NextResponse.json({ result: "invalid" }, { status: 404 });
  }

  return NextResponse.json({
    result: row.result,
    email_domain: row.guest_email,
    plan_label: row.owner_label,
    period_end: row.period_end,
  });
}
