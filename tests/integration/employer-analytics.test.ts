import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";

const ORG_ROW = { id: ORG_ID, owner_user_id: OWNER_ID };

function memberSession(tables: Record<string, unknown> = {}, userId: string = OWNER_ID) {
  const memberRows = [{ user_id: userId, role: "admin", created_at: "2026-01-04T10:00:00Z" }];
  return fakeAuthedClient({
    userId,
    from: (table: string) => {
      if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
      if (table === "employer_members") {
        // Role lookups use maybeSingle (one row); member lists await the
        // builder (all rows). Serve both shapes from one roster.
        return {
          ...fakeQueryResult(memberRows),
          maybeSingle: async () => ({ data: memberRows[0] ?? null, error: null }),
        };
      }
      if (table in tables) return fakeQueryResult(tables[table]);
      return fakeQueryResult(null);
    },
  });
}

// fakeAuthedClient exposes only getClaims; the overview also reads the auth
// user record, so attach getUser to the session mocks used below.
function withAuthUser(mock: { auth: Record<string, unknown> }, userId: string) {
  (mock.auth as Record<string, unknown>).getUser = async () => ({
    data: {
      user: {
        id: userId,
        email: "owner@acme.test",
        user_metadata: { account_type: "employer", company_name: "Acme Corp" },
      },
    },
    error: null,
  });
  return mock;
}

const orgParams = { params: Promise.resolve({ orgId: ORG_ID }) };

describe("GET dashboard (2S)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("answers 404 for outsiders", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-stranger", from: () => fakeQueryResult(null) })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/dashboard/route");
    const response = await GET(new Request("http://localhost/x"), orgParams);
    expect(response.status).toBe(404);
  });

  it("aggregates real stores with explicit notices on gaps", async () => {
    createClientMock.mockResolvedValue(
      withAuthUser(
        memberSession({
          employer_subscriptions: null,
          employer_job_post_credits: null,
          recruiter_seats: null,
          employer_jobs: [],
          employer_members: [],
          employer_member_invitations: [],
          employer_fit_scores: [],
          employer_pipeline_stages: [],
          featured_listings: [],
          profiles: null,
        }),
        OWNER_ID
      )
    );
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({ userId: "service", rpc })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/dashboard/route");
    const response = await GET(new Request("http://localhost/x"), orgParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dashboard.jobCounts).toEqual({ total: 0, published: 0, draft: 0, closed: 0 });
    expect(body.dashboard.applicantTotal).toBe(0);
    expect(body.dashboard.strongFitCount).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_get_employer_applicant_counts",
      expect.objectContaining({ p_org_id: ORG_ID })
    );
  });
});

describe("GET analytics (2S)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("rejects an invalid window", async () => {
    createClientMock.mockResolvedValue(memberSession({}));

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/analytics/route");
    const response = await GET(new Request("http://localhost/x?days=9999"), orgParams);
    expect(response.status).toBe(400);
  });

  it("returns bounded real-data analytics", async () => {
    createClientMock.mockResolvedValue(
      withAuthUser(
        memberSession({
          employer_subscriptions: null,
          employer_job_post_credits: null,
          recruiter_seats: null,
          employer_jobs: [],
          employer_members: [{ user_id: OWNER_ID, role: "owner" }],
          employer_member_invitations: [],
          employer_fit_scores: [{ job_id: "j1", score: 90 }],
          employer_pipeline_stages: [],
          featured_listings: [],
          profiles: null,
        }),
        OWNER_ID
      )
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        rpc: vi.fn(async () => ({ data: [], error: null })),
      })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/analytics/route");
    const response = await GET(new Request("http://localhost/x?days=7"), orgParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analytics.applicationsOverTime).toHaveLength(7);
    expect(body.analytics.outcomes).toEqual({ hired: 0, rejected: 0 });
    expect(body.analytics.team.members).toBe(1);
  });
});

describe("GET billing (2S)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("reports plan, period, capacity, and seats without moving money", async () => {
    createClientMock.mockResolvedValue(
      withAuthUser(
        memberSession({
          employer_subscriptions: {
            tier: "growth",
            status: "active",
            job_posts_included: 10,
            period_start: "2026-01-01T00:00:00Z",
            period_end: "2026-02-01T00:00:00Z",
          },
          recruiter_seats: { count: 2, active_until: "2026-02-01T00:00:00Z" },
          employer_jobs: [],
          employer_members: [],
          employer_member_invitations: [],
          featured_listings: [],
          profiles: null,
        }),
        OWNER_ID
      )
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/billing/route");
    const response = await GET(new Request("http://localhost/x"), orgParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.billing.plan).toMatchObject({ tier: "growth", name: "Growth" });
    expect(body.billing.subscriptionStatus).toBe("active");
    expect(body.billing.capacity).toMatchObject({ included: 10, published: 0, remaining: 10 });
  });
});

