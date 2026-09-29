import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();
const checkoutCreate = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: checkoutCreate } } }),
}));

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";

const ORG_ROW = {
  id: ORG_ID,
  name: "Acme Corp",
  owner_user_id: OWNER_ID,
  website: null,
  industry: null,
  company_size: null,
  description: null,
  created_at: "2026-01-04T10:00:00Z",
};

function authedEmployer(userId: string | null = OWNER_ID) {
  createClientMock.mockResolvedValue({
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : { claims: null },
      }),
      getUser: async () => ({
        data: {
          user: userId
            ? {
                id: userId,
                email: "owner@acme.test",
                user_metadata: { account_type: "employer", company_name: "Acme Corp" },
              }
            : null,
        },
        error: null,
      }),
    },
  });
}

describe("POST /api/employer/orgs (provisioning)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    authedEmployer();
  });

  it("rejects unauthenticated callers", async () => {
    authedEmployer(null);
    const { POST } = await import("@/app/api/employer/orgs/route");
    const response = await POST(
      new Request("http://localhost/api/employer/orgs", {
        method: "POST",
        body: JSON.stringify({ companyName: "Acme" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects candidate accounts so they never gain employer access", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: "user-candidate" } } }),
        getUser: async () => ({
          data: {
            user: {
              id: "user-candidate",
              email: "c@example.com",
              user_metadata: { account_type: "candidate" },
            },
          },
          error: null,
        }),
      },
    });
    serviceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import("@/app/api/employer/orgs/route");
    const response = await POST(
      new Request("http://localhost/api/employer/orgs", {
        method: "POST",
        body: JSON.stringify({ companyName: "Acme" }),
      })
    );
    expect(response.status).toBe(403);
  });

  it("provisions through the idempotent RPC and returns the org", async () => {
    const rpc = vi.fn(async () => ({ data: ORG_ROW, error: null }));
    serviceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", rpc })
    );

    const { POST } = await import("@/app/api/employer/orgs/route");
    const response = await POST(
      new Request("http://localhost/api/employer/orgs", {
        method: "POST",
        body: JSON.stringify({ companyName: "Acme Corp" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.org).toMatchObject({ id: ORG_ID, name: "Acme Corp", ownerUserId: OWNER_ID });
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_ensure_employer_organization",
      expect.objectContaining({ p_user_id: OWNER_ID, p_company_name: "Acme Corp" })
    );
  });

  it("requires a company name from somewhere", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: OWNER_ID } } }),
        getUser: async () => ({
          data: {
            user: {
              id: OWNER_ID,
              email: "owner@acme.test",
              user_metadata: { account_type: "employer" },
            },
          },
          error: null,
        }),
      },
    });
    serviceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import("@/app/api/employer/orgs/route");
    const response = await POST(
      new Request("http://localhost/api/employer/orgs", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("employer organization profile", () => {
  const orgParams = { params: Promise.resolve({ orgId: ORG_ID }) };

  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    authedEmployer();
  });

  it("hides the org from non-members with 404", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: () => fakeQueryResult(null),
      })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/route");
    const response = await GET(new Request("http://localhost/x"), orgParams);
    expect(response.status).toBe(404);
  });

  it("lets the owner update the company profile", async () => {
    const updated = { ...ORG_ROW, website: "https://acme.test", industry: "Software" };
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") {
            return {
              ...fakeQueryResult(ORG_ROW),
              update: vi.fn(() => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({ data: updated, error: null }),
                  }),
                }),
              })),
            };
          }
          if (table === "employer_members") return fakeQueryResult(null);
          return fakeQueryResult(null);
        },
      })
    );

    const { PATCH } = await import("@/app/api/employer/orgs/[orgId]/route");
    const response = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ website: "https://acme.test", industry: "Software" }),
      }),
      orgParams
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.org).toMatchObject({ website: "https://acme.test", industry: "Software" });
  });

  it("refuses profile edits from non-owner admins", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: "user-admin",
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "admin" });
          return fakeQueryResult(null);
        },
      })
    );

    const { PATCH } = await import("@/app/api/employer/orgs/[orgId]/route");
    const response = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ website: "https://acme.test" }),
      }),
      orgParams
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/employer/orgs/[orgId]/plans/checkout", () => {
  const checkoutParams = { params: Promise.resolve({ orgId: ORG_ID }) };

  function checkoutRequest(body: unknown) {
    return new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    checkoutCreate.mockReset();
    authedEmployer();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function adminClient() {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "admin" });
          return fakeQueryResult(null);
        },
      })
    );
  }

  it("rejects an unknown tier", async () => {
    adminClient();
    const { POST } = await import("@/app/api/employer/orgs/[orgId]/plans/checkout/route");
    const response = await POST(checkoutRequest({ tier: "enterprise" }), checkoutParams);
    expect(response.status).toBe(400);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("creates a catalog-priced subscription checkout with fulfillment metadata", async () => {
    adminClient();
    checkoutCreate.mockResolvedValue({ url: "https://checkout.test/s", id: "cs_test" });

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/plans/checkout/route");
    const response = await POST(checkoutRequest({ tier: "growth" }), checkoutParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe("growth");
    expect(checkoutCreate).toHaveBeenCalledOnce();
    const args = checkoutCreate.mock.calls[0][0] as {
      mode: string;
      line_items: Array<{ price_data: { unit_amount: number }; quantity: number }>;
      metadata: Record<string, string>;
    };
    expect(args.mode).toBe("subscription");
    expect(args.line_items[0].price_data.unit_amount).toBe(14900);
    expect(args.metadata).toMatchObject({ odesseus_org_id: ORG_ID, odesseus_tier: "growth" });
  });

  it("hides the org from non-members with 404", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-stranger", from: () => fakeQueryResult(null) })
    );

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/plans/checkout/route");
    const response = await POST(checkoutRequest({ tier: "starter" }), checkoutParams);
    expect(response.status).toBe(404);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH publish maps at_capacity to 402 with the reason", () => {
  it("stops a Growth org at exactly 10 published jobs", async () => {
    const ORG = "52222222-2222-4222-8222-222222222222";
    const OWNER = "51111111-1111-4111-8111-111111111111";
    createClientMock.mockReset();
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: OWNER }));

    // Ordered maybeSingle answers: org row, owner check needs no member row,
    // draft job, growth subscription. The published-count query answers 10.
    const answers: unknown[] = [
      { id: ORG, owner_user_id: OWNER },
      { status: "draft" },
      {
        tier: "growth",
        status: "active",
        job_posts_included: 10,
        period_start: "2026-01-01T00:00:00Z",
        period_end: "2026-02-01T00:00:00Z",
      },
    ];
    const updateSpy = vi.fn();
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.update = (...args: unknown[]) => {
        updateSpy(...args);
        return builder;
      };
      builder.maybeSingle = async () => ({ data: answers.shift() ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 10 }).then(
          resolve as (value: unknown) => unknown
        );
      return builder;
    });
    serviceClientMock.mockReset();

    // NOTE: the jobs PATCH route uses the session client for everything, so
    // point createClient at the queued mock. serviceClient is unused here.
    createClientMock.mockResolvedValue({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: OWNER } } }),
      },
      from,
    });

    const { PATCH } = await import("@/app/api/employer/orgs/[orgId]/jobs/[jobId]/route");
    const response = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ action: "publish" }),
      }),
      { params: Promise.resolve({ orgId: ORG, jobId: "job-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.reason).toBe("at_capacity");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/expire-featured-listings", () => {
  beforeEach(() => {
    serviceClientMock.mockReset();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects callers without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/expire-featured-listings/route");
    const response = await GET(new Request("http://localhost/x"));
    expect(response.status).toBe(401);
  });

  it("expires listings through the RPC and reports the count", async () => {
    const rpc = vi.fn(async () => ({ data: [{ expired: 2 }], error: null }));
    serviceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service", rpc }));

    const { GET } = await import("@/app/api/cron/expire-featured-listings/route");
    const response = await GET(
      new Request("http://localhost/x", { headers: { authorization: "Bearer cron-secret" } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, expired: 2 });
    expect(rpc).toHaveBeenCalledWith("expire_ended_featured_listings");
  });
});
