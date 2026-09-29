"use client";

/**
 * The token-scoped guest transport.
 *
 * Implements the same {@link LiveTransport} seam as the applicant's, against
 * the guest routes under `/api/live/guest-access/[token]/`. This is what lets a
 * guest with no account use the unmodified `OdesseusLiveClient`: the engine
 * cannot tell the difference.
 *
 * What makes it safe, and why none of it is reimplemented here:
 *
 *  - The token in the URL is the entire credential. The guest has no session,
 *    so every call is server-mediated and the route re-derives the single
 *    guest record from the token's hash. Nothing here holds an owner id, and no
 *    value the browser can supply is trusted for scoping.
 *  - `sessionId` is accepted and then dropped on every call that ignores it.
 *    The guest routes resolve the session from the token, so a guest cannot
 *    name a session to read from or write into. Sending it would be harmless
 *    but misleading; not sending it is the honest shape.
 *  - `prepare` is the guest `POST /session`, which is the same
 *    `odesseus_create_live_session` lifecycle the applicant `prepare` route
 *    uses, and returns the same `sessionId` field the engine reads.
 *  - `activate` consumes entitlement exactly as an applicant session would,
 *    through the owner's existing Share Annual access. The guest never touches
 *    credit tables, and never sees a price.
 *
 * Client-safe by construction: no Supabase import, no server module.
 */

import {
  LiveTransportError,
  type LivePrepareResult,
  type LiveRealtimeAnswer,
  type LiveGuidanceResponse,
  type LiveTransport,
  type LiveTranscriptTurn,
} from "@/lib/live/transport";

/** Reads the route's own error message, preferring its text over a generic one. */
async function fail(response: Response, fallback: string): Promise<never> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string | { message?: string } }
    | null;
  const raw = payload?.error;
  const message =
    typeof raw === "string" && raw
      ? raw
      : raw && typeof raw === "object" && raw.message
        ? raw.message
        : fallback;
  throw new LiveTransportError(message, response.status);
}

async function postJson(
  url: string,
  body: unknown,
  fallback: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return fail(response, fallback);
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/**
 * Builds a guest transport for one link token.
 *
 * The token is the whole credential, so it is captured in the closure rather
 * than passed per call: a transport cannot be pointed at another link after it
 * has been built.
 */
export function guestLiveTransport(token: string): LiveTransport {
  // encodeURIComponent: the token is hex today, but encoding it means a token
  // that ever gains a reserved character cannot break out of its path segment
  // and reach a different route.
  const base = `/api/live/guest-access/${encodeURIComponent(token)}`;

  return {
    async prepare(): Promise<LivePrepareResult> {
      // No body. The guest session route mints the session from the token and
      // the guest's own saved setup, so there is nothing for the client to
      // specify -- and no client-supplied capture mode that could change how
      // audio is captured for someone else's interview.
      const data = await postJson(
        `${base}/session`,
        {},
        "Odesseus could not start the guest Live session."
      );
      if (typeof data.sessionId !== "string") {
        throw new LiveTransportError(
          "Odesseus could not start the guest Live session.",
          500
        );
      }
      return { sessionId: data.sessionId, status: String(data.status ?? "prepared") };
    },

    async webrtc({ sdp }): Promise<LiveRealtimeAnswer> {
      // The session id is deliberately not sent: the route scopes on the
      // session its own token resolves to.
      const data = await postJson(
        `${base}/session/webrtc`,
        { sdp },
        "OpenAI Realtime could not connect."
      );
      if (typeof data.sdp !== "string") {
        throw new LiveTransportError("OpenAI Realtime could not connect.", 500);
      }
      return { sdp: data.sdp, id: String(data.id ?? "") };
    },

    async activate({ openaiSessionId }): Promise<void> {
      await postJson(
        `${base}/session/activate`,
        { openaiSessionId },
        "Odesseus could not activate the Live session."
      );
    },

    async transcript({ itemId, transcript, mode, forceGuidance, turnIndex }: LiveTranscriptTurn) {
      const data = await postJson(
        `${base}/session/transcript`,
        { itemId, transcript, mode, forceGuidance, turnIndex },
        "Odesseus could not process the transcript."
      );
      return {
        isQuestion: Boolean(data.isQuestion),
        questionText: (data.questionText as string | null) ?? null,
        guidance: (data.guidance as LiveGuidanceResponse["guidance"]) ?? null,
      };
    },

    async end(): Promise<void> {
      // No session id: the route ends the session its own token resolves to.
      await postJson(
        `${base}/session/end`,
        {},
        "Odesseus could not end Live cleanly."
      );
    },
  };
}
