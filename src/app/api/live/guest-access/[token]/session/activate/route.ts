import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

const schema = z.object({
  openaiSessionId: z.string().min(3),
});

/**
 * Activate the guest's Live session. Server-mediated call to the existing
 * activation RPC with the owner's id: entitlement is consumed exactly as an
 * applicant session would, through the owner's existing Share Annual
 * access. Already-active sessions return idempotently; the guest never
 * touches credit tables directly.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;
  if (!record.live_session_id) {
    return NextResponse.json(
      { error: "Start the guest session before activating it." },
      { status: 409 }
    );
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid Live activation." }, { status: 400 });
  }

  const { data, error } = await service.rpc("odesseus_activate_live_session_v2", {
    p_session_id: record.live_session_id,
    p_user_id: record.owner_user_id,
    p_openai_session_id: input.openaiSessionId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const insufficient =
      msg.includes("insufficient") ||
      msg.includes("no live entitlement") ||
      msg.includes("fair use limit");
    const notFound = msg.includes("not found");
    return NextResponse.json(
      {
        error: insufficient
          ? "This guest link is no longer active."
          : notFound
            ? "Live session not found."
            : "Odesseus could not activate Live.",
      },
      { status: insufficient ? 402 : notFound ? 404 : 500 }
    );
  }

  const row = data?.[0];
  return NextResponse.json({
    ok: true,
    session: row?.session,
    entitlementConsumed: row?.entitlement_consumed ?? false,
  });
}
