import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { mintRealtimeCall } from "@/lib/live/webrtc";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

const schema = z.object({
  sdp: z.string().min(20),
});

/**
 * Mint the guest's realtime call through the SAME shared minter as the
 * applicant route. The safety identifier derives from the guest record id,
 * never the owner's user id.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI Realtime is not configured." }, { status: 500 });
  }

  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;
  if (!record.live_session_id) {
    return NextResponse.json(
      { error: "Start the guest session before connecting audio." },
      { status: 409 }
    );
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid WebRTC offer." }, { status: 400 });
  }

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot")
    .eq("id", record.live_session_id)
    .eq("user_id", record.owner_user_id)
    .maybeSingle();

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  if (liveSession.status !== "active") {
    return NextResponse.json(
      { error: "Activate the guest session before connecting audio." },
      { status: 409 }
    );
  }

  const result = await mintRealtimeCall(service, {
    sessionId: liveSession.id,
    safetySeed: `odesseus:guest:${record.id}`,
    sdp: input.sdp,
    contextSnapshot: liveSession.context_snapshot,
    currentStatus: liveSession.status,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status }
    );
  }

  return NextResponse.json({ sdp: result.sdp, id: result.id }, { status: 201 });
}
