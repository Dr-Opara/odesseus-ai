import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateLiveGuidance } from "@/lib/ai/live-guidance";

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

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot,activated_at,created_at")
    .eq("id", input.sessionId)
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!liveSession || !["active","prepared"].includes(liveSession.status)) {
    return NextResponse.json({ error: "Live session is not active." }, { status: 409 });
  }

  const existing = await service
    .from("live_transcript_items")
    .select("id,is_question,question_text")
    .eq("session_id", input.sessionId)
    .eq("realtime_item_id", input.itemId)
    .maybeSingle();

  let transcriptItemId = existing.data?.id || null;

  if (!transcriptItemId) {
    const sessionStart =
      liveSession.activated_at || liveSession.created_at || new Date().toISOString();
    const occurredAt =
      input.turnIndex !== undefined
        ? new Date(new Date(sessionStart).getTime() + input.turnIndex).toISOString()
        : undefined;

    const { data: inserted, error } = await service
      .from("live_transcript_items")
      .insert({
        session_id: input.sessionId,
        user_id: userId,
        realtime_item_id: input.itemId,
        transcript: input.transcript,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return NextResponse.json({ error: "Odysseus could not save the transcript." }, { status: 500 });
    }

    transcriptItemId = inserted.id;
  }

  await service
    .from("live_interview_sessions")
    .update({
      last_transcript_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);

  const guidance = await generateLiveGuidance({
    transcript: input.transcript,
    mode: input.mode,
    context: liveSession.context_snapshot,
  });

  if (!guidance.isQuestion && !input.forceGuidance) {
    return NextResponse.json({
      transcriptItemId,
      isQuestion: false,
      guidance: null,
    });
  }

  const questionText = guidance.questionText || input.transcript;

  await service
    .from("live_transcript_items")
    .update({
      is_question: true,
      question_text: questionText,
    })
    .eq("id", transcriptItemId)
    .eq("user_id", userId);

  if (!guidance.responseText) {
    return NextResponse.json({
      transcriptItemId,
      isQuestion: true,
      questionText,
      guidance: null,
    });
  }

  const { data: savedGuidance } = await service
    .from("live_guidance")
    .insert({
      session_id: input.sessionId,
      transcript_item_id: transcriptItemId,
      user_id: userId,
      mode: input.mode,
      question_text: questionText,
      response_text: guidance.responseText,
      structure: guidance.structure,
      verified_evidence: guidance.verifiedEvidence,
      caution: guidance.caution,
    })
    .select("id,mode,question_text,response_text,structure,verified_evidence,caution,created_at")
    .single();

  return NextResponse.json({
    transcriptItemId,
    isQuestion: true,
    questionText,
    guidance: savedGuidance || guidance,
  });
}
