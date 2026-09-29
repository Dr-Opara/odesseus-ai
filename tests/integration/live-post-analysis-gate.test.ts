import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const generatePostInterviewAnalysisMock = vi.fn();
const generateRoundHandoffMock = vi.fn();
const mergeRoundMemoryMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/ai/post-interview", () => ({
  generatePostInterviewAnalysis: (...args: unknown[]) =>
    generatePostInterviewAnalysisMock(...args),
}));
vi.mock("@/lib/ai/round-handoff", () => ({
  generateRoundHandoff: (...args: unknown[]) => generateRoundHandoffMock(...args),
}));
vi.mock("@/lib/interviews/round-memory-merge", () => ({
  mergeRoundMemory: (...args: unknown[]) => mergeRoundMemoryMock(...args),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/interviews/iv-1/post-analysis", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "iv-1" }) };
const sessionId = "11111111-1111-4111-8111-111111111111";

const interviewRow = {
  id: "iv-1",
  application_id: "app-1",
  round_number: 1,
  stage: "final",
  interviewer_details: null,
  applications: {
    id: "app-1",
    company_name: "Acme",
    role_title: "Engineer",
    job_snapshot: {},
    resume_snapshot: {},
  },
};

function serviceWithSessionStatus(status: string | null) {
  return fakeAuthedClient({
    userId: "service",
    from: fromRouter({
      interviews: interviewRow,
      live_interview_sessions: status ? { id: sessionId, status } : null,
      live_transcript_items: [{ transcript: "Tell me about yourself.", is_question: true, question_text: "Tell me about yourself.", occurred_at: "2026-01-01T00:00:00Z" }],
      live_guidance: [],
      interview_round_memory: [],
      post_interview_analyses: { id: "analysis-1" },
      follow_up_drafts: { id: "followup-1" },
    }),
  });
}

describe("POST /api/interviews/[id]/post-analysis (2N status gate)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    generatePostInterviewAnalysisMock.mockReset();
    generateRoundHandoffMock.mockReset();
    mergeRoundMemoryMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
    generatePostInterviewAnalysisMock.mockResolvedValue({
      questionsAsked: ["Tell me about yourself."],
      topicsDiscussed: ["background"],
      experiencesReferenced: ["Acme work"],
      commitments: [],
      followUpDraft: { subject: "Thank you", body: "Thanks for your time." },
    });
    generateRoundHandoffMock.mockResolvedValue({
      summary: "handoff",
      buildOn: [],
      avoidRepeating: [],
      openThreads: [],
      nextRoundFocus: [],
    });
    mergeRoundMemoryMock.mockReturnValue({
      round_number: 1,
      questions_asked: [],
      topics_discussed: [],
      experiences_used: [],
      interviewer_signals: [],
      commitments: [],
      candidate_notes: null,
    });
  });

  it("accepts the authoritative completed state written by odesseus_complete_live_session", async () => {
    createServiceClientMock.mockReturnValue(serviceWithSessionStatus("completed"));

    const { POST } = await import("@/app/api/interviews/[id]/post-analysis/route");
    const response = await POST(jsonRequest({}), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(generatePostInterviewAnalysisMock).toHaveBeenCalledTimes(1);
  });

  it("still accepts the legacy ended state", async () => {
    createServiceClientMock.mockReturnValue(serviceWithSessionStatus("ended"));

    const { POST } = await import("@/app/api/interviews/[id]/post-analysis/route");
    const response = await POST(jsonRequest({}), params);

    expect(response.status).toBe(200);
    expect(generatePostInterviewAnalysisMock).toHaveBeenCalledTimes(1);
  });

  it("rejects analysis while the session is still active", async () => {
    createServiceClientMock.mockReturnValue(serviceWithSessionStatus("active"));

    const { POST } = await import("@/app/api/interviews/[id]/post-analysis/route");
    const response = await POST(jsonRequest({}), params);

    expect(response.status).toBe(409);
    expect(generatePostInterviewAnalysisMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the interview belongs to another user", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import("@/app/api/interviews/[id]/post-analysis/route");
    const response = await POST(jsonRequest({}), params);

    expect(response.status).toBe(404);
    expect(generatePostInterviewAnalysisMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/interviews/[id]/live/recover (2N reconnect)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  function recoverRequest() {
    return new Request("http://localhost/api/interviews/iv-1/live/recover", {
      method: "POST",
      body: JSON.stringify({ sessionId, openaiSessionId: "sess_reconnect1" }),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("returns 404 for a session that does not belong to this user", async () => {
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/recover/route");
    const response = await POST(recoverRequest(), params);
    expect(response.status).toBe(404);
  });

  it("reconnects through the recover RPC without touching entitlement balances", async () => {
    const fromSpy = vi.fn(() => fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "recovering", activated_at: "2026-01-01T00:00:00Z" }));
    const rpc = vi.fn(async () => ({
      data: [{ session: { id: sessionId, status: "active" }, recovered: true }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy, rpc })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/recover/route");
    const response = await POST(recoverRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recovered).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_recover_live_session",
      expect.objectContaining({ p_session_id: sessionId, p_user_id: "user-1" })
    );
    expect(fromSpy).not.toHaveBeenCalledWith("credit_balances");
    expect(fromSpy).not.toHaveBeenCalledWith("credit_transactions");
  });
});
