/**
 * Shared OpenAI Realtime call minting (Phase 2O extraction).
 *
 * The applicant WebRTC route and the token-scoped guest WebRTC route mint
 * the identical realtime call from the session's context snapshot. One mint
 * path, two authorization paths. The safety identifier is derived from the
 * caller the route verified: the owner's user id, or the guest record id
 * (never the owner's id for a guest call).
 */

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type RealtimeMintResult =
  | { ok: true; sdp: string; id: string }
  | { ok: false; status: number; error: string; detail?: string };

export async function mintRealtimeCall(
  service: ServiceClient,
  input: {
    sessionId: string;
    safetySeed: string;
    sdp: string;
    contextSnapshot: unknown;
    currentStatus: string;
  }
): Promise<RealtimeMintResult> {
  const context = input.contextSnapshot as {
    application?: {
      companyName?: string;
      roleTitle?: string;
      resumeSnapshot?: { parsed_data?: { content?: { skills?: string[] } } };
    };
  } | null;
  const company = context?.application?.companyName || "the employer";
  const role = context?.application?.roleTitle || "the role";
  const keywords = [
    company,
    role,
    ...(context?.application?.resumeSnapshot?.parsed_data?.content?.skills || []).slice(0, 20),
  ]
    .map((value: unknown) => String(value || "").replace(/[<>\r\n]/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);

  const sessionConfig = {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: "gpt-live-transcribe",
          prompt: `A professional job interview for ${role} at ${company}. Transcribe interview questions and discussion accurately.`,
          keywords,
          languages: ["en"],
          delay: "low",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 650,
        },
      },
    },
  };

  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set("session", JSON.stringify(sessionConfig));

  const safetyId = createHash("sha256").update(input.safetySeed).digest("hex");

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Safety-Identifier": safetyId,
    },
    body: form,
  });

  const body = await response.text();

  if (!response.ok) {
    await service
      .from("live_interview_sessions")
      .update({
        status: input.currentStatus === "active" ? "active" : "failed",
        error_message: "OpenAI Realtime session creation failed.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.sessionId);

    return {
      ok: false,
      status: response.status,
      error: "OpenAI Realtime session creation failed.",
      detail: body.slice(0, 1000),
    };
  }

  return {
    ok: true,
    sdp: body,
    id:
      response.headers.get("openai-session-id") ||
      response.headers.get("x-request-id") ||
      `realtime:${input.sessionId}`,
  };
}
