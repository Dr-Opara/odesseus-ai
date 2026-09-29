import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isCandidateLiveSession } from "@/lib/interviews/guest-share";

const schema = z.object({
  sessionId: z.string().uuid(),
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
    return NextResponse.json({ error: "Invalid Live session." }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,interview_id")
    .eq("id", input.sessionId)
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  // Guest-share sessions are private to their guest link and are driven only
  // through the token-scoped guest routes, never here.
  if (!(await isCandidateLiveSession(service, input.sessionId, id, userId))) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  const { error } = await service.rpc("odesseus_complete_live_session", {
    p_session_id: input.sessionId,
    p_user_id: userId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const notFound = msg.includes("not found");
    return NextResponse.json(
      { error: notFound ? "Live session not found." : "Odesseus could not end the session cleanly." },
      { status: notFound ? 404 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
