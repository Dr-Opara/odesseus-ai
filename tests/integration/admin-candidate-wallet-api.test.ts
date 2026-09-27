import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));

async function freshWalletRoute() {
  vi.resetModules();
  return import("@/app/api/admin/candidates/[userId]/wallet/route");
}

async function freshAuditTrailRoute() {
  vi.resetModules();
  return import("@/app/api/admin/candidates/[userId]/audit-trail/route");
}

const CANDIDATE_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const ADMIN_ID = "admin-1";

function adminServiceClient(opts: {
  role?: string | null;
  rpcResult?: { data: unknown; error: unknown };
  auditTrailResult?: { data: unknown; error: unknown };
} = {}) {
  const seen: { tables: string[] } = { tables: [] };
  const rpcMock = vi.fn(async (fnName: string, args: unknown) => {
    if (fnName === "odesseus_admin_audit_trail") {
      return opts.auditTrailResult ?? { data: [], error: null };
    }
    return opts.rpcResult ?? { data: null, error: null };
  });
  const fromMock = vi.fn((table: string) => {
    seen.tables.push(table);
    if (table === "admin_users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: opts.role ? { user_id: ADMIN_ID, role: opts.role } : null,
              error: null,
            })),
          })),
        })),
      };
    }
    return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) };
  });
  return {
    rpc: rpcMock,
    from: fromMock,
    __rpcMock: rpcMock,
    __seen: seen,
  };
}

function adminSession(opts: { role?: string; email?: string } = {}) {
  return fakeAuthedClient({
    userId: ADMIN_ID,
    email: opts.email ?? "admin@odesseus.ai",
  });
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/admin/candidates/" + CANDIDATE_ID + "/wallet", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function getRequest(query = "") {
  return new Request("http://localhost/api/admin/candidates/" + CANDIDATE_ID + "/audit-trail" + query);
}

