import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/ai/live-guidance", () => ({
  generateLiveGuidance: vi.fn(async () => ({
    isQuestion: false,
    questionText: null,
    responseText: null,
    structure: null,
    verifiedEvidence: [],
    caution: null,
  })),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/interviews/iv-1/live/transcript", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "iv-1" }) };
const sessionId = "11111111-1111-4111-8111-111111111111";
const activatedAt = "2026-01-01T00:00:00.000Z";

describe("POST /api/interviews/[id]/live/transcript — turn-index-derived ordering", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  it("derives occurred_at from activated_at + turnIndex, not insert-time now(), so a late-arriving early turn still sorts first", async () => {
    const itemsBuilder = fakeQueryResult(null);
    // First .from("live_transcript_items").select(...).eq(...).eq(...).maybeSingle()
    // call (the "does this item already exist" check) must resolve to null.
    itemsBuilder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    itemsBuilder.insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "row-1" }, error: null }),
      }),
    }));

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "live_interview_sessions") {
          return fakeQueryResult({
            id: sessionId,
            status: "active",
            context_snapshot: {},
            activated_at: activatedAt,
            created_at: activatedAt,
          });
        }
        // Owner-side guest guard: a genuine candidate interview passes.
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", source: "manual" });
        if (table === "live_transcript_items") return itemsBuilder;
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/transcript/route");
    const response = await POST(
      jsonRequest({
        sessionId,
        itemId: "item-early",
        transcript: "This was spoken first but its completion event arrived second.",
        turnIndex: 0,
      }),
      params
    );

    expect(response.status).toBe(200);
    expect(itemsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        occurred_at: new Date(new Date(activatedAt).getTime() + 0).toISOString(),
      })
    );
  });

  it("gives a later turnIndex a later derived occurred_at, preserving speaking order regardless of request arrival order", async () => {
    const itemsBuilder = fakeQueryResult(null);
    itemsBuilder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    itemsBuilder.insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "row-2" }, error: null }),
      }),
    }));

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "live_interview_sessions") {
          return fakeQueryResult({
            id: sessionId,
            status: "active",
            context_snapshot: {},
            activated_at: activatedAt,
            created_at: activatedAt,
          });
        }
        // Owner-side guest guard: a genuine candidate interview passes.
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", source: "manual" });
        if (table === "live_transcript_items") return itemsBuilder;
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/transcript/route");
    await POST(
      jsonRequest({
        sessionId,
        itemId: "item-late",
        transcript: "This was spoken second, even though its completion arrived first.",
        turnIndex: 5,
      }),
      params
    );

    const insertSpy = itemsBuilder.insert as ReturnType<typeof vi.fn>;
    const insertedAt = insertSpy.mock.calls[0][0].occurred_at;
    const earlyAt = new Date(new Date(activatedAt).getTime() + 0).toISOString();
    expect(new Date(insertedAt).getTime()).toBeGreaterThan(new Date(earlyAt).getTime());
  });
});
