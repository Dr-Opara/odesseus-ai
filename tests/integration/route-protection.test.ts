import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient } from "../helpers/fake-supabase";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeAuthedClient({ userId: "service" }),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const unauthedParams = { params: Promise.resolve({ id: "any-id" }) };

describe("authenticated route protection", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
  });

  it("rejects an admin system readiness test with no session", async () => {
    const { POST } = await import("@/app/api/admin/system/test/route");
    const response = await POST(jsonRequest({ provider: "supabase" }));
    expect(response.status).toBe(401);
  });

  it("rejects an application status update with no session", async () => {
    const { POST } = await import("@/app/api/applications/[id]/status/route");
    const response = await POST(
      jsonRequest({ status: "applied" }),
      unauthedParams
    );
    expect(response.status).toBe(401);
  });

  it("rejects a follow-up draft edit with no session", async () => {
    const { POST } = await import("@/app/api/follow-ups/[id]/route");
    const response = await POST(
      jsonRequest({
        recipientEmail: null,
        recipientName: null,
        subject: "Thanks",
        body: "Thank you for the interview.",
      }),
      unauthedParams
    );
    expect(response.status).toBe(401);
  });

  it("rejects Live prepare with no session", async () => {
    const { POST } = await import("@/app/api/interviews/[id]/live/prepare/route");
    const response = await POST(
      jsonRequest({ captureMode: "microphone", consent: true }),
      unauthedParams
    );
    expect(response.status).toBe(401);
  });

  it("rejects Live activate with no session", async () => {
    const { POST } = await import("@/app/api/interviews/[id]/live/activate/route");
    const response = await POST(
      jsonRequest({
        sessionId: "11111111-1111-4111-8111-111111111111",
        openaiSessionId: "sess_abc",
      }),
      unauthedParams
    );
    expect(response.status).toBe(401);
  });

  it("rejects Live end with no session", async () => {
    const { POST } = await import("@/app/api/interviews/[id]/live/end/route");
    const response = await POST(
      jsonRequest({ sessionId: "11111111-1111-4111-8111-111111111111" }),
      unauthedParams
    );
    expect(response.status).toBe(401);
  });
});
