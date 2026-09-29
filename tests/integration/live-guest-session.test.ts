import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

const TOKEN = "cd".repeat(32);
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

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const INTERVIEW_ID = "22222222-2222-4222-8222-222222222222";

function activeRecord() {
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
    guest_notes: null,
    interview_id: INTERVIEW_ID,
    live_session_id: SESSION_ID,
    status: "active",
    activated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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

beforeEach(() => {
  createClientMock.mockReset();
  createServiceClientMock.mockReset();
  readLiveEntitlementMock.mockReset();
  generateLiveGuidanceMock.mockReset();
  generatePostInterviewAnalysisMock.mockReset();
  parseResumeMock.mockReset();
  readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
  generateLiveGuidanceMock.mockResolvedValue({
    isQuestion: false,
    questionText: null,
    responseText: null,
    structure: null,
    verifiedEvidence: [],
    caution: null,
  });
});

describe("POST guest resume upload (2O)", () => {
  it("stores the file under a guest-scoped path and never in the Resume Hub", async () => {
    const uploadSpy = vi.fn(async () => ({ data: { path: "guests/x/resume.pdf" }, error: null }));
    const fromSpy = vi.fn((table: string) => {
      if (table === "guest_access_records") {
        return fakeQueryResult({ ...activeRecord(), status: "pending", live_session_id: null });
      }
      return fakeQueryResult(null);
    });
    parseResumeMock.mockResolvedValue({ full_name: "Guest User", skills: [] });
    createServiceClientMock.mockReturnValue({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: "user-owner" } } }),
      },
      from: fromSpy,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      storage: {
        from: vi.fn(() => ({ upload: uploadSpy })),
      },
    });

    const form = new FormData();
    form.append("resume", new File(["%PDF-fake"], "resume.pdf", { type: "application/pdf" }));
    const request = new Request("http://localhost/resume", { method: "POST", body: form });

    const { POST } = await import("@/app/api/live/guest-access/[token]/resume/route");
    const response = await POST(request, tokenParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, parsed: true });
    expect(uploadSpy).toHaveBeenCalledOnce();
    const [path] = uploadSpy.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(path.startsWith("guests/")).toBe(true);
    expect(path).toContain("33333333-3333-4333-8333-333333333333");
    expect(fromSpy).not.toHaveBeenCalledWith("resumes");
    expect(parseResumeMock).toHaveBeenCalledOnce();
  });

  it("rejects non-resume uploads", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          guest_access_records: { ...activeRecord(), status: "pending", live_session_id: null },
        }),
      })
    );

    const form = new FormData();
    form.append("resume", new File(["evil"], "run.exe", { type: "application/x-msdownload" }));
    const request = new Request("http://localhost/resume", { method: "POST", body: form });

    const { POST } = await import("@/app/api/live/guest-access/[token]/resume/route");
    const response = await POST(request, tokenParams);
    expect(response.status).toBe(400);
    expect(parseResumeMock).not.toHaveBeenCalled();
  });
});

describe("POST guest session activate (2O)", () => {
  it("activates through the existing RPC with the owner's id", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ session: { id: SESSION_ID, status: "active" }, entitlement_consumed: false }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({ guest_access_records: activeRecord() }),
        rpc,
      })
    );

    const { POST } = await import(
      "@/app/api/live/guest-access/[token]/session/activate/route"
    );
    const response = await POST(
      jsonRequest("http://localhost/activate", { openaiSessionId: "sess_xyz789" }),
      tokenParams
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_activate_live_session_v2",
      expect.objectContaining({ p_session_id: SESSION_ID, p_user_id: "user-owner" })
    );
  });
});

describe("POST guest session webrtc (2O)", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  });

  it("mints through the shared minter without exposing the owner id", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "sdp-answer",
      headers: new Headers({ "openai-session-id": "realtime-1" }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          guest_access_records: activeRecord(),
          live_interview_sessions: {
            id: SESSION_ID,
            status: "active",
            context_snapshot: { application: { companyName: "Acme", roleTitle: "Engineer" } },
          },
        }),
      })
    );

    const { POST } = await import(
      "@/app/api/live/guest-access/[token]/session/webrtc/route"
    );
    const response = await POST(
      jsonRequest("http://localhost/webrtc", { sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1" }),
      tokenParams
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.sdp).toBe("sdp-answer");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("POST guest session end (2O)", () => {
  it("completes idempotently and marks the record completed", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: SESSION_ID, status: "completed" },
      error: null,
    }));
    const updateSpy = vi.fn(() => fakeQueryResult({ id: activeRecord().id }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) =>
          table === "guest_access_records"
            ? { ...fakeQueryResult(activeRecord()), update: updateSpy }
            : fakeQueryResult(null),
        rpc,
      })
    );

    const { POST } = await import("@/app/api/live/guest-access/[token]/session/end/route");
    const response = await POST(jsonRequest("http://localhost/end", {}), tokenParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_complete_live_session",
      expect.objectContaining({ p_session_id: SESSION_ID, p_user_id: "user-owner" })
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });
});

describe("POST guest post-analysis (2O)", () => {
  beforeEach(() => {
    generatePostInterviewAnalysisMock.mockResolvedValue({
      questionsAsked: ["Tell me about yourself."],
      topicsDiscussed: ["background"],
      experiencesReferenced: [],
      commitments: [],
      followUpDraft: { subject: "Thank you", body: "Thanks." },
    });
  });

  it("reuses the analysis generator with guest-only context", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          guest_access_records: activeRecord(),
          live_interview_sessions: { id: SESSION_ID, status: "completed" },
          live_transcript_items: [
            { transcript: "Hi.", is_question: false, question_text: null, occurred_at: "2026-01-01T00:00:00Z" },
          ],
          live_guidance: [],
          post_interview_analyses: { id: "analysis-9", version_number: 0 },
          follow_up_drafts: { id: "followup-9" },
        }),
      })
    );

    const { POST } = await import(
      "@/app/api/live/guest-access/[token]/session/post-analysis/route"
    );
    const response = await POST(jsonRequest("http://localhost/pa", {}), tokenParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(generatePostInterviewAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: "Acme", roleTitle: "Engineer" })
    );
  });

  it("refuses analysis while the guest session is still active", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: fromRouter({
          guest_access_records: activeRecord(),
          live_interview_sessions: { id: SESSION_ID, status: "active" },
          live_transcript_items: [],
          live_guidance: [],
          post_interview_analyses: null,
        }),
      })
    );

    const { POST } = await import(
      "@/app/api/live/guest-access/[token]/session/post-analysis/route"
    );
    const response = await POST(jsonRequest("http://localhost/pa", {}), tokenParams);

    expect(response.status).toBe(409);
    expect(generatePostInterviewAnalysisMock).not.toHaveBeenCalled();
  });
});
