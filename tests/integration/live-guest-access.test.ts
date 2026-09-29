import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const readLiveEntitlementMock = vi.fn();
const generateLiveGuidanceMock = vi.fn();
const generatePostInterviewAnalysisMock = vi.fn();
const parseResumeMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/billing/live-entitlement", () => ({
  readLiveEntitlement: (...args: unknown[]) => readLiveEntitlementMock(...args),
}));
vi.mock("@/lib/ai/live-guidance", () => ({
  generateLiveGuidance: (...args: unknown[]) => generateLiveGuidanceMock(...args),
  isCodingInterviewRequest: () => false,
  LIVE_CODING_UNSUPPORTED_MESSAGE: "unsupported",
}));
vi.mock("@/lib/ai/post-interview", () => ({
  generatePostInterviewAnalysis: (...args: unknown[]) =>
    generatePostInterviewAnalysisMock(...args),
}));
vi.mock("@/lib/ai/resume", () => ({
  parseResume: (...args: unknown[]) => parseResumeMock(...args),
}));

// A fixed 256-bit link token shared by every guest test in this file.
const TOKEN = "ab".repeat(32);
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");

const SHARE_OWNER_ROW = {
  has_access: true,
  source: "membership",
  plan: "share_annual",
  sessions_remaining: 20,
  period_end: null,
  is_owner: true,
  is_guest: false,
  membership_id: "mem-1",
  guest_limit: 10,
  activated_guest_count: 0,
};

const MONTHLY_ROW = { ...SHARE_OWNER_ROW, plan: "monthly", is_owner: false };

function guestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    owner_user_id: "user-owner",
    token_sha256: TOKEN_HASH,
    guest_name: "Guest User",
    guest_company: "Acme",
    guest_role_title: "Engineer",
    guest_job_description: "Build things.",
    guest_resume_text: null,
    guest_resume_storage_path: null,
    guest_resume_profile: null,
    guest_interview_type: "behavioral",
    guest_round: "1",
    guest_notes: "First round.",
    interview_id: null,
    live_session_id: null,
    status: "pending",
    activated_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const tokenParams = { params: Promise.resolve({ token: TOKEN }) };

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/live/guest-links (owner link creation)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-owner" }));
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  });

  it("rejects unauthenticated callers", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));

    const { POST } = await import("@/app/api/live/guest-links/route");
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("rejects non-Share-Annual holders", async () => {
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: MONTHLY_ROW });
    createServiceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import("@/app/api/live/guest-links/route");
    const response = await POST();
    expect(response.status).toBe(403);
  });

  it("fails closed when entitlement cannot be checked", async () => {
    readLiveEntitlementMock.mockResolvedValue({
      ok: false,
      row: { ...SHARE_OWNER_ROW, has_access: false, source: "none" },
      reason: "rpc_error",
    });
    createServiceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import("@/app/api/live/guest-links/route");
    const response = await POST();
    expect(response.status).toBe(500);
  });

  it("returns a high-entropy token once and stores only its hash", async () => {
    const insertSpy = vi.fn((..._args: unknown[]) => fakeQueryResult({ id: "rec-1" }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) =>
          table === "guest_access_records"
            ? { ...fakeQueryResult({ id: "rec-1" }), insert: insertSpy }
            : fakeQueryResult(null),
      })
    );

    const { POST } = await import("@/app/api/live/guest-links/route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const inserted = insertSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(inserted.owner_user_id).toBe("user-owner");
    expect(inserted.token_sha256).toBe(
      createHash("sha256").update(body.token as string, "utf8").digest("hex")
    );
    // The raw token appears nowhere in what is persisted.
    expect(JSON.stringify(inserted)).not.toContain(body.token);
    expect(inserted).not.toHaveProperty("token");
  });
});

describe("GET /api/live/guest-access/[token] (link validation)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  });

  it("rejects random tokens without leaking a reason", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { GET } = await import("@/app/api/live/guest-access/[token]/route");
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ token: "ff".repeat(32) }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("This guest link is not valid.");
  });

  it("rejects malformed tokens before touching applicant tables", async () => {
    const fromSpy = vi.fn(() => fakeQueryResult(null));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy })
    );

    const { GET } = await import("@/app/api/live/guest-access/[token]/route");
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ token: "not-a-token" }),
    });

    expect(response.status).toBe(404);
    expect(fromSpy).not.toHaveBeenCalledWith("guest_access_records");
  });

  it("validates a good link and returns only guest state, never applicant data", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({ guest_access_records: guestRecord() }),
      })
    );

    const { GET } = await import("@/app/api/live/guest-access/[token]/route");
    const response = await GET(new Request("http://localhost/x"), tokenParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.status).toBe("pending");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("user-owner");
    expect(serialized).not.toContain("applications");
    expect(serialized).not.toContain("resume");
    expect(serialized).not.toContain("wallet");
  });

  it("suspends the link when the owner's Share access lapses", async () => {
    readLiveEntitlementMock.mockResolvedValue({
      ok: true,
      row: { ...SHARE_OWNER_ROW, has_access: false, source: "none" },
    });
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({ guest_access_records: guestRecord() }),
      })
    );

    const { GET } = await import("@/app/api/live/guest-access/[token]/route");
    const response = await GET(new Request("http://localhost/x"), tokenParams);
    expect(response.status).toBe(403);
  });
});

