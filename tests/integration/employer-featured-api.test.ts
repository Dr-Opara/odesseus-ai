import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";
const MEMBER_ID = "5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_ID = "5ddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_JOB_ID = "5eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const createClientMock = vi.fn();
const checkoutCreate = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: checkoutCreate } } }),
}));

const FEATURED_ROUTE = "@/app/api/employer/orgs/[orgId]/featured/route";
const CHECKOUT_ROUTE = "@/app/api/employer/orgs/[orgId]/featured/checkout/route";

const LISTING_COLUMNS = "id,job_id,tier,starts_at,expires_at,is_active";
const JOB_COLUMNS = "id,title,location,status";

const orgRow = { id: ORG_ID, name: "Seats Inc.", owner_user_id: OWNER_ID };
const jobRow = { id: JOB_ID, title: "Staff Nurse", location: "Austin, TX", status: "published" };

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** A session client whose table results are keyed on the projected columns. */
function sessionClient(opts: {
  userId?: string | null;
  org?: unknown;
  orgError?: unknown;
  role?: unknown;
  listings?: unknown;
  listingsError?: unknown;
  jobs?: unknown;
  jobsError?: unknown;
}) {
  const canned: Record<string, Record<string, { data?: unknown; error?: unknown }>> = {
    employer_organizations: {
      "id,name": opts.orgError
        ? { error: opts.orgError }
        : { data: "org" in opts ? opts.org : orgRow },
      "id,owner_user_id": { data: orgRow },
    },
    employer_members: {
      role: { data: opts.role ?? null },
    },
    featured_listings: {
      [LISTING_COLUMNS]: opts.listingsError
        ? { error: opts.listingsError }
        : { data: "listings" in opts ? opts.listings : [] },
    },
    employer_jobs: {
      [JOB_COLUMNS]: opts.jobsError ? { error: opts.jobsError } : { data: "jobs" in opts ? opts.jobs : null },
    },
  };

  const from = vi.fn((table: string) => {
    const tableCanned = canned[table];
    if (!tableCanned) throw new Error(`unexpected table ${table}`);

    const query: { columns: string } = { columns: "" };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["eq", "neq", "in", "order", "limit", "range", "delete", "insert", "update"]) {
      b[m] = vi.fn(chain);
    }
    b.select = vi.fn((columns?: string) => {
      query.columns = String(columns ?? "*");
      return b;
    });
    b.insert = vi.fn(chain);
    b.update = vi.fn(chain);

    const resolve = () => {
      const row = tableCanned[query.columns] ?? tableCanned["*"] ?? {};
      return Promise.resolve({ data: row.data ?? null, error: row.error ?? null, count: null });
    };
    b.maybeSingle = vi.fn(resolve);
    b.single = vi.fn(resolve);
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
    return b;
  });

  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: opts.userId ? { claims: { sub: opts.userId } } : { claims: null },
      })),
    },
    from,
    __from: from,
  };
}

async function freshRoute(path: string) {
  vi.resetModules();
  return import(path);
}

function getRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const orgParams = (orgId = ORG_ID) => ({ params: Promise.resolve({ orgId }) });

beforeEach(() => {
  createClientMock.mockReset();
  checkoutCreate.mockReset();
  checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/employer/orgs/[orgId]/featured", () => {
  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { GET } = await freshRoute(FEATURED_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(401);
  });

  it("404s a non-uuid org id", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { GET } = await freshRoute(FEATURED_ROUTE);
    expect((await GET(getRequest("/x"), orgParams("not-a-uuid"))).status).toBe(404);
  });

  it("returns listings, jobs, and catalog prices for a member", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({
        userId: OWNER_ID,
        listings: [
          {
            id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            job_id: JOB_ID,
            tier: "featured_14d",
            starts_at: daysFromNow(-1),
            expires_at: daysFromNow(13),
            is_active: true,
          },
        ],
        jobs: [jobRow],
      })
    );
    const { GET } = await freshRoute(FEATURED_ROUTE);
    const response = await GET(getRequest("/x"), orgParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.featured.orgName).toBe("Seats Inc.");
    expect(body.featured.listings[0]).toMatchObject({
      jobTitle: "Staff Nurse",
      tier: "featured_14d",
      isBoosted: true,
    });
    expect(body.featured.jobs[0].isBoosted).toBe(true);
    // Prices travel with the payload, so the page cannot show its own number.
    expect(body.featured.tiers.map((tier: { amountCents: number }) => tier.amountCents)).toEqual([
      2900, 4900, 12900,
    ]);
  });

  it("lets a plain member read it: a recruiter can see the boost status", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: MEMBER_ID, role: { role: "recruiter" } })
    );
    const { GET } = await freshRoute(FEATURED_ROUTE);
    const response = await GET(getRequest("/x"), orgParams());
    expect(response.status).toBe(200);
  });

  it("404s a non-member rather than confirming the org exists", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "stranger", org: null }));
    const { GET } = await freshRoute(FEATURED_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(404);
  });

  it("500s when the featured read fails", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, listingsError: { message: "db down" } })
    );
    const { GET } = await freshRoute(FEATURED_ROUTE);
    const response = await GET(getRequest("/x"), orgParams());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Could not load/);
  });

  it("500s when the jobs read fails", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, jobsError: { message: "db down" } })
    );
    const { GET } = await freshRoute(FEATURED_ROUTE);
    expect((await GET(getRequest("/x"), orgParams())).status).toBe(500);
  });
});

