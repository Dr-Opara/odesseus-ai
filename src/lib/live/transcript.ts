/**
 * Shared Live transcript + guidance core (Phase 2O extraction).
 *
 * The applicant transcript route and the token-scoped guest transcript route
 * run this exact function: persist the turn, refresh the session heartbeat,
 * generate grounded guidance from the session's context snapshot, and store
 * guidance when the turn is a question. One engine, two authorization paths.
 */

import { generateLiveGuidance } from "@/lib/ai/live-guidance";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type TranscriptMode =
  | "default"
  | "star"
  | "shorter"
  | "technical"
  | "follow_up"
  | "manual";

export type TranscriptAppendInput = {
  sessionId: string;
  itemId: string;
  transcript: string;
  mode: TranscriptMode;
  forceGuidance: boolean;
  turnIndex?: number;
};

export type LiveSessionForTranscript = {
  id: string;
  status: string;
  context_snapshot: unknown;
  activated_at: string | null;
  created_at: string;
};

export type TranscriptAppendResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Append one transcript turn and generate guidance from the session context.
 * The caller owns authorization (authenticated owner route or validated
 * guest token) and passes the already-verified session row and user id.
 */
export async function appendTranscriptItem(
  service: ServiceClient,
  input: {
    session: LiveSessionForTranscript;
    userId: string;
    turn: TranscriptAppendInput;
  }
): Promise<TranscriptAppendResult> {
  const { session: liveSession, userId, turn: item } = input;

  if (!["active", "prepared"].includes(liveSession.status)) {
    return { ok: false, status: 409, error: "Live session is not active." };
  }

  const existing = await service
    .from("live_transcript_items")
    .select("id,is_question,question_text")
    .eq("session_id", item.sessionId)
    .eq("realtime_item_id", item.itemId)
    .maybeSingle();

  let transcriptItemId = existing.data?.id || null;

  if (!transcriptItemId) {
    const sessionStart =
      liveSession.activated_at || liveSession.created_at || new Date().toISOString();
    const occurredAt =
      item.turnIndex !== undefined
        ? new Date(new Date(sessionStart).getTime() + item.turnIndex).toISOString()
        : undefined;

    const { data: inserted, error } = await service
      .from("live_transcript_items")
      .insert({
        session_id: item.sessionId,
        user_id: userId,
        realtime_item_id: item.itemId,
        transcript: item.transcript,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return { ok: false, status: 500, error: "Odesseus could not save the transcript." };
    }

    transcriptItemId = inserted.id;
  }

  await service
    .from("live_interview_sessions")
    .update({
      last_transcript_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.sessionId);

  // The transcript turn is already durable by this point, so a failure to
  // generate guidance is not a failure of the append. It used to propagate: the
  // provider call throws, the route has no handler for it, and the caller got a
  // bare non-JSON 500 -- which loses the confirmation that the turn was
  // recorded and, worse, breaks the session for a person who is mid-interview.
  //
  // Reported as a successful append with `guidanceUnavailable`, which is a
  // distinct thing from `isQuestion: false`. Silence there means "that was not
  // a question"; here it means "we could not answer", and the panel should be
  // able to tell the difference. The turn is kept either way.
  let guidance: Awaited<ReturnType<typeof generateLiveGuidance>>;
  try {
    guidance = await generateLiveGuidance({
      transcript: item.transcript,
      mode: item.mode,
      context: liveSession.context_snapshot,
    });
  } catch (error) {
    console.error(
      "[ODESSEUS_LIVE] could not generate guidance for a transcript turn:",
      error
    );
    return {
      ok: true,
      body: {
        transcriptItemId,
        isQuestion: false,
        guidance: null,
        guidanceUnavailable: true,
      },
    };
  }

  if (!guidance.isQuestion && !item.forceGuidance) {
    return {
      ok: true,
      body: {
        transcriptItemId,
        isQuestion: false,
        guidance: null,
      },
    };
  }

  const questionText = guidance.questionText || item.transcript;

  await service
    .from("live_transcript_items")
    .update({
      is_question: true,
      question_text: questionText,
    })
    .eq("id", transcriptItemId)
    .eq("user_id", userId);

  if (!guidance.responseText) {
    // No answer, but there may still be something the person needs to read.
    //
    // This is the coding-interview path: `generateLiveGuidance` deliberately
    // returns no response text and a caution saying Odesseus Live does not
    // assist with coding. Returning `guidance: null` here discarded that
    // message, so the panel simply went blank and the person concluded the
    // product had failed. Silence is the wrong answer to "Odesseus will not
    // help with this" -- the refusal itself is the content.
    //
    // A caution is therefore returned on its own, carrying no answer, no
    // structure, and no evidence. The keys are the same snake_case the stored
    // `live_guidance` row uses on the successful path below, so the engine
    // reads one shape whatever happened: a second spelling here would render
    // as a blank panel, which is the exact failure being fixed.
    return {
      ok: true,
      body: {
        transcriptItemId,
        isQuestion: true,
        questionText,
        guidance: guidance.caution
          ? {
              question_text: questionText,
              response_text: null,
              structure: null,
              verified_evidence: [],
              caution: guidance.caution,
            }
          : null,
      },
    };
  }

  const { data: savedGuidance } = await service
    .from("live_guidance")
    .insert({
      session_id: item.sessionId,
      transcript_item_id: transcriptItemId,
      user_id: userId,
      mode: item.mode,
      question_text: questionText,
      response_text: guidance.responseText,
      structure: guidance.structure,
      verified_evidence: guidance.verifiedEvidence,
      caution: guidance.caution,
    })
    .select("id,mode,question_text,response_text,structure,verified_evidence,caution,created_at")
    .single();

  return {
    ok: true,
    body: {
      transcriptItemId,
      isQuestion: true,
      questionText,
      guidance: savedGuidance || guidance,
    },
  };
}
