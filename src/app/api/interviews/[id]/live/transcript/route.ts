import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appendTranscriptItem } from "@/lib/live/transcript";
import { isCandidateLiveSession } from "@/lib/interviews/guest-share";

const schema = z.object({
  sessionId: z.string().uuid(),
  itemId: z.string().min(1).max(300),
  transcript: z.string().trim().min(1).max(12000),
  mode: z.enum(["default","star","shorter","technical","follow_up","manual"]).default("default"),
  forceGuidance: z.boolean().default(false),
  // Client-assigned, monotonically increasing per session — assigned the
  // first time an item is observed (e.g. on its first delta), not when its
  // completion event happens to arrive. Realtime completion events are not
  // guaranteed to arrive in chronological order, and concurrent requests to
  // this route are not guaranteed to be processed in dispatch order either,
  // so `occurred_at` is derived from this index (see below) rather than
  // insert-time `now()`, keeping transcript order stable regardless of
  // network/processing timing.
  turnIndex: z.number().int().min(0).optional(),
});

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
    return NextResponse.json({ error: "Invalid transcript item." }, { status: 400 });
  }

  const service = createServiceClient();

  // Guest-share sessions are private to their guest link and are driven only
  // through the token-scoped guest routes, never here.
  if (!(await isCandidateLiveSession(service, input.sessionId, id, userId))) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot,activated_at,created_at")
    .eq("id", input.sessionId)
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  const result = await appendTranscriptItem(service, {
    session: liveSession,
    userId,
    turn: input,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body);
}
