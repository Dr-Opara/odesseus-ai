import { describe, expect, it, vi } from "vitest";
import {
  countJobsByStatus,
  getActiveSeatCount,
  getEmployerAccount,
  getEmployerInvitations,
  getEmployerJobs,
  getEmployerMembers,
  getEmployerOrganization,
  getEmployerOverview,
  getEmployerRole,
  getEmployerSeats,
  getEmployerSubscription,
  getEmployerUserId,
  getJobPostAllowance,
  getUnrecognisedFeaturedTiers,
  publishJob,
  resolveJobQuota,
} from "@/lib/employer/service";
import type { EmployerJob } from "@/lib/employer/types";

type Row = Record<string, unknown>;

/**
 * A filter-aware fake Supabase client for the employer service layer.
 *
 * It applies the real `.eq()/.limit()` filters to per-table rows and resolves
 * like the real postgrest-js thenable, so the service reads behave the same way
 * they do against Postgres. `rpc` results are supplied per function name so the
 * seat tests can model both the entitled and the unavailable case.
 */
function employerFake(options: {
  routes?: Record<string, Row[]>;
  userId?: string | null;
  authUser?: { email?: string; user_metadata?: Record<string, unknown> } | null;
  rpcs?: Record<string, unknown>;
}) {
  const { routes = {}, userId = "user-1", authUser, rpcs = {} } = options;

  const from = (table: string) => {
    const rows = (routes[table] ?? []) as Row[];
    const filters: Array<(row: Row) => boolean> = [];
    const builder: Record<string, unknown> = {};

    const matches = () => rows.filter((row) => filters.every((filter) => filter(row)));

    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = async () => {
      const [first] = matches();
      return { data: first ?? null, error: null };
    };
    builder.then = (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ data: matches(), error: null }).then(resolve, reject);
    return builder;
  };

  return {
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : { claims: null },
      }),
      getUser: async () => {
        if (authUser === null) return { data: { user: null }, error: null };
        return {
          data: {
            user: {
              id: userId,
              email: "owner@acme.test",
              user_metadata: {},
              ...authUser,
            },
          },
          error: null,
        };
      },
    },
    from,
    rpc: async (name: string, args: unknown) => ({
      data: name in rpcs ? rpcs[name] : null,
      error: name in rpcs ? null : { message: "function not found" },
      args,
    }),
  };
}

const ORG_ROW = {
  id: "org-1",
  name: "Acme Corp",
  owner_user_id: "user-1",
  created_at: "2026-01-04T10:00:00Z",
};

const SUBSCRIPTION_ROW = {
  org_id: "org-1",
  tier: "growth",
  status: "active",
  job_posts_included: 10,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
};

function jobRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "job-1",
    org_id: "org-1",
    title: "GenAI Security Engineer",
    location: "Lagos, Nigeria",
    status: "published",
    posted_at: "2026-09-10T09:00:00Z",
    created_at: "2026-09-09T09:00:00Z",
    ...overrides,
  };
}

function featuredRow(overrides: Partial<Row> = {}): Row {
  return {
    org_id: "org-1",
    job_id: "job-1",
    tier: "ai_30d",
    is_active: true,
    starts_at: "2026-09-10T00:00:00Z",
    expires_at: "2026-10-10T00:00:00Z",
    ...overrides,
  };
}

describe("employer identity resolution", () => {
  it("resolves the signed-in user id from auth claims", async () => {
    await expect(getEmployerUserId(employerFake({}) as never)).resolves.toBe("user-1");
  });

  it("returns null when there is no signed-in user", async () => {
    await expect(
      getEmployerUserId(employerFake({ userId: null }) as never)
    ).resolves.toBeNull();
  });

  it("reads the account email and the signup company name from the auth record", async () => {
    const client = employerFake({
      authUser: {
        email: "owner@acme.test",
        user_metadata: { account_type: "employer", company_name: "Acme Corp" },
      },
    });
    await expect(getEmployerAccount(client as never)).resolves.toEqual({
      userId: "user-1",
      email: "owner@acme.test",
      companyName: "Acme Corp",
      isEmployerAccount: true,
    });
  });

  /**
   * A candidate account is detectable, which is what lets the portal guard send
   * it back to the candidate app instead of showing an empty company.
   */
  it("marks a non-employer account as not an employer account", async () => {
    const client = employerFake({ authUser: { email: "cand@mail.test", user_metadata: {} } });
    const account = await getEmployerAccount(client as never);
    expect(account?.isEmployerAccount).toBe(false);
  });

  it("never invents a company name when the auth record has none", async () => {
    const client = employerFake({ authUser: { email: "a@b.test", user_metadata: {} } });
    const account = await getEmployerAccount(client as never);
    expect(account?.companyName).toBeNull();
  });
});

