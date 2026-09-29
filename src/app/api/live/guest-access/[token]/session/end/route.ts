import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

/**
 * End the guest's Live session via the existing completion RPC, which is
 * already idempotent (a completed session returns its row). Marks the
 * guest record completed so the link becomes read-only history.
 */
export async function POST(
  _request: Request,
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
      { error: "There is no guest session to end." },
      { status: 409 }
    );
  }

  const { error } = await service.rpc("odesseus_complete_live_session", {
    p_session_id: record.live_session_id,
    p_user_id: record.owner_user_id,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const notFound = msg.includes("not found");
    return NextResponse.json(
      { error: notFound ? "Live session not found." : "Odesseus could not end the session cleanly." },
      { status: notFound ? 404 : 500 }
    );
  }

  const now = new Date().toISOString();
  await service
    .from("guest_access_records")
    .update({ status: "completed", completed_at: now, updated_at: now })
    .eq("id", record.id);

  return NextResponse.json({ ok: true });
}
