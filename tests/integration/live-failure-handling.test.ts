import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Two regressions from the Task 8 live-flow sweep.
 *
 * The first is a provider failure that used to propagate. The transcript turn
 * was already durable by the time guidance was generated, so a throw lost the
 * confirmation that the turn was recorded *and* broke a Live session for
 * somebody in the middle of an interview. It is now a successful append with
 * `guidanceUnavailable`, which the engine renders differently from "that was
 * not a question" -- the two look identical otherwise, and a candidate would
 * read the silence as Odesseus having stopped listening.
 *
 * The second is four routes that returned the thrown message to the caller. That
 * message is whatever the model, the database or the provider said last, so it
 * carries a PostgREST code or a constraint name as readily as anything useful.
 */

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));

const USER = "51111111-1111-4111-8111-111111111111";
const SESSION = "52222222-2222-4222-8222-222222222222";

/** A service client whose `live_transcript_items` reads and writes work. */
function serviceWithTranscript(inserted: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.order = () => chain;
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.single = async () => ({ data: inserted, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  return {
    auth: { getClaims: async () => ({ data: { claims: null } }) },
    from: () => chain,
  };
}

describe("a provider failure does not break a live transcript turn", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it("records the turn and reports guidanceUnavailable instead of throwing", async () => {
    // The provider rejects, the way it does with a bad key or an outage.
    vi.doMock("@/lib/ai/live-guidance", () => ({
      generateLiveGuidance: async () => {
        const error = new Error("Incorrect API key provided: ''.");
        error.name = "AI_APICallError";
        throw error;
      },
    }));

    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
    });
    serviceClientMock.mockReturnValue(
      serviceWithTranscript({ id: "item-1", is_question: false, question_text: null })
    );

    const { appendTranscriptItem } = await import("@/lib/live/transcript");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await appendTranscriptItem(
      // The service client type is structural; the fake satisfies what is used.
      serviceClientMock() as never,
      {
        session: {
          id: SESSION,
          status: "active",
          context_snapshot: {},
          activated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        userId: USER,
        turn: {
          sessionId: SESSION,
          itemId: "item-1",
          transcript: "Can you walk me through that decision?",
          mode: "default",
          forceGuidance: false,
        },
      }
    );
    consoleError.mockRestore();

    // Reported as a successful append, because the turn *was* appended.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.guidanceUnavailable).toBe(true);
    expect(result.body.guidance).toBeNull();
    // And it is distinguishable from an ordinary non-question, which also
    // leaves guidance null but does not set the flag.
    expect(result.body.isQuestion).toBe(false);

    vi.doUnmock("@/lib/ai/live-guidance");
  });
});

describe("interview and Live failure responses carry no internal text", () => {
  const CASES = [
    {
      name: "round memory",
      route: "@/app/api/interviews/[id]/memory/route",
      expected: "Odesseus could not save round memory.",
    },
    {
      name: "post-interview analysis",
      route: "@/app/api/interviews/[id]/post-analysis/route",
      expected: "Odesseus could not analyze this interview.",
    },
    {
      name: "interview readiness",
      route: "@/app/api/interviews/[id]/readiness/route",
      expected: "Odesseus could not prepare this interview.",
    },
    {
      name: "guest post-analysis",
      route: "@/app/api/live/guest-access/[token]/session/post-analysis/route",
      expected: "Odesseus could not analyze this guest session.",
    },
  ] as const;

  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it.each(CASES)(
    "$name returns its own sentence, never a database or provider message",
    async ({ route, expected }) => {
      const files = await import("node:fs/promises");
      const path = await import("node:path");
      const repoRoot = path.resolve(process.cwd());
      const source = await files.readFile(
        path.join(repoRoot, route.replace("@/", "src/").replace("/route", "/route.ts")),
        "utf8"
      );

      // The thrown message must not reach the response. Asserted on the source
      // because the routes' own failure paths are guarded upstream, and driving
      // each one to a real provider error would be testing the provider.
      const catchBlock = source.slice(source.lastIndexOf("} catch (error) {"));
      expect(catchBlock).toContain("console.error(");
      expect(catchBlock).toContain(expected);
      expect(catchBlock).not.toMatch(/error:\s*error\s+instanceof\s+Error/);
      expect(catchBlock).not.toMatch(/error:\s*error\.message/);
    }
  );
});

describe("the workspace 404 is a 404, and carries no internal message", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it("answers 404 for an interview that is not the caller's, not 500", async () => {
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
    });
    // `buildInterviewContext` finds nothing for this caller and throws the typed
    // not-found. It used to be a plain Error, so the route's catch-all reported
    // it as a 500 carrying the message -- an internal detail, and the wrong
    // answer for what is an ordinary outcome of asking about someone else's
    // interview.
    serviceClientMock.mockReturnValue({
      auth: { getClaims: async () => ({ data: { claims: null } }) },
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/interviews/[id]/workspace/route");
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-00000000dead" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Interview not found.");
  });
});