describe("employer organization resolution", () => {
  it("resolves the org through employer_members and maps it to camelCase", async () => {
    const client = employerFake({
      routes: {
        employer_members: [{ org_id: "org-1", user_id: "user-1", role: "owner" }],
        employer_organizations: [ORG_ROW],
      },
    });
    await expect(getEmployerOrganization(client as never, "user-1")).resolves.toEqual({
      id: "org-1",
      name: "Acme Corp",
      ownerUserId: "user-1",
      createdAt: "2026-01-04T10:00:00Z",
    });
  });

  it("returns null when the user is not a member of any organization", async () => {
    const client = employerFake({ routes: { employer_organizations: [{ ...ORG_ROW, owner_user_id: "user-9" }] } });
    await expect(getEmployerOrganization(client as never, "user-1")).resolves.toBeNull();
  });

  it("resolves an owned org that has no member row (heals half-provisioned accounts)", async () => {
    const client = employerFake({ routes: { employer_organizations: [ORG_ROW] } });
    await expect(getEmployerOrganization(client as never, "user-1")).resolves.toEqual({
      id: "org-1",
      name: "Acme Corp",
      ownerUserId: "user-1",
      createdAt: "2026-01-04T10:00:00Z",
    });
  });

  it("returns null when the membership row exists but the org row does not", async () => {
    const client = employerFake({
      routes: { employer_members: [{ org_id: "org-1", user_id: "user-1", role: "owner" }] },
    });
    await expect(getEmployerOrganization(client as never, "user-1")).resolves.toBeNull();
  });

  it("reads the signed-in user's own role", async () => {
    const client = employerFake({
      routes: { employer_members: [{ org_id: "org-1", user_id: "user-1", role: "recruiter" }] },
    });
    await expect(getEmployerRole(client as never, "user-1")).resolves.toBe("recruiter");
    await expect(
      getEmployerRole(employerFake({}) as never, "user-1")
    ).resolves.toBeNull();
  });
});

describe("employer members and invitations", () => {
  it("lists members and flags which one is the viewer", async () => {
    const client = employerFake({
      routes: {
        employer_members: [
          { org_id: "org-1", user_id: "user-1", role: "owner", created_at: "2026-01-04T10:00:00Z" },
          { org_id: "org-1", user_id: "user-2", role: "recruiter", created_at: "2026-02-01T10:00:00Z" },
        ],
      },
    });
    await expect(getEmployerMembers(client as never, "org-1", "user-2")).resolves.toEqual([
      { userId: "user-1", role: "owner", joinedAt: "2026-01-04T10:00:00Z", isYou: false },
      { userId: "user-2", role: "recruiter", joinedAt: "2026-02-01T10:00:00Z", isYou: true },
    ]);
  });

  /**
   * The org id is the authorisation boundary, so it is also the filter. A read
   * for one organization must not surface another organization's members even
   * if the client returns them.
   */
  it("scopes members to the requested organization", async () => {
    const client = employerFake({
      routes: {
        employer_members: [
          { org_id: "org-1", user_id: "user-1", role: "owner", created_at: null },
          { org_id: "org-2", user_id: "user-9", role: "owner", created_at: null },
        ],
      },
    });
    const members = await getEmployerMembers(client as never, "org-1", "user-1");
    expect(members.map((member) => member.userId)).toEqual(["user-1"]);
  });

  it("returns an empty list rather than throwing when a read is refused", async () => {
    await expect(getEmployerMembers(employerFake({}) as never, "org-1", "user-1")).resolves.toEqual([]);
    await expect(
      getEmployerInvitations(employerFake({}) as never, "org-1")
    ).resolves.toEqual([]);
  });

  it("maps invitation rows", async () => {
    const client = employerFake({
      routes: {
        employer_member_invitations: [
          {
            org_id: "org-1",
            id: "inv-1",
            email: "new@acme.test",
            role: "recruiter",
            status: "pending",
            expires_at: "2026-10-01T00:00:00Z",
            created_at: "2026-09-20T00:00:00Z",
          },
        ],
      },
    });
    await expect(getEmployerInvitations(client as never, "org-1")).resolves.toEqual([
      {
        id: "inv-1",
        email: "new@acme.test",
        role: "recruiter",
        status: "pending",
        expiresAt: "2026-10-01T00:00:00Z",
        createdAt: "2026-09-20T00:00:00Z",
      },
    ]);
  });
});

