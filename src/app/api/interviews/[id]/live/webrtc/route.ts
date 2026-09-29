import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { mintRealtimeCall } from "@/lib/live/webrtc";
import { isCandidateLiveSession } from "@/lib/interviews/guest-share";

const schema = z.object({
  sessionId: z.string().uuid(),
  sdp: z.string().min(20),
});

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid WebRTC offer." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI Realtime is not configured." }, { status: 500 });
  }

  const service = createServiceClient();

  // Guest-share sessions are private to their guest link and are driven only
  // through the token-scoped guest routes, never here.
  if (!(await isCandidateLiveSession(service, input.sessionId, id, userId))) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  const [{ data: liveSession }, { data: credits }] = await Promise.all([
    service
      .from("live_interview_sessions")
      .select("id,status,capture_mode,context_snapshot")
      .eq("id", input.sessionId)
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("credit_balances")
      .select("interview_passes")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  if (liveSession.status !== "active" && (credits?.interview_passes ?? 0) < 1) {
    return NextResponse.json({ error: "No interview pass is available." }, { status: 402 });
  }

  const result = await mintRealtimeCall(service, {
    sessionId: liveSession.id,
    safetySeed: `odesseus:${userId}`,
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
