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

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/interviews/iv-1/live/activate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "iv-1" }) };
const sessionId = "11111111-1111-4111-8111-111111111111";
const activateBody = { sessionId, openaiSessionId: "sess_abc123" };

describe("duplicate credit prevention on Live activation", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: "user-1" }));
  });

  it("never writes directly to credit_transactions/credit_balances from the route — all credit consumption is delegated to the atomic RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: sessionId, status: "active" },
      error: null,
    }));
    const fromSpy = vi.fn((table: string) =>
      fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "prepared" })
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy, rpc })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    await POST(jsonRequest(activateBody), params);

    const touchedTables = fromSpy.mock.calls.map((call) => call[0]);
    expect(touchedTables).not.toContain("credit_transactions");
    expect(touchedTables).not.toContain("credit_balances");
  });

  it("calling activate twice for an already-active session is safe: the RPC (which owns idempotency via ON CONFLICT DO NOTHING on external_reference) is invoked both times and its idempotent result is passed straight through, with no extra route-level side effects", async () => {
    // Mirrors odysseus_activate_live_session's real behavior: once a session
    // is already 'active', the RPC returns early with the same row instead
    // of inserting a second credit_transactions debit.
    const activeSession = { id: sessionId, status: "active", openai_session_id: "sess_abc123" };
    const rpc = vi.fn(async () => ({ data: activeSession, error: null }));
    const fromSpy = vi.fn((_table: string) =>
      fakeQueryResult({ id: sessionId, interview_id: "iv-1", status: "active" })
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", from: fromSpy, rpc })
    );

    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");

    const first = await POST(jsonRequest(activateBody), params);
    const second = await POST(jsonRequest(activateBody), params);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.session).toEqual(activeSession);
    expect(secondBody.session).toEqual(activeSession);

    const touchedTables = fromSpy.mock.calls.map((call) => call[0]);
    expect(touchedTables).not.toContain("credit_transactions");
  });
});