describe("employer jobs and promotions", () => {
  it("reads the organization's own jobs", async () => {
    const client = employerFake({ routes: { employer_jobs: [jobRow()] } });
    const jobs = await getEmployerJobs(client as never, "org-1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: "GenAI Security Engineer", status: "published" });
    expect(jobs[0].featured).toBeNull();
  });

  it("annotates a job with its active promotion", async () => {
    const client = employerFake({
      routes: {
        employer_jobs: [jobRow()],
        featured_listings: [featuredRow()],
      },
    });
    const jobs = await getEmployerJobs(client as never, "org-1");
    expect(jobs[0].featured).toEqual({
      tier: "ai_30d",
      isActive: true,
      startsAt: "2026-09-10T00:00:00Z",
      expiresAt: "2026-10-10T00:00:00Z",
    });
  });

  it("reports a promotion tier this build does not recognise instead of guessing", async () => {
    const client = employerFake({
      routes: { featured_listings: [featuredRow({ tier: "ai_7d" })] },
    });
    await expect(getUnrecognisedFeaturedTiers(client as never, "org-1")).resolves.toEqual(["ai_7d"]);
  });

  /**
   * A promotion belongs to a job in the same organization. Joining on job id
   * alone would let a listing for another org's job be attached to this
   * organization's row.
   */
  it("only attaches a promotion that belongs to the same organization", async () => {
    const client = employerFake({
      routes: {
        employer_jobs: [jobRow()],
        featured_listings: [featuredRow({ org_id: "org-2" })],
      },
    });
    const jobs = await getEmployerJobs(client as never, "org-1");
    expect(jobs[0].featured).toBeNull();
  });

  it("counts jobs by their stored status rather than a hardcoded total", () => {
    const make = (status: string): EmployerJob => ({
      id: status,
      title: status,
      location: null,
      status,
      postedAt: null,
      createdAt: null,
      featured: null,
    });
    expect(countJobsByStatus([make("published"), make("published"), make("draft"), make("closed")])).toEqual({
      total: 4,
      published: 2,
      draft: 1,
      closed: 1,
    });
    expect(countJobsByStatus([])).toEqual({ total: 0, published: 0, draft: 0, closed: 0 });
  });
});

describe("employer subscription, allowance and seats", () => {
  it("maps the stored subscription row to camelCase", async () => {
    const client = employerFake({ routes: { employer_subscriptions: [SUBSCRIPTION_ROW] } });
    await expect(getEmployerSubscription(client as never, "org-1")).resolves.toEqual({
      tier: "growth",
      status: "active",
      jobPostsIncluded: 10,
      periodStart: "2026-09-01T00:00:00Z",
      periodEnd: "2026-10-01T00:00:00Z",
    });
  });

  it("returns null when there is no subscription on file", async () => {
    await expect(
      getEmployerSubscription(employerFake({}) as never, "org-1")
    ).resolves.toBeNull();
  });

  it("derives remaining job posts and clamps an overspent allowance at zero", async () => {
    const client = employerFake({
      routes: {
        employer_job_post_credits: [
          { org_id: "org-1", total: 10, used: 4, granted_at: null, expires_at: null },
        ],
      },
    });
    await expect(getJobPostAllowance(client as never, "org-1")).resolves.toEqual({
      total: 10,
      used: 4,
      remaining: 6,
      grantedAt: null,
      expiresAt: null,
    });

    const overspent = employerFake({
      routes: {
        employer_job_post_credits: [
          { org_id: "org-1", total: 3, used: 5, granted_at: null, expires_at: null },
        ],
      },
    });
    const allowance = await getJobPostAllowance(overspent as never, "org-1");
    expect(allowance?.remaining).toBe(0);
  });

  it("merges the paid seat row with the entitled seat count from the RPC", async () => {
    const client = employerFake({
      routes: {
        recruiter_seats: [{ org_id: "org-1", count: 5, active_until: "2026-12-01T00:00:00Z" }],
      },
      rpcs: { odesseus_org_required_seat_count: 3 },
    });
    await expect(getEmployerSeats(client as never, "org-1")).resolves.toEqual({
      required: 3,
      active: 5,
      activeUntil: "2026-12-01T00:00:00Z",
      extraSeats: 2,
      isOverEntitled: false,
    });
  });

  it("flags an organization whose team exceeds its paid seats", async () => {
    const client = employerFake({
      routes: { recruiter_seats: [{ org_id: "org-1", count: 1, active_until: null }] },
      rpcs: { odesseus_org_required_seat_count: 4 },
    });
    const seats = await getEmployerSeats(client as never, "org-1");
    expect(seats).toMatchObject({ required: 4, active: 1, extraSeats: 0, isOverEntitled: true });
  });

  /**
   * The important negative case. When the entitlement RPC is unavailable the
   * service must not substitute a number — a fabricated 1 would either hide an
   * over-entitled team or invent a chargeable extra seat.
   */
  it("returns null when neither the paid seat row nor the entitlement RPC answers", async () => {
    await expect(getEmployerSeats(employerFake({}) as never, "org-1")).resolves.toBeNull();
  });

  it("still reports paid seats when the entitlement RPC is unavailable", async () => {
    const client = employerFake({
      routes: { recruiter_seats: [{ org_id: "org-1", count: 2, active_until: null }] },
    });
    const seats = await getEmployerSeats(client as never, "org-1");
    // Falls back to the single included seat rather than to a stale count.
    expect(seats).toMatchObject({ required: 1, active: 2, extraSeats: 1 });
  });

  it("returns null from the live seat RPC when it cannot answer", async () => {
    await expect(getActiveSeatCount(employerFake({}) as never, "org-1")).resolves.toBeNull();
    const ok = employerFake({ rpcs: { odesseus_org_live_seat_count: 3 } });
    await expect(getActiveSeatCount(ok as never, "org-1")).resolves.toBe(3);
  });
});

describe("employer job quota", () => {
  it("uses the granted allowance while the subscription is live", () => {
    const quota = resolveJobQuota(
      { tier: "growth", status: "active", jobPostsIncluded: 10, periodStart: null, periodEnd: null },
      { total: 10, used: 4, remaining: 6, grantedAt: null, expiresAt: null }
    );
    expect(quota).toEqual({ included: 10, used: 4, remaining: 6, canPublishJob: true });
  });

  it("falls back to the plan's own included count when no allowance row exists", () => {
    const quota = resolveJobQuota(
      { tier: "starter", status: "active", jobPostsIncluded: 3, periodStart: null, periodEnd: null },
      null
    );
    expect(quota).toEqual({ included: 3, used: 0, remaining: 3, canPublishJob: true });
  });

  /**
   * A past-due or canceled subscription entitles nothing. Showing the included
   * quota anyway would promise job posts the company has not paid for.
   */
  it("entitles nothing when the subscription is not live", () => {
    for (const status of ["past_due", "canceled", "incomplete"]) {
      expect(
        resolveJobQuota(
          { tier: "business", status, jobPostsIncluded: 25, periodStart: null, periodEnd: null },
          { total: 25, used: 2, remaining: 23, grantedAt: null, expiresAt: null }
        )
      ).toEqual({ included: 0, used: 2, remaining: 0, canPublishJob: false });
    }
  });

  it("refuses to publish once the allowance is spent", () => {
    const quota = resolveJobQuota(
      { tier: "starter", status: "active", jobPostsIncluded: 3, periodStart: null, periodEnd: null },
      { total: 3, used: 3, remaining: 0, grantedAt: null, expiresAt: null }
    );
    expect(quota).toMatchObject({ remaining: 0, canPublishJob: false });
  });

  it("returns null when there is no subscription at all", () => {
    expect(resolveJobQuota(null, null)).toBeNull();
  });
});

describe("employer publish capacity (2Q)", () => {
  const SUBSCRIPTION = {
    tier: "starter",
    status: "active",
    job_posts_included: 3,
    period_start: "2026-01-01T00:00:00Z",
    period_end: "2026-02-01T00:00:00Z",
  };

  function publishFake(options: {
    jobStatus?: string | null;
    subscription?: Record<string, unknown> | null;
    publishedCount?: number;
    updateError?: string | null;
  }) {
    const {
      jobStatus = "draft",
      subscription = SUBSCRIPTION,
      publishedCount = 0,
      updateError = null,
    } = options;
    const updateSpy = vi.fn(async () => ({
      data: { id: "job-1", status: "published" },
      error: updateError ? { message: updateError } : null,
    }));
    const from = (table: string) => {
      const chain = (value: unknown) => {
        const builder: Record<string, unknown> = {};
        let updateFailed: string | null = null;
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.update = (...args: unknown[]) => {
          (updateSpy as (...call: unknown[]) => unknown)(...args);
          updateFailed = updateError;
          return builder;
        };
        builder.maybeSingle = async () =>
          updateFailed
            ? { data: null, error: { message: updateFailed } }
            : { data: value, error: null };
        builder.then = (
          resolve: (value: { data: unknown; error: null; count?: number }) => unknown
        ) =>
          Promise.resolve({
            data: value,
            error: null,
            count: value as number | undefined,
          }).then(resolve);
        return builder;
      };
      if (table === "employer_jobs" && jobStatus === "__count__") {
        return chain(null);
      }
      if (table === "employer_jobs") {
        // The job-status fetch resolves the draft row; the capacity count is
        // answered by the head-count query below via the call order.
        return chain(jobStatus === null ? null : { status: jobStatus });
      }
      if (table === "employer_subscriptions") return chain(subscription);
      return chain(null);
    };
    // Answer order for publishJob: job fetch, subscription fetch,
    // published-count query, then the update.
    let calls = 0;
    const countingFrom = (table: string) => {
      calls += 1;
      if (table === "employer_jobs" && calls === 3) {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: publishedCount }).then(
            resolve as (value: unknown) => unknown
          );
        return builder;
      }
      return from(table);
    };
    return { client: { from: countingFrom } as never, updateSpy };
  }

  it("publishes a draft while plan capacity remains", async () => {
    const { client, updateSpy } = publishFake({ publishedCount: 2 });
    const result = await publishJob(client, "org-1", "job-1");
    expect(result).toMatchObject({ ok: true });
    expect(updateSpy).toHaveBeenCalledOnce();
  });

  it("rejects with at_capacity at exactly the Starter limit of 3", async () => {
    const { client, updateSpy } = publishFake({ publishedCount: 3 });
    const result = await publishJob(client, "org-1", "job-1");
    expect(result).toEqual({ ok: false, reason: "at_capacity" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects with no_credits when no live subscription backs the org", async () => {
    const { client, updateSpy } = publishFake({ subscription: null });
    const result = await publishJob(client, "org-1", "job-1");
    expect(result).toEqual({ ok: false, reason: "no_credits" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("maps the credit-claim trigger message to no_credits instead of throwing", async () => {
    const { client } = publishFake({
      publishedCount: 0,
      updateError: "no job post credits available for this employer",
    });
    const result = await publishJob(client, "org-1", "job-1");
    expect(result).toEqual({ ok: false, reason: "no_credits" });
  });
});

describe("employer overview", () => {
  const fullRoutes = {
    employer_members: [
      { org_id: "org-1", user_id: "user-1", role: "owner", created_at: "2026-01-04T10:00:00Z" },
      { org_id: "org-1", user_id: "user-2", role: "recruiter", created_at: "2026-02-01T10:00:00Z" },
    ],
    employer_organizations: [ORG_ROW],
    employer_subscriptions: [SUBSCRIPTION_ROW],
    employer_job_post_credits: [
      { org_id: "org-1", total: 10, used: 4, granted_at: null, expires_at: null },
    ],
    recruiter_seats: [{ org_id: "org-1", count: 3, active_until: null }],
    employer_jobs: [
      jobRow(),
      jobRow({ id: "job-2", title: "Staff Engineer", status: "draft" }),
    ],
    employer_member_invitations: [],
    featured_listings: [],
  };

  it("assembles one overview from every employer record", async () => {
    const client = employerFake({
      routes: fullRoutes,
      rpcs: { odesseus_org_required_seat_count: 3 },
    });
    const overview = await getEmployerOverview(client as never, "user-1");

    expect(overview.organization?.name).toBe("Acme Corp");
    expect(overview.needsOrganization).toBe(false);
    expect(overview.yourRole).toBe("owner");
    expect(overview.jobCounts).toEqual({ total: 2, published: 1, draft: 1, closed: 0 });
    expect(overview.quota).toEqual({ included: 10, used: 4, remaining: 6, canPublishJob: true });
    expect(overview.seats).toMatchObject({ required: 3, active: 3, extraSeats: 0 });
    expect(overview.members).toHaveLength(2);
    expect(overview.notices).toEqual([]);
  });

  it("reads the account once, from the auth record", async () => {
    const client = employerFake({
      routes: fullRoutes,
      rpcs: { odesseus_org_required_seat_count: 3 },
      authUser: {
        email: "owner@acme.test",
        user_metadata: { account_type: "employer", company_name: "Acme Corp" },
      },
    });
    const overview = await getEmployerOverview(client as never, "user-1");
    expect(overview.account).toEqual({
      userId: "user-1",
      email: "owner@acme.test",
      companyName: "Acme Corp",
      isEmployerAccount: true,
    });
  });

  /**
   * The state an employer actually lands in today: `employerSignup` creates the
   * auth user but does not provision an organization. The overview has to say
   * so rather than rendering an all-zero dashboard.
   */
  it("flags a missing organization instead of reporting zeros", async () => {
    const client = employerFake({
      routes: {},
      authUser: {
        email: "new@acme.test",
        user_metadata: { account_type: "employer", company_name: "Acme Corp" },
      },
    });
    const overview = await getEmployerOverview(client as never, "user-1");

    expect(overview.needsOrganization).toBe(true);
    expect(overview.organization).toBeNull();
    expect(overview.jobs).toEqual([]);
    expect(overview.jobCounts).toEqual({ total: 0, published: 0, draft: 0, closed: 0 });
    expect(overview.quota).toBeNull();
    expect(overview.account.companyName).toBe("Acme Corp");
  });

  it("raises a notice when the stored plan is not one this build recognises", async () => {
    const client = employerFake({
      routes: {
        ...fullRoutes,
        employer_subscriptions: [{ ...SUBSCRIPTION_ROW, tier: "enterprise" }],
      },
      rpcs: { odesseus_org_required_seat_count: 3 },
    });
    const overview = await getEmployerOverview(client as never, "user-1");
    expect(overview.notices).toContain("Your stored plan is not one this build recognises.");
    // The quota still reflects the stored record; only the label is withheld.
    expect(overview.subscription?.tier).toBe("enterprise");
  });

  it("still renders a working overview when every optional read is unavailable", async () => {
    const client = employerFake({
      routes: {
        employer_organizations: [ORG_ROW],
        employer_members: [{ org_id: "org-1", user_id: "user-1", role: "owner" }],
      },
    });
    const overview = await getEmployerOverview(client as never, "user-1");
    expect(overview.needsOrganization).toBe(false);
    expect(overview.subscription).toBeNull();
    expect(overview.seats).toBeNull();
    expect(overview.quota).toBeNull();
  });
});