describe("POST /api/live/guest-access/[token]/setup (guest setup)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  });

  const setupBody = {
    name: "Guest User",
    company: "Acme",
    roleTitle: "Engineer",
    jobDescription: "Build things.",
    resumeText: null,
    interviewType: "behavioral",
    round: "1",
    notes: null,
  };

  it("persists guest fields without touching applicant tables", async () => {
    const fromSpy = vi.fn((table: string) =>
      table === "guest_access_records"
        ? fakeQueryResult(guestRecord())
        : fakeQueryResult(null)
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/setup/route");
    const response = await POST(
      jsonRequest("http://localhost/setup", setupBody),
      tokenParams
    );

    expect(response.status).toBe(200);
    for (const table of [
      "profiles",
      "applications",
      "resumes",
      "application_runs",
      "credit_balances",
      "credit_transactions",
      "billing_events",
      "interviews",
    ]) {
      expect(fromSpy).not.toHaveBeenCalledWith(table);
    }
  });

  it("rejects invalid setup payloads", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({ guest_access_records: guestRecord() }),
      })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/setup/route");
    const response = await POST(
      jsonRequest("http://localhost/setup", { name: "", company: "Acme" }),
      tokenParams
    );
    expect(response.status).toBe(400);
  });

  it("locks setup once the session has started", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          guest_access_records: guestRecord({
            status: "active",
            live_session_id: "11111111-1111-4111-8111-111111111111",
          }),
        }),
      })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/setup/route");
    const response = await POST(
      jsonRequest("http://localhost/setup", setupBody),
      tokenParams
    );
    expect(response.status).toBe(409);
  });
});

describe("POST /api/live/guest-access/[token]/session (guest session start)", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const interviewId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  });

  it("refuses to start before setup is complete", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({ guest_access_records: guestRecord({ guest_name: null }) }),
      })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/session/route");
    const response = await POST(
      jsonRequest("http://localhost/session", {}),
      tokenParams
    );
    expect(response.status).toBe(400);
  });

  it("creates a guest-marked interview and session through the existing RPC, touching no billing tables", async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === "guest_access_records") return fakeQueryResult(guestRecord());
      if (table === "interviews") {
        return {
          ...fakeQueryResult({ id: interviewId, status: "scheduled", interview_type: null }),
          insert: vi.fn(() => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: interviewId, status: "scheduled", interview_type: null },
                  error: null,
                }),
            }),
          })),
        };
      }
      return fakeQueryResult(null);
    });
    const rpc = vi.fn(async () => ({
      data: [{ session_id: sessionId, status: "ready", entitlement_type: "membership", passes_before: 20, passes_after: 20, unlimited_until: null }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy, rpc })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/session/route");
    const response = await POST(
      jsonRequest("http://localhost/session", {}),
      tokenParams
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe(sessionId);
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_create_live_session",
      expect.objectContaining({ p_user_id: "user-owner", p_interview_id: interviewId })
    );
    for (const table of [
      "credit_balances",
      "credit_transactions",
      "billing_events",
      "profiles",
      "applications",
      "resumes",
    ]) {
      expect(fromSpy).not.toHaveBeenCalledWith(table);
    }
  });

  it("is idempotent: a started link returns its session without new rows", async () => {
    const rpc = vi.fn();
    const insertSpy = vi.fn();
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "guest_access_records") {
            return fakeQueryResult(
              guestRecord({ status: "active", interview_id: interviewId, live_session_id: sessionId })
            );
          }
          if (table === "live_interview_sessions") {
            return fakeQueryResult({ id: sessionId, status: "ready", activated_at: null, ended_at: null });
          }
          if (table === "interviews") return { ...fakeQueryResult(null), insert: insertSpy };
          return fakeQueryResult(null);
        },
        rpc,
      })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/session/route");
    const response = await POST(
      jsonRequest("http://localhost/session", {}),
      tokenParams
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe(sessionId);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("guest isolation (2O)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    readLiveEntitlementMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-owner" }));
    readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  });

  it("a guest token that resolves to nothing cannot reach any session", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import(
      "@/app/api/live/guest-access/[token]/session/transcript/route"
    );
    const response = await POST(
      jsonRequest("http://localhost/t", {
        itemId: "item-1",
        transcript: "Tell me about yourself.",
      }),
      tokenParams
    );
    expect(response.status).toBe(404);
  });

  it("the owner's activate endpoint rejects a guest-linked session", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "live_interview_sessions") {
            return fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "ready" });
          }
          if (table === "interviews") {
            return fakeQueryResult({ id: "iv-1", source: "guest_share_link" });
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(
      jsonRequest("http://localhost/a", { sessionId, openaiSessionId: "sess_abc123" }),
      { params: Promise.resolve({ id: "iv-1" }) }
    );
    expect(response.status).toBe(404);
  });

  it("the owner's transcript endpoint rejects a guest-linked session", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "live_interview_sessions") {
            return fakeQueryResult({ id: sessionId, status: "active" });
          }
          if (table === "interviews") {
            return fakeQueryResult({ source: "guest_share_link" });
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/transcript/route");
    const response = await POST(
      jsonRequest("http://localhost/t", { sessionId, itemId: "item-1", transcript: "Hello." }),
      { params: Promise.resolve({ id: "iv-1" }) }
    );
    expect(response.status).toBe(404);
  });
});
