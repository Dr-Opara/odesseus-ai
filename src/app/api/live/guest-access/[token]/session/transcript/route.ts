import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { appendTranscriptItem } from "@/lib/live/transcript";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

const schema = z.object({
  itemId: z.string().min(1).max(300),
  transcript: z.string().trim().min(1).max(12000),
  mode: z.enum(["default", "star", "shorter", "technical", "follow_up", "manual"]).default("default"),
  forceGuidance: z.boolean().default(false),
  turnIndex: z.number().int().min(0).optional(),
});

/**
 * Guest transcript turn. Runs the SAME shared transcript+guidance core as
 * the applicant route, scoped to this guest record's session and stored
 * under the owner's id (a foreign-key carrier only). The guest context
 * snapshot drives guidance; no applicant data is involved.
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
      { error: "Start the guest session before sending transcript." },
      { status: 409 }
    );
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid transcript item." }, { status: 400 });
  }

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot,activated_at,created_at")
    .eq("id", record.live_session_id)
    .eq("user_id", record.owner_user_id)
    .maybeSingle();

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  const result = await appendTranscriptItem(service, {
    session: liveSession,
    userId: record.owner_user_id,
    turn: { sessionId: record.live_session_id, ...input },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body);
}
