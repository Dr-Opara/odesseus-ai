import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { guestRequestIp, loadGuestAccess } from "@/lib/interviews/guest-share";

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

  // Token guessing is the only anonymous attack surface; bound it per IP.
  const rate = checkRateLimit(`live:guest-validate:${guestRequestIp(_request)}`, 60, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

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
