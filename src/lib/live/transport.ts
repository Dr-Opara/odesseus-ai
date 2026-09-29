/**
 * The Live session transport.
 *
 * Odesseus Live is one engine, not two. This interface is the seam that keeps it
 * that way: the state machine, WebRTC negotiation, guidance rendering, timer,
 * recovery, and every bit of the visual system live in
 * `OdesseusLiveClient` and are not aware of who is driving. The transport is
 * the only thing that differs between an applicant and a guest, and it is
 * exactly five calls.
 *
 * Two implementations exist:
 *
 *   - {@link applicantLiveTransport} — the authenticated candidate routes,
 *     which is the default and unchanged behaviour.
 *   - `guestLiveTransport` in `@/lib/interviews/guest-transport` — the
 *     token-scoped guest routes, used by a guest who has no account.
 *
 * The response shapes were designed to be interchangeable, which is why the
 * guest engine needed no forked component: both routes answer `prepare` with a
 * `sessionId`, `webrtc` with `{sdp, id}`, `transcript` with the same
 * `{transcriptItemId, isQuestion, guidance}` body, and `end` with `{ok}`.
 *
 * Client-safe: this module must stay importable by a `"use client"` component,
 * so it imports no Supabase client and no server-only module.
 */

/** Capture source. Shared with the applicant route's own vocabulary. */
export type LiveCaptureMode = "microphone" | "shared_audio" | "mixed";

/** Which guidance style the transcript turn asked for. */
export type LiveGuidanceMode =
  | "default"
  | "star"
  | "shorter"
  | "technical"
  | "follow_up"
  | "manual";

/** One transcript turn submitted for storage and guidance. */
export type LiveTranscriptTurn = {
  /**
   * The session this turn belongs to.
   *
   * The applicant route scopes on it. The guest route ignores it and uses the
   * session its own token resolves to, which is why it is passed but not
   * trusted: a guest cannot name a session to write into.
   */
  sessionId: string;
  itemId: string;
  transcript: string;
  mode: LiveGuidanceMode;
  forceGuidance: boolean;
  turnIndex?: number;
};

/**
 * One guidance record, in `live_guidance` column names.
 *
 * Deliberately snake_case rather than a camelCase projection: the shared
 * transcript core returns the stored row on a normal turn and hand-builds an
 * object on a refused one, and the engine reads one shape in both cases. A
 * second spelling would make a refusal render as a blank panel -- the exact
 * failure the caution-only path exists to prevent.
 *
 * `response_text` is null on a refusal: the caution is the whole content.
 */
export type LiveGuidance = {
  question_text?: string | null;
  response_text: string | null;
  structure?: string | null;
  verified_evidence?: string[] | null;
  caution?: string | null;
};

/** What one transcript turn came back with. */
export type LiveGuidanceResponse = {
  isQuestion: boolean;
  questionText: string | null;
  guidance: LiveGuidance | null;
};

/** A prepared-but-not-yet-activated session. */
export type LivePrepareResult = {
  sessionId: string;
  status: string;
};

/** The realtime answer from the shared minter. */
export type LiveRealtimeAnswer = {
  sdp: string;
  /** The provider session id, needed for activation. */
  id: string;
};

/** A transport failure, carrying the message the route chose to show. */
export class LiveTransportError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LiveTransportError";
    this.status = status;
  }
}

/**
 * Everything the Live engine needs from a server.
 *
 * Implementations must throw {@link LiveTransportError} on a non-2xx response
 * so the engine can show the route's own message rather than a generic one.
 */
export type LiveTransport = {
  /**
   * Create or recover the session. Does not consume entitlement: only
   * activation does, and the engine calls that separately once the peer
   * connection is genuinely up.
   */
  prepare(input: { captureMode: LiveCaptureMode; consent: true }): Promise<LivePrepareResult>;

  /** Exchange the SDP offer for the realtime answer. */
  webrtc(input: { sessionId: string; sdp: string }): Promise<LiveRealtimeAnswer>;

  /** Commit the session. Idempotent; safe to call on a session already active. */
  activate(input: { sessionId: string; openaiSessionId: string }): Promise<void>;

  /** Persist one transcript turn and fetch its guidance. */
  transcript(input: LiveTranscriptTurn): Promise<LiveGuidanceResponse>;

  /** Close the session. Idempotent server-side. */
  end(input: { sessionId: string }): Promise<void>;
};

/** Reads a route's own error message, preferring its text over a generic one. */
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
 * Where the Live screen's two navigation buttons lead.
 *
 * The engine is shared, so these cannot be derived from `interviewId`: an
 * interview id is a real applicant's id, and building applicant URLs from a
 * guest token would hand a guest a link to a page that redirects to login. They
 * are supplied by whoever owns the screen instead, and the guest owns its own.
 */
export type LiveNavigationLinks = {
  /** The post-interview analysis. */
  analysis: string;
  /** The screen to return to when leaving Live. */
  workspace: string;
  /** What to call the return button, since a guest has no interview workspace. */
  workspaceLabel: string;
};

/**
 * The authenticated applicant's links.
 *
 * Unchanged behaviour: the same two destinations and the same label the engine
 * used before these were injectable.
 */
export function applicantLiveLinks(interviewId: string): LiveNavigationLinks {
  return {
    analysis: `/interviews/${interviewId}/analysis`,
    workspace: `/interviews/${interviewId}`,
    workspaceLabel: "Back to interview workspace",
  };
}

/**
 * The authenticated applicant's transport.
 *
 * Unchanged behaviour: same five routes, same bodies, same meaning. This is
 * the default the Live page uses, and the only place the applicant route paths
 * are written down.
 */
export function applicantLiveTransport(interviewId: string): LiveTransport {
  const base = `/api/interviews/${interviewId}/live`;

  return {
    async prepare({ captureMode, consent }) {
      const data = await postJson(
        `${base}/prepare`,
        { captureMode, consent },
        "Odesseus could not prepare the Live session."
      );
      if (typeof data.sessionId !== "string") {
        throw new LiveTransportError(
          "Odesseus could not prepare the Live session.",
          500
        );
      }
      return { sessionId: data.sessionId, status: String(data.status ?? "prepared") };
    },

    async webrtc({ sessionId, sdp }) {
      const data = await postJson(
        `${base}/webrtc`,
        { sessionId, sdp },
        "OpenAI Realtime could not connect."
      );
      if (typeof data.sdp !== "string") {
        throw new LiveTransportError("OpenAI Realtime could not connect.", 500);
      }
      // The minter answers `{sdp, id}`; `id` is the provider session id the
      // activation call needs. A missing id is not fatal here -- activation
      // reports it -- but the type says it is required, so default it to the
      // session rather than to undefined.
      return { sdp: data.sdp, id: String(data.id ?? "") };
    },

    async activate({ sessionId, openaiSessionId }) {
      await postJson(
        `${base}/activate`,
        { sessionId, openaiSessionId },
        "Odesseus could not activate the Live session."
      );
    },

    async transcript({ sessionId, itemId, transcript, mode, forceGuidance, turnIndex }) {
      const data = await postJson(
        `${base}/transcript`,
        { sessionId, itemId, transcript, mode, forceGuidance, turnIndex },
        "Odesseus could not process the transcript."
      );
      return {
        isQuestion: Boolean(data.isQuestion),
        questionText: (data.questionText as string | null) ?? null,
        guidance:
          (data.guidance as LiveGuidanceResponse["guidance"]) ?? null,
      };
    },

    async end({ sessionId }) {
      await postJson(
        `${base}/end`,
        { sessionId },
        "Odesseus could not end Live cleanly."
      );
    },
  };
}
