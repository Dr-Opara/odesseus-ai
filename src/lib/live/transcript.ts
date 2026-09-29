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

  const guidance = await generateLiveGuidance({
    transcript: item.transcript,
    mode: item.mode,
    context: liveSession.context_snapshot,
  });

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
    return {
      ok: true,
      body: {
        transcriptItemId,
        isQuestion: true,
        questionText,
        guidance: null,
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
