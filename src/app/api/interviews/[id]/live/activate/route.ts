import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isCandidateLiveSession } from "@/lib/interviews/guest-share";

const schema = z.object({
  sessionId: z.string().uuid(),
  openaiSessionId: z.string().min(3),
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
    return NextResponse.json({ error: "Invalid Live activation." }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,interview_id,status")
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

  const { data, error } = await service.rpc("odesseus_activate_live_session_v2", {
    p_session_id: input.sessionId,
    p_user_id: userId,
    p_openai_session_id: input.openaiSessionId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const insufficient = msg.includes("insufficient") || msg.includes("no live entitlement") || msg.includes("fair use limit");
    const notFound = msg.includes("not found");
    return NextResponse.json(
      { error: insufficient ? "No interview pass is available." : notFound ? "Live session not found." : "Odesseus could not activate Live." },
      { status: insufficient ? 402 : notFound ? 404 : 500 }
    );
  }

  // data is a setof record; take the first row
  const row = data?.[0];
  return NextResponse.json({
    ok: true,
    session: row?.session,
    entitlementConsumed: row?.entitlement_consumed ?? false,
    entitlementType: row?.entitlement_type ?? null,
    passesRemaining: row?.passes_remaining ?? null,
  });
}
