import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();
const isAdminMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));
vi.mock("@/lib/partners/service", () => ({
  isAdmin: (userId: string) => isAdminMock(userId),
}));

// The rate limiter is process-global; reset the module registry per test so
// each case starts with empty buckets.
async function freshRoute() {
  vi.resetModules();
  return import("@/app/api/admin/job-reports/route");
}

async function freshItemRoute() {
  vi.resetModules();
  return import("@/app/api/admin/job-reports/[id]/route");
}

const REPORT_ID = "22222222-2222-4222-8222-222222222222";

const QUEUE_ROW = {
  id: REPORT_ID,
  user_id: "user-a",
  job_id: "11111111-1111-4111-8111-111111111111",
  reason: "Scam",
  details: "Asked for payment",
  status: "new",
  moderation_note: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * The queue read is a paged SELECT that resolves through `.range()`, which the
 * shared fakeQueryResult helper does not implement.
 */
function queueBuilder(opts: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {};

  for (const method of ["select", "order", "limit", "range", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.eq = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => builder);
  builder.single = vi.fn(() => builder);

  const resolve = () =>
    Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null, count: opts.count ?? null });

  builder.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
  return builder;
}

function adminServiceClient(opts: {
  data?: unknown;
  error?: unknown;
  count?: number | null;
  rpcError?: unknown;
} = {}) {
  const seen: { filters: unknown[][]; range: unknown[] | null } = {
    filters: [],
    range: null,
  };
  return {
    __seen: seen,
    from: vi.fn((table: string) => {
      // Record the filters and the paged range the service actually issues, so
      // a test can assert the moderation query is bounded and filtered.
      const builder = queueBuilder({ data: opts.data, error: opts.error, count: opts.count });
      const chain = builder as Record<string, (...args: unknown[]) => unknown>;
      const originalRange = chain.range;
      builder.range = vi.fn((from: number, to: number) => {
        seen.range = [from, to];
        return originalRange();
      });
      const originalEq = chain.eq;
      builder.eq = vi.fn((column: string, value: unknown) => {
        seen.filters.push([column, value]);
        return originalEq(column, value);
      });
      return builder;
    }),
    rpc: vi.fn(async () => ({ data: null, error: opts.rpcError ?? null })),
  };
}

function adminSession() {
  return fakeAuthedClient({ userId: "admin-1" });
}

function queueRequest(query = "") {
  return new Request(`http://localhost/api/admin/job-reports${query}`);
}

function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/admin/job-reports/${REPORT_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("GET /api/admin/job-reports", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    isAdminMock.mockReset();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { GET } = await freshRoute();
    expect((await GET(queueRequest())).status).toBe(401);
    // An unauthenticated caller must not reach the service-role client.
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin before any privileged read", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(false);
    const { GET } = await freshRoute();
    const response = await GET(queueRequest());
    expect(response.status).toBe(403);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("reads the queue with a service-role client and never with the caller's", async () => {
    const service = adminServiceClient({ data: [QUEUE_ROW], count: 1 });
    const session = adminSession();
    createClientMock.mockResolvedValue(session);
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    const response = await GET(queueRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(REPORT_ID);
    expect(serviceClientMock).toHaveBeenCalled();
    expect(service.from).toHaveBeenCalledWith("job_reports");
    // The caller's user-scoped client resolves identity only. It is never used
    // for the privileged read, which RLS would deny anyway.
    expect(session.from).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not filter by status unless one is requested", async () => {
    const service = adminServiceClient({ data: [QUEUE_ROW], count: 1 });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    await GET(queueRequest());
    expect(service.__seen.filters).toEqual([]);
  });

  it("filters the queue by a valid status", async () => {
    const service = adminServiceClient({ data: [], count: 0 });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    const response = await GET(queueRequest("?status=reviewing"));
    expect(response.status).toBe(200);
    expect(service.__seen.filters).toEqual([["status", "reviewing"]]);
  });

  it("rejects a status outside the fixed set", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    const { GET } = await freshRoute();
    const response = await GET(queueRequest("?status=banished"));
    expect(response.status).toBe(400);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects non-numeric pagination", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    const { GET } = await freshRoute();
    expect((await GET(queueRequest("?limit=lots"))).status).toBe(400);
  });

  it("translates limit/offset into a bounded range read", async () => {
    const service = adminServiceClient({ data: [], count: 0 });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    await GET(queueRequest("?limit=10&offset=20"));
    // PostgREST range() is inclusive on both ends, so 10 rows from offset 20
    // is 20..29.
    expect(service.__seen.range).toEqual([20, 29]);
  });

  it("sets Retry-After when the admin queue read is throttled", async () => {
    const service = adminServiceClient({ data: [], count: 0 });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    let throttled: Response | null = null;
    for (let i = 0; i < 200; i += 1) {
      const response = await GET(queueRequest());
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }
    expect(throttled).not.toBeNull();
    expect(Number(throttled!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns 500 when the queue read fails", async () => {
    const service = adminServiceClient({ data: null, error: { message: "db down" } });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { GET } = await freshRoute();
    const response = await GET(queueRequest());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("Could not load the moderation queue.");
  });
});

describe("PATCH /api/admin/job-reports/[id]", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    isAdminMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an untrusted origin before doing any work", async () => {
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "resolved" }, { origin: "https://evil.example" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(403);
    expect(isAdminMock).not.toHaveBeenCalled();
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(401);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(false);
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(403);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("moves a report through the service-role RPC", async () => {
    const service = adminServiceClient();
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(
      patchRequest({ status: "reviewing", note: "Contacted the job poster" }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith("odesseus_update_job_report_status", {
      p_report_id: REPORT_ID,
      p_status: "reviewing",
      p_note: "Contacted the job poster",
    });
  });

  it("normalises a blank note to null", async () => {
    const service = adminServiceClient();
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    await PATCH(patchRequest({ status: "dismissed", note: "   " }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(service.rpc).toHaveBeenCalledWith("odesseus_update_job_report_status", {
      p_report_id: REPORT_ID,
      p_status: "dismissed",
      p_note: null,
    });
  });

  it("never allows a report to be pushed back to new", async () => {
    const service = adminServiceClient();
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "new" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(400);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("rejects the retired 'open' status instead of silently accepting it", async () => {
    const service = adminServiceClient();
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "open" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(400);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("rejects a status outside the fixed set", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(adminServiceClient());
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "banished" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a note beyond the stored cap", async () => {
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(adminServiceClient());
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(
      patchRequest({ status: "resolved", note: "x".repeat(2001) }),
      { params: Promise.resolve({ id: REPORT_ID }) }
    );
    expect(response.status).toBe(400);
  });

  it("404s a non-uuid report id", async () => {
    const service = adminServiceClient();
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);
    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("400s when the RPC rejects the transition", async () => {
    const service = adminServiceClient({ rpcError: { message: "report not found" } });
    createClientMock.mockResolvedValue(adminSession());
    isAdminMock.mockResolvedValue(true);
    serviceClientMock.mockReturnValue(service);

    const { PATCH } = await freshItemRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: REPORT_ID }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("report not found");
  });
});
