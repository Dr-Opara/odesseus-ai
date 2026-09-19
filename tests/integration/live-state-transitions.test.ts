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
vi.mock("@/lib/live/context", () => ({
  buildLiveContext: vi.fn(async () => ({ readiness: null, application: null })),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/interviews/iv-1/live", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "iv-1" }) };
const sessionId = "11111111-1111-4111-8111-111111111111";

describe("POST /api/interviews/[id]/live/prepare", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  it("refuses to prepare a new session when the user has zero interview passes", async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        if (table === "credit_balances") return fakeQueryResult({ interview_passes: 0 });
        if (table === "live_interview_sessions") return fakeQueryResult(null);
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    expect(response.status).toBe(402);
  });

  it("creates a new prepared session (unactivated, not yet charged) when a pass is available", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: sessionId, status: "prepared" }, error: null }),
      }),
    }));

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        if (table === "credit_balances") return fakeQueryResult({ interview_passes: 1 });
        if (table === "live_interview_sessions") return { ...fakeQueryResult(null), insert: insertSpy };
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sessionId, status: "prepared", alreadyCharged: false });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "prepared", interview_id: "iv-1" })
    );
  });

  it("reconnects to an already-active session without re-preparing or implying a new charge", async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        if (table === "credit_balances") return fakeQueryResult({ interview_passes: 0 });
        if (table === "live_interview_sessions") {
          return fakeQueryResult({
            id: sessionId,
            status: "active",
            context_snapshot: { some: "context" },
            consented_at: "2026-01-01T00:00:00Z",
          });
        }
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sessionId, status: "active", alreadyCharged: true });
  });

  it("refuses to restart a session that has already ended", async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        if (table === "live_interview_sessions") return fakeQueryResult({ id: sessionId, status: "ended" });
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    expect(response.status).toBe(409);
  });
});

describe("POST /api/interviews/[id]/live/activate", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  const activateBody = { sessionId, openaiSessionId: "sess_abc123" };

  it("returns 404 when the session does not belong to this interview/user", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(jsonRequest(activateBody), params);
    expect(response.status).toBe(404);
  });

  it("activates via the RPC and returns the activated session", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: sessionId, status: "active" },
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: () => fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "prepared" }),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(jsonRequest(activateBody), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.status).toBe("active");
    expect(rpc).toHaveBeenCalledWith(
      "odysseus_activate_live_session",
      expect.objectContaining({ p_session_id: sessionId, p_user_id: "user-1" })
    );
  });

  it("surfaces an insufficient-passes RPC error as 402, not a generic 500", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "insufficient interview passes" },
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: () => fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "prepared" }),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(jsonRequest(activateBody), params);
    expect(response.status).toBe(402);
  });
});

describe("POST /api/interviews/[id]/live/end", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  it("returns 404 for a session that does not belong to this user", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/end/route");
    const response = await POST(jsonRequest({ sessionId }), params);
    expect(response.status).toBe(404);
  });

  it("ends the session via the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { id: sessionId, status: "ended" }, error: null }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: () => fakeQueryResult({ id: sessionId, interview_id: "iv-1" }),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/end/route");
    const response = await POST(jsonRequest({ sessionId }), params);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "odysseus_end_live_session",
      expect.objectContaining({ p_session_id: sessionId, p_user_id: "user-1" })
    );
  });
});
