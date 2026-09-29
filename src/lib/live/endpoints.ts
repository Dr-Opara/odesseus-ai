/**
 * Live session endpoints (F2).
 *
 * Odesseus Live has exactly one engine. This module is the only place that
 * knows which routes drive it: an applicant session posts to
 * `/api/interviews/{interviewId}/live/*` behind their auth session, while a
 * guest session posts to the token-scoped `/api/live/guest-access/{token}/*
 * routes. Both run the same WebRTC capture, the same transcript persistence,
 * and the same guidance generation — there is no second Guest Live engine and
 * no second Live component.
 *
 * Guest callers are anonymous by design: the link token is the whole
 * credential, and the backend resolves exactly one guest record from it. The
 * guest routes therefore expose only that guest's own session state and never
 * the link owner's profile, resume, applications, wallet, or billing.
 */
import type { CaptureMode, GuidanceMode } from "./live-types";

export type LiveStartResult = { ok: true; sessionId: string } | { ok: false; error: string };
export type LiveConnectResult = { ok: true; sdp: string; id: string } | { ok: false; error: string };
export type LiveOkResult = { ok: true } | { ok: false; error: string };
export type LiveTranscriptResult =
  | { ok: true; isQuestion: boolean; questionText?: string | null; guidance: GuidancePayload | null }
  | { ok: false; error: string };

export type GuidancePayload = {
  question_text?: string | null;
  response_text?: string | null;
  structure?: string | null;
  verified_evidence?: string[] | null;
  caution?: string | null;
};

export type LiveTurnInput = {
  sessionId: string;
  itemId: string;
  transcript: string;
  mode: GuidanceMode;
  forceGuidance: boolean;
  turnIndex: number;
};

export type LiveSessionEndpoints = {
  start: (input: { captureMode: CaptureMode; consent: true }) => Promise<LiveStartResult>;
  connect: (input: { sessionId: string; sdp: string }) => Promise<LiveConnectResult>;
  activate: (input: { sessionId: string; openaiSessionId: string }) => Promise<LiveOkResult>;
  transcript: (input: LiveTurnInput) => Promise<LiveTranscriptResult>;
  end: (input: { sessionId: string }) => Promise<LiveOkResult>;
};

async function postJson<T>(path: string, body: unknown): Promise<T | { error?: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
    if (!response.ok || !payload) {
      const message = (payload as { error?: string } | null)?.error;
      return { error: message || "Odesseus could not complete that request." };
    }
    return payload;
  } catch {
    return { error: "Odesseus could not reach the Live service." };
  }
}

function asError(payload: unknown, fallback: string): string {
  const message = (payload as { error?: string } | null)?.error;
  return message && message.trim() ? message : fallback;
}

/** Applicant Live: the signed-in interview's own session routes. */
export function candidateLiveEndpoints(interviewId: string): LiveSessionEndpoints {
  const base = `/api/interviews/${encodeURIComponent(interviewId)}/live`;
  return {
    async start({ captureMode, consent }) {
      const payload = await postJson<{ sessionId?: string }>(`${base}/prepare`, { captureMode, consent });
      if (!("sessionId" in payload) || !payload.sessionId) {
        return { ok: false, error: asError(payload, "Odesseus could not prepare the Live session.") };
      }
      return { ok: true, sessionId: payload.sessionId };
    },
    async connect({ sessionId, sdp }) {
      const payload = await postJson<{ sdp?: string; id?: string }>(`${base}/webrtc`, { sessionId, sdp });
      if (!("sdp" in payload) || !payload.sdp) {
        return { ok: false, error: asError(payload, "OpenAI Realtime could not connect.") };
      }
      return { ok: true, sdp: payload.sdp, id: payload.id ?? "realtime" };
    },
    async activate({ sessionId, openaiSessionId }) {
      const payload = await postJson<{ ok?: boolean }>(`${base}/activate`, { sessionId, openaiSessionId });
      if (!("ok" in payload) || payload.ok !== true) {
        return { ok: false, error: asError(payload, "Odesseus could not activate the Live session.") };
      }
      return { ok: true };
    },
    async transcript(input) {
      const payload = await postJson<{
        isQuestion?: boolean;
        questionText?: string | null;
        guidance?: GuidancePayload | null;
      }>(`${base}/transcript`, input);
      if (!("isQuestion" in payload) || typeof payload.isQuestion !== "boolean") {
        return { ok: false, error: asError(payload, "Odesseus could not process the transcript.") };
      }
      return {
        ok: true,
        isQuestion: payload.isQuestion,
        questionText: payload.questionText ?? null,
        guidance: payload.guidance ?? null,
      };
    },
    async end({ sessionId }) {
      const payload = await postJson<{ ok?: boolean }>(`${base}/end`, { sessionId });
      if (!("ok" in payload) || payload.ok !== true) {
        return { ok: false, error: asError(payload, "Odesseus could not end the session cleanly.") };
      }
      return { ok: true };
    },
  };
}

/**
 * Guest Live: the token-scoped routes. Starting a guest session creates it
 * (idempotently — a started link returns the session it already has), and
 * every later call is scoped by the token alone. No applicant id, interview
 * id, or pass is involved: the owner's Share Annual entitlement is consumed
 * server-side, only on activation.
 */
export function guestLiveEndpoints(token: string): LiveSessionEndpoints {
  const base = `/api/live/guest-access/${encodeURIComponent(token)}/session`;
  return {
    async start() {
      const payload = await postJson<{ sessionId?: string }>(base, {});
      if (!("sessionId" in payload) || !payload.sessionId) {
        return { ok: false, error: asError(payload, "Odesseus could not start the guest session.") };
      }
      return { ok: true, sessionId: payload.sessionId };
    },
    async connect({ sdp }) {
      const payload = await postJson<{ sdp?: string; id?: string }>(`${base}/webrtc`, { sdp });
      if (!("sdp" in payload) || !payload.sdp) {
        return { ok: false, error: asError(payload, "OpenAI Realtime could not connect.") };
      }
      return { ok: true, sdp: payload.sdp, id: payload.id ?? "realtime" };
    },
    async activate({ openaiSessionId }) {
      const payload = await postJson<{ ok?: boolean }>(`${base}/activate`, { openaiSessionId });
      if (!("ok" in payload) || payload.ok !== true) {
        return { ok: false, error: asError(payload, "Odesseus could not activate Live.") };
      }
      return { ok: true };
    },
    async transcript({ itemId, transcript, mode, forceGuidance, turnIndex }) {
      const payload = await postJson<{
        isQuestion?: boolean;
        questionText?: string | null;
        guidance?: GuidancePayload | null;
      }>(`${base}/transcript`, { itemId, transcript, mode, forceGuidance, turnIndex });
      if (!("isQuestion" in payload) || typeof payload.isQuestion !== "boolean") {
        return { ok: false, error: asError(payload, "Odesseus could not process the transcript.") };
      }
      return {
        ok: true,
        isQuestion: payload.isQuestion,
        questionText: payload.questionText ?? null,
        guidance: payload.guidance ?? null,
      };
    },
    async end() {
      const payload = await postJson<{ ok?: boolean }>(`${base}/end`, {});
      if (!("ok" in payload) || payload.ok !== true) {
        return { ok: false, error: asError(payload, "Odesseus could not end the session cleanly.") };
      }
      return { ok: true };
    },
  };
}