describe("POST /api/employer/orgs/[orgId]/featured/checkout", () => {
  it("rejects an untrusted origin before any work", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }, { origin: "https://evil.example" }),
      orgParams()
    );
    expect(response.status).toBe(403);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: null }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams());
    expect(response.status).toBe(401);
  });

  it("404s a non-uuid org id", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    expect((await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams("nope"))).status).toBe(404);
  });

  it("rejects a non-uuid job id", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { jobId: "not-a-uuid", tier: "featured_7d" }), orgParams());
    expect(response.status).toBe(400);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejects a tier that is not in the catalog", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { jobId: JOB_ID, tier: "featured_365d" }),
      orgParams()
    );
    expect(response.status).toBe(400);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("404s a non-member", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: "stranger", org: null }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams());
    expect(response.status).toBe(404);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("403s a recruiter: spending money is an admin action", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: MEMBER_ID, role: { role: "recruiter" } })
    );
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams());
    expect(response.status).toBe(403);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("404s a job the org does not own, before taking a payment", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: null }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest("/x", { jobId: OTHER_JOB_ID, tier: "featured_7d" }),
      orgParams()
    );
    expect(response.status).toBe(404);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("409s a closed job", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, jobs: { ...jobRow, status: "closed" } })
    );
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/closed/);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("500s when the job lookup fails", async () => {
    createClientMock.mockResolvedValue(
      sessionClient({ userId: OWNER_ID, jobsError: { message: "boom" } })
    );
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams())).status).toBe(500);
  });

  it("starts a one-time payment with exactly the metadata the webhook requires", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: jobRow }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const response = await POST(
      postRequest("/x", { jobId: JOB_ID, tier: "featured_14d" }),
      orgParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      url: "https://checkout.stripe.com/session",
      tier: "featured_14d",
      jobId: JOB_ID,
      amountCents: 4900,
      days: 14,
    });

    const session = checkoutCreate.mock.calls[0][0];
    // One-time, not a subscription: a featured window is a fixed purchase.
    expect(session.mode).toBe("payment");
    expect(session.line_items[0].price_data.unit_amount).toBe(4900);
    expect(session.line_items[0].quantity).toBe(1);
    expect(session.metadata).toEqual({
      odesseus_org_id: ORG_ID,
      odesseus_job_id: JOB_ID,
      odesseus_featured_tier: "featured_14d",
    });
    expect(session.success_url).toContain("/employer/featured?boost=success");
    expect(session.cancel_url).toContain("/employer/featured?boost=cancelled");
  });

  it("prices the AI tier from the catalog, not from the request", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: jobRow }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    await POST(postRequest("/x", { jobId: JOB_ID, tier: "ai_30d" }), orgParams());
    expect(checkoutCreate.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(12900);
  });

  it("503s when the site url is not configured rather than building a bad link", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: jobRow }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect((await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams())).status).toBe(503);
  });

  it("502s when Stripe returns no checkout url", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: jobRow }));
    checkoutCreate.mockResolvedValue({ url: null });
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams())).status).toBe(502);
  });

  it("rate limits featured checkouts per org and sets Retry-After", async () => {
    createClientMock.mockResolvedValue(sessionClient({ userId: OWNER_ID, jobs: jobRow }));
    const { POST } = await freshRoute(CHECKOUT_ROUTE);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    let throttled: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      const response = await POST(postRequest("/x", { jobId: JOB_ID, tier: "featured_7d" }), orgParams());
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }
    expect(throttled).not.toBeNull();
    expect(Number(throttled!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
