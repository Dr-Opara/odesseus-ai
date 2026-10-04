import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createDesktopOpaqueToken,
  DESKTOP_ACCESS_TTL_MS,
  hashDesktopToken,
} from "@/lib/live/desktop-auth";

const schema = z.object({
  ticket: z.string().min(20).max(300),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid desktop launch ticket." }, { status: 400 });
  }

  const service = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const accessToken = createDesktopOpaqueToken();
  const accessExpiresAt = new Date(now.getTime() + DESKTOP_ACCESS_TTL_MS).toISOString();

  // Atomic claim: a launch ticket can be redeemed only once and only before expiry.
  const { data: claimed, error } = await service
    .from("live_desktop_sessions")
    .update({
      launch_used_at: nowIso,
      access_token_hash: hashDesktopToken(accessToken),
      access_expires_at: accessExpiresAt,
      updated_at: nowIso,
    })
    .eq("launch_token_hash", hashDesktopToken(input.ticket))
    .is("launch_used_at", null)
    .is("revoked_at", null)
    .gt("launch_expires_at", nowIso)
    .select("id,live_session_id,interview_id,user_id,access_expires_at")
    .maybeSingle();

  if (error || !claimed) {
    return NextResponse.json(
      { error: "This Odesseus launch ticket is invalid, expired, or has already been used." },
      { status: 401 }
    );
  }

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot")
    .eq("id", claimed.live_session_id)
    .eq("interview_id", claimed.interview_id)
    .eq("user_id", claimed.user_id)
    .maybeSingle();

  if (!liveSession) {
    await service
      .from("live_desktop_sessions")
      .update({ revoked_at: nowIso, updated_at: nowIso })
      .eq("id", claimed.id);

    return NextResponse.json({ error: "Live session is no longer available." }, { status: 409 });
  }

  return NextResponse.json({
    accessToken,
    expiresAt: claimed.access_expires_at,
    interviewId: claimed.interview_id,
    liveSessionId: claimed.live_session_id,
    status: liveSession.status,
    context: liveSession.context_snapshot,
  });
}