describe("invitation accept seat warning (2S)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  it("warns the hiring team when an acceptance fills the last paid seat", async () => {
    const notified: Array<Record<string, unknown>> = [];
    // acceptInvitation reads the RPC row shape; shape it here.
    createClientMock.mockResolvedValue(
      (() => {
        const rpc = vi.fn(async (...args: unknown[]) => {
          const [name] = args as [string];
          if (name === "odesseus_accept_employer_invitation") {
            return {
              data: [
                {
                  joined_org_id: ORG_ID,
                  org_name: "Acme",
                  joined_role: "recruiter",
                  invitation_id: "inv-1",
                },
              ],
              error: null,
            };
          }
          return { data: null, error: null };
        });
        return fakeAuthedClient({
          userId: "user-new",
          from: (table: string) => {
            if (table === "recruiter_seats") {
              return fakeQueryResult({ count: 1, active_until: "2026-02-01T00:00:00Z" });
            }
            return fakeQueryResult(null);
          },
          rpc,
        });
      })()
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "employer_members") {
            return fakeQueryResult([{ user_id: OWNER_ID }]);
          }
          if (table === "employer_organizations") {
            return fakeQueryResult({ owner_user_id: OWNER_ID });
          }
          if (table === "employer_notification_preferences") {
            return fakeQueryResult(null);
          }
          if (table === "notifications") {
            return {
              ...fakeQueryResult(null),
              insert: vi.fn((input: Record<string, unknown>) => {
                notified.push(input);
                return {
                  select: () => ({
                    single: async () => ({ data: { id: "n1" }, error: null }),
                  }),
                };
              }),
            };
          }
          return fakeQueryResult(null);
        },
        rpc: vi.fn(async (...args: unknown[]) => {
          const [name] = args as [string];
          // Required-seat RPC reports one more needed than paid.
          if (name === "odesseus_org_required_seat_count") {
            return { data: 2, error: null };
          }
          return { data: null, error: null };
        }),
      })
    );

    const { POST } = await import("@/app/api/employer/invitations/accept/route");
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ token: "invite-token" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.joined.orgId).toBe(ORG_ID);
    expect(
      notified.some((n) => n.notification_type === "EMPLOYER_RECRUITER_SEAT_WARNING")
    ).toBe(true);
  });
});

describe("GET expire-featured-listings notices (2S)", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
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

  it("notifies once per newly-expired and soon-expiring listing", async () => {
    const notified: Array<{ orgId: string; input: Record<string, unknown> }> = [];
    const rpc = vi.fn(async () => ({ data: [{ expired: 1 }], error: null }));
    const now = Date.now();
    createServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "featured_listings") {
          return fakeQueryResult([
            {
              id: "feat-1",
              org_id: ORG_ID,
              job_id: "job-1",
              tier: "featured_7d",
              is_active: false,
              expires_at: new Date(now - 60 * 60 * 1000).toISOString(),
            },
            {
              id: "feat-2",
              org_id: ORG_ID,
              job_id: "job-1",
              tier: "featured_14d",
              is_active: true,
              expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            },
          ]);
        }
        if (table === "employer_jobs") {
          return fakeQueryResult([{ id: "job-1", title: "Engineer" }]);
        }
        if (table === "employer_members") {
          return fakeQueryResult([{ user_id: OWNER_ID }]);
        }
        if (table === "employer_organizations") {
          return fakeQueryResult({ owner_user_id: OWNER_ID });
        }
        if (table === "employer_notification_preferences") {
          return fakeQueryResult(null);
        }
        if (table === "notifications") {
          return {
            ...fakeQueryResult(null),
            insert: vi.fn((input: Record<string, unknown>) => {
              notified.push({ orgId: input.organization_id as string, input });
              return {
                select: () => ({
                  single: async () => ({ data: { id: "n1" }, error: null }),
                }),
              };
            }),
          };
        }
        return fakeQueryResult(null);
      },
      rpc,
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
    });

    const { GET } = await import("@/app/api/cron/expire-featured-listings/route");
    const response = await GET(
      new Request("http://localhost/x", { headers: { authorization: "Bearer cron-secret" } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.expired).toBe(1);
    expect(body.expiredNotified).toBe(1);
    expect(body.expiringNotified).toBe(1);
    const types = notified.map((n) => n.input.notification_type).sort();
    expect(types).toEqual(["EMPLOYER_FEATURED_JOB_EXPIRED", "EMPLOYER_FEATURED_JOB_EXPIRING"]);
  });
});
