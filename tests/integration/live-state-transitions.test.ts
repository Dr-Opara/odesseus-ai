import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const readLiveEntitlementMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/live/context", () => ({
  buildLiveContext: vi.fn(async () => ({ readiness: null, application: null })),
}));
vi.mock("@/lib/billing/live-entitlement", () => ({
  readLiveEntitlement: (...args: unknown[]) => readLiveEntitlementMock(...args),
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

const entitledRow = {
  has_access: true,
  source: "membership",
  plan: "monthly",
  sessions_remaining: 20,
  period_end: null,
  is_owner: true,
  is_guest: false,
  membership_id: "mem-1",
  guest_limit: 0,
  activated_guest_count: 0,
};

describe("POST /api/interviews/[id]/live/prepare", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: entitledRow });
  });

  it("fails closed with 500 when the entitlement check cannot be performed", async () => {
    readLiveEntitlementMock.mockResolvedValue({
      ok: false,
      row: { ...entitledRow, has_access: false, source: "none" },
      reason: "rpc_error",
    });
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    expect(response.status).toBe(500);
    expect(readLiveEntitlementMock).toHaveBeenCalledWith("user-1");
  });

  it("refuses a manual interview with no linked application context", async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: null });
        return fakeQueryResult(null);
      }),
    });

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    expect(response.status).toBe(404);
  });

  it("returns 402 when the authoritative RPC reports payment_required", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ session_id: sessionId, status: "payment_required", entitlement_type: "none", passes_before: 0, passes_after: 0, unlimited_until: null }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          interviews: { id: "iv-1", application_id: "app-1" },
          live_interview_sessions: null,
        }),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    expect(response.status).toBe(402);
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_create_live_session",
      expect.objectContaining({ p_user_id: "user-1", p_interview_id: "iv-1" })
    );
  });

  it("creates a ready session through the authoritative RPC without reading credit_balances", async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
      if (table === "live_interview_sessions") return fakeQueryResult(null);
      return fakeQueryResult(null);
    });
    const rpc = vi.fn(async () => ({
      data: [{ session_id: sessionId, status: "ready", entitlement_type: "membership", passes_before: 20, passes_after: 20, unlimited_until: null }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy, rpc })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(jsonRequest({ captureMode: "microphone", consent: true }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sessionId, status: "ready", alreadyCharged: false });
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_create_live_session",
      expect.objectContaining({
        p_user_id: "user-1",
        p_interview_id: "iv-1",
        p_capture_mode: "microphone",
      })
    );
    // The authoritative path never re-derives access from credit_balances.
    expect(fromSpy).not.toHaveBeenCalledWith("credit_balances");
  });

  it("reuses an already-active session without implying a new charge", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ session_id: sessionId, status: "active", entitlement_type: "membership", passes_before: 20, passes_after: 20, unlimited_until: null }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          interviews: { id: "iv-1", application_id: "app-1" },
          live_interview_sessions: {
            id: sessionId,
            status: "active",
            context_snapshot: { some: "context" },
            consented_at: "2026-01-01T00:00:00Z",
          },
        }),
        rpc,
      })
    );

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

  it("refuses to restart a completed session", async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "interviews") return fakeQueryResult({ id: "iv-1", application_id: "app-1" });
        if (table === "live_interview_sessions") return fakeQueryResult({ id: sessionId, status: "completed" });
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
      data: [{ session: { id: sessionId, status: "active" }, entitlement_consumed: true, entitlement_type: "passes", passes_remaining: 0 }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: () => fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "ready" }),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(jsonRequest(activateBody), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.status).toBe("active");
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_activate_live_session_v2",
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
        from: () => fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "ready" }),
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
    const rpc = vi.fn(async () => ({ data: { id: sessionId, status: "completed" }, error: null }));
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
      "odesseus_complete_live_session",
      expect.objectContaining({ p_session_id: sessionId, p_user_id: "user-1" })
    );
  });
});
