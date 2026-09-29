import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicantLiveTransport,
  LiveTransportError,
  type LiveTransport,
} from "@/lib/live/transport";
import { guestLiveTransport } from "@/lib/interviews/guest-transport";

/**
 * The Live transport seam.
 *
 * Odesseus Live is one engine. Everything that distinguishes an applicant
 * session from a guest session is inside these two objects, which is why these
 * tests are as much about *scoping* as about URLs: the guest transport must
 * never let the browser name a session, because the guest routes ignore any
 * session id and derive their own from the token. If a session id ever started
 * being honoured, a guest would be able to write into another interview.
 */

const TOKEN = "ab".repeat(32);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The URL and parsed body of the nth fetch call. */
function call(n = 0): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

function respondWith(payload: unknown, status = 200) {
  // A fresh Response per call: a Response body can only be read once, so
  // returning one shared instance would silently hand the second call an empty
  // body and fail in a way that looks like a transport bug.
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("applicantLiveTransport", () => {
  const transport = (): LiveTransport => applicantLiveTransport("interview-1");

  it("calls the five authenticated applicant routes", async () => {
    respondWith({ sessionId: "s1", status: "prepared", sdp: "answer", id: "rt-1" });

    await transport().prepare({ captureMode: "shared_audio", consent: true });
    await transport().webrtc({ sessionId: "s1", sdp: "offer" });
    await transport().activate({ sessionId: "s1", openaiSessionId: "rt-1" });
    await transport().transcript({
      sessionId: "s1",
      itemId: "i1",
      transcript: "Tell me about yourself.",
      mode: "default",
      forceGuidance: false,
    });
    await transport().end({ sessionId: "s1" });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "/api/interviews/interview-1/live/prepare",
      "/api/interviews/interview-1/live/webrtc",
      "/api/interviews/interview-1/live/activate",
      "/api/interviews/interview-1/live/transcript",
      "/api/interviews/interview-1/live/end",
    ]);
    // All five are POSTs. The applicant Live surface is write-only from the
    // browser's point of view; state is read by the page, not by the engine.
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe("POST");
    }
  });

  it("sends the session id on every call that scopes by it", async () => {
    respondWith({ sessionId: "s1", sdp: "answer", id: "rt-1" });
    const t = transport();

    await t.webrtc({ sessionId: "s1", sdp: "offer" });
    expect(call(0).body).toEqual({ sessionId: "s1", sdp: "offer" });

    await t.activate({ sessionId: "s1", openaiSessionId: "rt-1" });
    expect(call(1).body).toEqual({ sessionId: "s1", openaiSessionId: "rt-1" });

    await t.end({ sessionId: "s1" });
    expect(call(2).body).toEqual({ sessionId: "s1" });

    await t.transcript({
      sessionId: "s1",
      itemId: "i1",
      transcript: "hello",
      mode: "default",
      forceGuidance: false,
      turnIndex: 3,
    });
    expect(call(3).body).toMatchObject({
      sessionId: "s1",
      itemId: "i1",
      transcript: "hello",
      turnIndex: 3,
    });
  });

  it("sends the capture mode and the consent the applicant route requires", async () => {
    respondWith({ sessionId: "s1" });
    await transport().prepare({ captureMode: "microphone", consent: true });
    expect(call(0).body).toEqual({ captureMode: "microphone", consent: true });
  });

  it("fails when prepare answers without a session id", async () => {
    // A 200 with no sessionId would previously have produced a session id of
    // undefined and failed much later, inside WebRTC, with a message about
    // audio. Failing at the call that is actually broken is the point.
    respondWith({ status: "prepared" });
    await expect(
      transport().prepare({ captureMode: "mixed", consent: true })
    ).rejects.toThrow(/could not prepare/i);
  });

  it("fails when webrtc answers without an SDP answer", async () => {
    respondWith({ id: "rt-1" });
    await expect(
      transport().webrtc({ sessionId: "s1", sdp: "offer" })
    ).rejects.toThrow(/could not connect/i);
  });

  it("surfaces the route's own error message and status", async () => {
    respondWith({ error: "No interview pass is available." }, 402);
    const error = await transport()
      .activate({ sessionId: "s1", openaiSessionId: "rt-1" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LiveTransportError);
    expect((error as LiveTransportError).status).toBe(402);
    expect((error as LiveTransportError).message).toBe("No interview pass is available.");
  });

  it("reads a nested error message shape as well as a flat one", async () => {
    respondWith({ error: { message: "Live session not found." } }, 404);
    await expect(
      transport().webrtc({ sessionId: "s1", sdp: "offer" })
    ).rejects.toThrow("Live session not found.");
  });

  it("falls back to a usable message when the body is not JSON", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("<html>502</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
    );
    await expect(transport().end({ sessionId: "s1" })).rejects.toThrow(
      /could not end Live cleanly/i
    );
  });

  it("returns the guidance body the engine renders", async () => {
    respondWith({
      transcriptItemId: "t1",
      isQuestion: true,
      questionText: "Why this role?",
      guidance: {
        question_text: "Why this role?",
        response_text: "Because your resume shows X.",
        structure: null,
        verified_evidence: ["X"],
        caution: null,
      },
    });

    const result = await transport().transcript({
      sessionId: "s1",
      itemId: "i1",
      transcript: "Why this role?",
      mode: "default",
      forceGuidance: false,
    });

    expect(result.isQuestion).toBe(true);
    expect(result.questionText).toBe("Why this role?");
    expect(result.guidance?.response_text).toBe("Because your resume shows X.");
  });

  it("passes a refusal through with its caution and no answer", async () => {
    // The coding guard. A caution with a null response is a deliberate refusal,
    // and the engine renders the caution on its own.
    respondWith({
      transcriptItemId: "t2",
      isQuestion: true,
      questionText: "Write a function to reverse a linked list",
      guidance: {
        question_text: "Write a function to reverse a linked list",
        response_text: null,
        structure: null,
        verified_evidence: [],
        caution: "Odesseus Live does not assist with coding interviews.",
      },
    });

    const result = await transport().transcript({
      sessionId: "s1",
      itemId: "i2",
      transcript: "Write a function to reverse a linked list",
      mode: "default",
      forceGuidance: false,
    });

    expect(result.guidance?.caution).toMatch(/does not assist with coding/);
    expect(result.guidance?.response_text).toBeNull();
  });

  it("normalizes a missing question text and missing guidance to null", async () => {
    respondWith({ isQuestion: false });
    const result = await transport().transcript({
      sessionId: "s1",
      itemId: "i1",
      transcript: "...",
      mode: "default",
      forceGuidance: false,
    });
    expect(result).toEqual({ isQuestion: false, questionText: null, guidance: null });
  });
});

