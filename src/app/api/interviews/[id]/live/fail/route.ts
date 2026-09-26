import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  sessionId: z.string().uuid(),
  errorMessage: z.string().min(1).max(1000),
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
    return NextResponse.json({ error: "Invalid failure report." }, { status: 400 });
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

  const { data, error } = await service.rpc("odesseus_fail_live_session", {
    p_session_id: input.sessionId,
    p_user_id: userId,
    p_error_message: input.errorMessage,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const notFound = msg.includes("not found");
    return NextResponse.json(
      { error: notFound ? "Live session not found." : "Odesseus could not mark the session as failed." },
      { status: notFound ? 404 : 500 }
    );
  }

  return NextResponse.json({ ok: true, session: data });
}