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

function feedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    company_name: "Acme",
    title: "Engineer",
    location: "Remote",
    work_arrangement: "remote",
    employment_type: "Full-time",
    salary_text: "$120k",
    source_key: "greenhouse:acme",
    external_id: "job-1",
    provider: "greenhouse",
    source_url: "https://boards.example/acme/job-1",
    apply_url: "https://boards.example/acme/job-1/apply",
    published_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("GET /api/jobs/home-feed (2S)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
  });

  function serviceWith(rows: unknown[] | null, count: number | null = null, error: unknown = null) {
    createServiceClientMock.mockReturnValue({
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.order = () => builder;
        builder.range = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            error ? { data: null, error, count: null } : { data: rows, error: null, count }
          ).then(resolve as (value: unknown) => unknown);
        return builder;
      },
    });
  }

  it("serves active postings and excludes closed or stale rows server-side", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const fromSpy = vi.fn(() => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = vi.fn(() => builder);
      builder.order = () => builder;
      builder.range = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [feedRow()], error: null, count: 1 }).then(
          resolve as (value: unknown) => unknown
        );
      return builder;
    });
    createServiceClientMock.mockReturnValue({ from: fromSpy });

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    // The active-only filter is applied in the database, not in JS.
    const eqCalls = (fromSpy.mock.results[0].value.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(["is_active", true]);
  });

  it("leaves missing salary absent and never leaks internals", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    serviceWith([feedRow({ salary_text: null })], 1);

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].salaryText).toBeNull();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("match_breakdown");
  });

  it("omits Match Score for anonymous callers", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    serviceWith([feedRow()], 1);

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).not.toHaveProperty("matchScore");
  });

  it("attaches a real verified score for signed-in candidates who have one", async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === "public_job_posts") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.order = () => builder;
        builder.range = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [feedRow()], error: null, count: 1 }).then(
            resolve as (value: unknown) => unknown
          );
        return builder;
      }
      if (table === "job_opportunities") {
        return fakeQueryResult([
          { source: "greenhouse:acme", external_id: "job-1", match_score: 91 },
        ]);
      }
      return fakeQueryResult(null);
    });
    createClientMock.mockResolvedValue(
      fakeAuthedClient({ userId: "user-1", from: fromSpy })
    );
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "public_job_posts") {
            const builder: Record<string, unknown> = {};
            builder.select = () => builder;
            builder.eq = () => builder;
            builder.order = () => builder;
            builder.range = () => builder;
            builder.then = (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: [feedRow()], error: null, count: 1 }).then(
                resolve as (value: unknown) => unknown
              );
            return builder;
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].matchScore).toBe(91);
  });

  it("omits the score when the candidate has insufficient context", async () => {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: "user-1",
        from: (table: string) =>
          table === "job_opportunities" ? fakeQueryResult([]) : fakeQueryResult(null),
      })
    );
    serviceWith([feedRow()], 1);

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).not.toHaveProperty("matchScore");
  });

  it("rejects invalid parameters and reports infrastructure failure cleanly", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    serviceWith(null, null);

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const bad = await GET(new Request("http://localhost/api/jobs/home-feed?limit=9999"));
    expect(bad.status).toBe(400);

    serviceWith(null, null, { message: "db down" });
    const broken = await GET(new Request("http://localhost/api/jobs/home-feed"));
    const body = await broken.json();
    expect(broken.status).toBe(500);
    expect(body.error).toBe("Could not load jobs.");
    expect(JSON.stringify(body)).not.toContain("db down");
  });

  it("caps one company at three cards per page", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const rows = Array.from({ length: 6 }, (_, i) =>
      feedRow({ id: `post-${i}`, company_name: "Acme", external_id: `job-${i}` })
    );
    serviceWith(rows, 6);

    const { GET } = await import("@/app/api/jobs/home-feed/route");
    const response = await GET(new Request("http://localhost/api/jobs/home-feed?limit=6"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(3);
    expect(body.total).toBe(6);
  });
});
