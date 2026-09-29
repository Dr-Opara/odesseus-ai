import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

/**
 * The shared Live transcript + guidance core.
 *
 * Both the applicant route and the token-scoped guest route call this exact
 * function, so a behaviour proven here holds for both. That is the point of the
 * extraction, and these tests are written to be indifferent about which caller
 * is being simulated.
 *
 * The behaviour that matters most is the coding refusal. `generateLiveGuidance`
 * answers a coding request with no response text and a caution. This function
 * used to collapse that to `guidance: null`, which meant the deliberate refusal
 * was computed and then thrown away: the panel went blank and a guest asking a
 * coding question concluded the product was broken rather than being told that
 * Odesseus will not help.
 */

const generateLiveGuidanceMock = vi.fn();
const createServiceClientMock = vi.fn();

vi.mock("@/lib/ai/live-guidance", async () => {
  // The real detector: the rule is that this pattern set refuses, and a test
  // that mocked it would be asserting against a fiction.
  const actual = await vi.importActual<typeof import("@/lib/ai/live-guidance")>(
    "@/lib/ai/live-guidance"
  );
  return {
    ...actual,
    generateLiveGuidance: (...args: unknown[]) => generateLiveGuidanceMock(...args),
  };
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

const { appendTranscriptItem } = await import("@/lib/live/transcript");
const { isCodingInterviewRequest, LIVE_CODING_UNSUPPORTED_MESSAGE } = await import(
  "@/lib/ai/live-guidance"
);

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    status: "active",
    context_snapshot: { verifiedFacts: ["X"] },
    activated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    itemId: "item-1",
    transcript: "Tell me about an outage you owned.",
    mode: "default" as const,
    forceGuidance: false,
    turnIndex: 0,
    ...overrides,
  };
}

/** A service client whose writes all succeed, with a captured guidance insert. */
function service() {
  const guidanceInserts: Record<string, unknown>[] = [];
  const client = fakeAuthedClient({
    userId: "service",
    from: (table: string) => {
      // The successful path reads back the row it just wrote
      // (`savedGuidance || guidance`), so the fake must echo the insert or the
      // guidance the core returns has no content in it.
      let inserted: unknown = null;
      const builder = fakeQueryResult(table === "live_transcript_items" ? { id: 7 } : { id: 9 });
      const originalInsert = builder.insert as (v: unknown) => unknown;

      builder.insert = vi.fn((value: unknown) => {
        inserted = { id: 9, created_at: "2026-01-01T00:00:00Z", ...(value as object) };
        if (table === "live_guidance") guidanceInserts.push(value as Record<string, unknown>);
        return originalInsert(value);
      });
      builder.single = vi.fn(async () =>
        inserted ? { data: inserted, error: null } : { data: null, error: null }
      );

      return builder;
    },
  });
  // The fake implements the handful of methods the core uses; the parameter type
  // is the full client, which the fake deliberately is not.
  return { client: client as never, guidanceInserts };
}

async function append(sessionOverrides?: Record<string, unknown>, turnOverrides?: Record<string, unknown>) {
  const built = service();
  createServiceClientMock.mockReturnValue(built.client);
  const result = await appendTranscriptItem(built.client, {
    session: session(sessionOverrides),
    userId: "user-owner",
    turn: turn(turnOverrides),
  });
  return { result, ...built };
}

beforeEach(() => {
  generateLiveGuidanceMock.mockReset();
  createServiceClientMock.mockReset();
});

describe("appendTranscriptItem guards", () => {
  it("refuses a session that is not running", async () => {
    createServiceClientMock.mockReturnValue(service().client);
    for (const status of ["ready", "ending", "ended", "completed", "failed"]) {
      const { result } = await append({ status });
      expect(result.ok, status).toBe(false);
    }
  });

  it("accepts a prepared or active session", async () => {
    generateLiveGuidanceMock.mockResolvedValue({
      isQuestion: false,
      questionText: null,
      responseText: null,
      caution: null,
    });
    for (const status of ["prepared", "active"]) {
      const { result } = await append({ status });
      expect(result.ok, status).toBe(true);
    }
  });
});

