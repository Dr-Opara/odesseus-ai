import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

/**
 * Validate a shared Guest Live link. No authentication: the link token is
 * the entire credential. Returns only the guest's own setup state — never
 * applicant data.
 */
export async function GET(
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
  return NextResponse.json({
    valid: true,
    status: record.status,
    setupComplete: record.status !== "pending" || record.guest_name !== null,
    guestName: record.guest_name,
    hasSession: record.live_session_id !== null,
  });
}