describe("guestLiveTransport", () => {
  const transport = (): LiveTransport => guestLiveTransport(TOKEN);

  it("calls the five token-scoped guest routes", async () => {
    respondWith({ sessionId: "s1", status: "prepared", sdp: "answer", id: "rt-1" });

    await transport().prepare({ captureMode: "shared_audio", consent: true });
    await transport().webrtc({ sessionId: "s1", sdp: "offer" });
    await transport().activate({ sessionId: "s1", openaiSessionId: "rt-1" });
    await transport().transcript({
      sessionId: "s1",
      itemId: "i1",
      transcript: "hello",
      mode: "default",
      forceGuidance: false,
    });
    await transport().end({ sessionId: "s1" });

    const base = `/api/live/guest-access/${TOKEN}`;
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${base}/session`,
      `${base}/session/webrtc`,
      `${base}/session/activate`,
      `${base}/session/transcript`,
      `${base}/session/end`,
    ]);
  });

  it("never sends a session id the browser supplied", async () => {
    // This is the privacy load-bearing assertion. The guest routes resolve their
    // own session from the token and ignore any session id, so a guest cannot
    // name a session. Not sending one is what makes that visible in the code
    // rather than merely true of the server.
    respondWith({ sessionId: "s1", sdp: "answer", id: "rt-1" });
    const t = transport();

    await t.webrtc({ sessionId: "attacker-chosen", sdp: "offer" });
    await t.activate({ sessionId: "attacker-chosen", openaiSessionId: "rt-1" });
    await t.end({ sessionId: "attacker-chosen" });
    await t.transcript({
      sessionId: "attacker-chosen",
      itemId: "i1",
      transcript: "hello",
      mode: "default",
      forceGuidance: false,
    });

    for (const { body } of [call(0), call(1), call(2), call(3)]) {
      expect(body).not.toHaveProperty("sessionId");
    }
    expect(JSON.stringify([call(0), call(1), call(2), call(3)])).not.toContain(
      "attacker-chosen"
    );
  });

  it("never sends a capture mode for someone else's interview", async () => {
    // The guest session route mints from the token and the guest's own saved
    // setup. A client-supplied captureMode would let one person choose how
    // another person's audio is captured.
    respondWith({ sessionId: "s1" });
    await transport().prepare({ captureMode: "microphone", consent: true });
    expect(call(0).body).toEqual({});
  });

  it("sends the transcript turn fields the guest route reads", async () => {
    respondWith({ isQuestion: true, questionText: "q" });
    await transport().transcript({
      sessionId: "s1",
      itemId: "i9",
      transcript: "the transcript text",
      mode: "shorter",
      forceGuidance: true,
      turnIndex: 7,
    });
    expect(call(0).body).toEqual({
      itemId: "i9",
      transcript: "the transcript text",
      mode: "shorter",
      forceGuidance: true,
      turnIndex: 7,
    });
  });

  it("fails when the session route answers without a session id", async () => {
    respondWith({ hasSession: false });
    await expect(
      transport().prepare({ captureMode: "shared_audio", consent: true })
    ).rejects.toThrow(/guest Live session/i);
  });

  it("reports a retired link rather than a missing-session bug", async () => {
    // loadGuestAccess answers 404/403 for a link that no longer works. The
    // message must reach the guest intact, or they will think their interview
    // is broken rather than that the link expired.
    respondWith({ error: "This guest link is not available." }, 404);
    const error = await transport()
      .prepare({ captureMode: "shared_audio", consent: true })
      .catch((e: unknown) => e);
    expect((error as LiveTransportError).status).toBe(404);
    expect((error as LiveTransportError).message).toBe("This guest link is not available.");
  });

  it("reports a lapsed owner's plan on activation", async () => {
    // Entitlement is checked server-side when the session activates, not before.
    respondWith({ error: "Guest Live access is no longer available." }, 403);
    await expect(
      transport().activate({ sessionId: "s1", openaiSessionId: "rt-1" })
    ).rejects.toThrow("Guest Live access is no longer available.");
  });

  it("encodes the token into the path so it cannot escape its segment", async () => {
    const odd = guestLiveTransport("a/b/../c?d=e#f");
    respondWith({ sessionId: "s1" });
    await odd.prepare({ captureMode: "shared_audio", consent: true });
    const { url } = call(0);
    expect(url).toBe("/api/live/guest-access/a%2Fb%2F..%2Fc%3Fd%3De%23f/session");
    expect(url.split("/")[3]).not.toContain("/");
  });

  it("never embeds an owner or applicant identifier in a request", async () => {
    respondWith({ sessionId: "s1", sdp: "answer", id: "rt-1" });
    const t = transport();
    await t.prepare({ captureMode: "shared_audio", consent: true });
    await t.webrtc({ sessionId: "s1", sdp: "offer" });
    await t.activate({ sessionId: "s1", openaiSessionId: "rt-1" });
    await t.end({ sessionId: "s1" });

    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      // The token is the whole credential; the only identity on the wire is it.
      expect(url.startsWith(`/api/live/guest-access/${TOKEN}/`)).toBe(true);
      expect(String(init.body)).not.toMatch(/owner|userId|user_id/i);
    }
  });
});

describe("applicantLiveLinks", () => {
  it("keeps the destinations and the label the engine used before", async () => {
    const { applicantLiveLinks } = await import("@/lib/live/transport");
    expect(applicantLiveLinks("interview-1")).toEqual({
      analysis: "/interviews/interview-1/analysis",
      workspace: "/interviews/interview-1",
      workspaceLabel: "Back to interview workspace",
    });
  });
});

describe("the two transports are interchangeable", () => {
  it("answers the same shapes for the same server responses", async () => {
    // The reason the guest needed no forked engine: the routes were built to
    // answer alike. If either transport changes shape, this fails.
    const serverAnswer = {
      sessionId: "s1",
      status: "prepared",
      sdp: "answer-sdp",
      id: "rt-1",
      isQuestion: true,
      questionText: "q",
      guidance: { response: "r" },
    };

    respondWith(serverAnswer);
    const applicant = applicantLiveTransport("i1");
    const guest = guestLiveTransport(TOKEN);

    expect(await applicant.prepare({ captureMode: "mixed", consent: true })).toEqual(
      await guest.prepare({ captureMode: "mixed", consent: true })
    );
    expect(await applicant.webrtc({ sessionId: "s1", sdp: "o" })).toEqual(
      await guest.webrtc({ sessionId: "s1", sdp: "o" })
    );
    expect(
      await applicant.transcript({
        sessionId: "s1",
        itemId: "i",
        transcript: "t",
        mode: "default",
        forceGuidance: false,
      })
    ).toEqual(
      await guest.transcript({
        sessionId: "s1",
        itemId: "i",
        transcript: "t",
        mode: "default",
        forceGuidance: false,
      })
    );
  });
});