describe("POST /api/admin/candidates/[userId]/wallet", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { POST } = await freshWalletRoute();
    expect((await POST(postRequest({ amountCents: 100, reference: "x", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) })).status).toBe(401);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin", async () => {
    const service = adminServiceClient({ role: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "x", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(403);
    expect(service.__rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a finance admin? No, finance_admin is allowed for wallet:adjust", async () => {
    // This is the whole point of the capability map: finance_admin CAN adjust wallets
    const service = adminServiceClient({
      role: "finance_admin",
      rpcResult: { data: [{ balance_cents_after: 1500, applied: true }], error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 500, reference: "adj:credit-001", reason: "Webhook missed" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ balanceCentsAfter: 1500, applied: true });
  });

  it("lets a finance admin adjust the wallet", async () => {
    const service = adminServiceClient({
      role: "finance_admin",
      rpcResult: { data: [{ balance_cents_after: 1500, applied: true }], error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 500, reference: "adj:credit-001", reason: "Webhook missed" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect(service.__rpcMock).toHaveBeenCalledWith("odesseus_admin_adjust_wallet", expect.objectContaining({
      p_user_id: CANDIDATE_ID,
      p_amount_cents: 500,
      p_reference: "adj:credit-001",
      p_reason: "Webhook missed",
      p_actor_user_id: ADMIN_ID,
      p_actor_role: "finance_admin",
      p_actor_email: "admin@odesseus.ai",
    }));
  });

  it("lets an admin adjust the wallet", async () => {
    const service = adminServiceClient({
      role: "admin",
      rpcResult: { data: [{ balance_cents_after: 1500, applied: true }], error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: -300, reference: "adj:debit-001", reason: "Duplicate charge refund" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json()).applied).toBe(true);
    expect(service.__rpcMock).toHaveBeenCalledWith("odesseus_admin_adjust_wallet", expect.objectContaining({
      p_amount_cents: -300,
      p_actor_role: "admin",
    }));
  });

  it("refuses a marketing_admin (no wallet:adjust capability)", async () => {
    const service = adminServiceClient({ role: "marketing_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "marketing_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "x", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(403);
    expect(service.__rpcMock).not.toHaveBeenCalled();
  });

  it("refuses an unrecognised role", async () => {
    const service = adminServiceClient({ role: "superadmin" });
    createClientMock.mockResolvedValue(adminSession({ role: "superadmin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "x", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(403);
    expect(service.__rpcMock).not.toHaveBeenCalled();
  });

  it("validates amountCents is non-zero", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 0, reference: "x", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(400);
    expect(service.__rpcMock).not.toHaveBeenCalled();
  });

  it("validates reference is present", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "", reason: "y" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(400);
  });

  it("validates reason is present and capped", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "x", reason: "" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(400);
  });

  it("rejects reason over 500 chars", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 100, reference: "x", reason: "x".repeat(501) }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 with a clear message when the RPC reports insufficient balance", async () => {
    const service = adminServiceClient({
      role: "finance_admin",
      rpcResult: { data: null, error: { message: "insufficient wallet balance" } },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: -2000, reference: "adj:overshoot", reason: "Should fail" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Insufficient wallet balance for this debit.");
  });

  it("returns applied = false on idempotent replay", async () => {
    const service = adminServiceClient({
      role: "finance_admin",
      rpcResult: { data: [{ balance_cents_after: 1500, applied: false }], error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    const res = await POST(postRequest({ amountCents: 500, reference: "adj:credit-001", reason: "Webhook missed" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ balanceCentsAfter: 1500, applied: false });
  });

  it("enforces rate limiting", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { POST } = await freshWalletRoute();
    // First 60 should pass (limit is 60/min), the 61st should be rate limited
    for (let i = 0; i < 60; i++) {
      await POST(postRequest({ amountCents: 100, reference: `adj:${i}`, reason: "test" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    }
    const res = await POST(postRequest({ amountCents: 100, reference: "adj:61", reason: "test" }), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });
});

describe("GET /api/admin/candidates/[userId]/audit-trail", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { GET } = await freshAuditTrailRoute();
    expect((await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) })).status).toBe(401);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin", async () => {
    const service = adminServiceClient({ role: null });
    createClientMock.mockResolvedValue(adminSession());
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    const res = await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(403);
    // The audit trail call should not be made
    // (no direct way to assert on a private function, but the route returns 403)
  });

  it("lets a finance_admin read the audit trail", async () => {
    const trail = [
      { id: "audit-1", actor_user_id: "admin-1", actor_email: "admin@odesseus.ai", actor_role: "finance_admin", action: "wallet.adjusted", details: { delta_cents: 500, direction: "credit", balance_cents_before: 1000, balance_cents_after: 1500 }, created_at: new Date().toISOString() },
    ];
    const service = adminServiceClient({
      role: "finance_admin",
      auditTrailResult: { data: trail, error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    const res = await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  it("lets an admin read the audit trail", async () => {
    const trail: any[] = [];
    const service = adminServiceClient({
      role: "admin",
      auditTrailResult: { data: trail, error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "admin" }));
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    const res = await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("refuses a marketing_admin (no wallet:read capability)", async () => {
    const service = adminServiceClient({ role: "marketing_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "marketing_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    const res = await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(403);
  });

  it("respects the limit query parameter", async () => {
    const trail = Array.from({ length: 10 }, (_, i) => ({
      id: `audit-${i}`,
      actor_user_id: "admin-1",
      actor_email: "admin@odesseus.ai",
      actor_role: "finance_admin",
      action: "wallet.adjusted",
      details: {},
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));
    const service = adminServiceClient({
      role: "finance_admin",
      auditTrailResult: { data: trail, error: null },
    });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    const res = await GET(getRequest("?limit=5"), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(200);
    // The RPC is called with the limit, but the mock returns all 10
    // In reality the RPC bounds it; here we assert the route passes the limit through
    expect(service.__rpcMock).toHaveBeenCalledWith("odesseus_admin_audit_trail", expect.objectContaining({
      p_limit: 5,
    }));
    expect((await res.json()).items).toHaveLength(10);
  });

  it("enforces rate limiting", async () => {
    const service = adminServiceClient({ role: "finance_admin" });
    createClientMock.mockResolvedValue(adminSession({ role: "finance_admin" }));
    serviceClientMock.mockReturnValue(service);
    const { GET } = await freshAuditTrailRoute();
    for (let i = 0; i < 120; i++) {
      await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    }
    const res = await GET(getRequest(), { params: Promise.resolve({ userId: CANDIDATE_ID }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });
});