describe("the coding guard", () => {
  it("recognises the coding asks it must refuse", () => {
    for (const ask of [
      "Can you write a function to reverse a linked list?",
      "Solve this LeetCode problem.",
      "What is the time complexity of this approach?",
      "We will do a take-home coding exercise.",
      "Explain this ```python\nprint(1)\n```",
      "Walk me through the binary search implementation.",
    ]) {
      expect(isCodingInterviewRequest(ask), ask).toBe(true);
    }
  });

  it("does not mistake an ordinary technical question for coding", () => {
    for (const ask of [
      "Tell me about an outage you owned.",
      "How would you design a rate limiter?",
      "What does idempotent mean?",
      "Describe your approach to testing.",
    ]) {
      expect(isCodingInterviewRequest(ask), ask).toBe(false);
    }
  });

  it("returns the refusal to the caller instead of silence", async () => {
    // The generator declines: no response text, but a caution naming the rule.
    generateLiveGuidanceMock.mockResolvedValue({
      isQuestion: true,
      questionText: "Can you write a function to reverse a linked list?",
      responseText: null,
      structure: null,
      verifiedEvidence: [],
      caution: LIVE_CODING_UNSUPPORTED_MESSAGE,
    });

    const { result, guidanceInserts } = await append(undefined, {
      transcript: "Can you write a function to reverse a linked list?",
    });
    expect(result.ok).toBe(true);
    const body = (result as { body: Record<string, unknown> }).body;
    const guidance = body.guidance as {
      response_text: string | null;
      caution: string;
      verified_evidence: string[];
    } | null;

    // The refusal survives. Blank guidance here is the bug this test exists for.
    expect(guidance).not.toBeNull();
    expect(guidance?.caution).toBe(LIVE_CODING_UNSUPPORTED_MESSAGE);
    // And it carries no answer of any kind.
    expect(guidance?.response_text).toBeNull();
    expect(guidance?.verified_evidence).toEqual([]);

    // Nothing is persisted as guidance: there was no answer to remember.
    expect(guidanceInserts).toHaveLength(0);
  });
});

describe("ordinary turns", () => {
  it("stores a question and returns its guidance", async () => {
    generateLiveGuidanceMock.mockResolvedValue({
      isQuestion: true,
      questionText: "Tell me about an outage you owned.",
      responseText: "You led the response for eight engineers.",
      structure: "Situation, Task, Action, Result",
      verifiedEvidence: ["Led engine reliability for 8 years"],
      caution: "Confirm the team size before saying it.",
    });

    const { result, guidanceInserts } = await append();

    expect(result.ok).toBe(true);
    const body = (result as { body: Record<string, unknown> }).body;
    expect(body.isQuestion).toBe(true);
    expect(body.questionText).toBe("Tell me about an outage you owned.");

    // The successful path returns the stored row, so the engine reads the same
    // snake_case shape here as it does for a refusal.
    const guidance = body.guidance as {
      response_text: string | null;
      caution: string;
      verified_evidence: string[];
    } | null;
    expect(guidance?.response_text).toContain("eight engineers");
    // The caution rides alongside a real answer.
    expect(guidance?.caution).toMatch(/team size/);
    expect(guidance?.verified_evidence).toHaveLength(1);
    expect(guidanceInserts).toHaveLength(1);
  });

  it("reports a non-question as no guidance", async () => {
    generateLiveGuidanceMock.mockResolvedValue({
      isQuestion: false,
      questionText: null,
      responseText: null,
      structure: null,
      verifiedEvidence: [],
      caution: null,
    });

    const { result } = await append();
    const body = (result as { body: Record<string, unknown> }).body;
    expect(body.isQuestion).toBe(false);
    expect(body.guidance).toBeNull();
  });

  it("returns no guidance for an unanswered question with nothing to say", async () => {
    generateLiveGuidanceMock.mockResolvedValue({
      isQuestion: true,
      questionText: "q",
      responseText: null,
      structure: null,
      verifiedEvidence: [],
      caution: null,
    });

    const { result } = await append();
    const body = (result as { body: Record<string, unknown> }).body;
    // A question with no answer and no caution genuinely has nothing to show.
    expect(body.guidance).toBeNull();
  });
});
