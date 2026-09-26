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
// each case starts with empty buckets instead of inheriting a previous
// test's counts.
async function freshRoute() {
  vi.resetModules();
  return import("@/app/api/job-reports/route");
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/job-reports", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const REPORT = {
  id: "r1",
  job_id: "11111111-1111-4111-8111-111111111111",
  reason: "Scam",
  details: "Asked for payment",
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * A job_reports builder that mirrors the real PostgREST behaviour the service
 * depends on:
 *   - a SELECT is projected down to exactly the requested columns, so asking
 *     for CANDIDATE_COLUMNS genuinely withholds moderation_note
 *   - an INSERT and a SELECT are distinguishable, because the service does a
 *     duplicate-check SELECT before the INSERT
 */
function jobReportsBuilder(opts: {
  duplicateRows?: Array<Record<string, unknown>>;
  insertData?: unknown;
  insertError?: unknown;
  selectData?: unknown;
  selectError?: unknown;
}) {
  const builder: Record<string, unknown> = {};
  const state: { mode: "select" | "insert"; columns: string[] } = {
    mode: "select",
    columns: [],
  };

  for (const m of ["eq", "neq", "order", "limit", "delete", "update"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.select = vi.fn((columns: string) => {
    state.columns = String(columns)
      .split(",")
      .map((c) => c.trim());
    return builder;
  });
  builder.insert = vi.fn(() => {
    state.mode = "insert";
    return builder;
  });

  const project = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const column of state.columns) out[column] = row[column];
    return out;
  };

  const resolve = () => {
    if (state.mode === "insert") {
      return Promise.resolve({ data: opts.insertData ?? null, error: opts.insertError ?? null });
    }
    if (opts.selectData !== undefined) {
      // Even the explicit-select shortcut honours the column projection, so a
      // row that carries moderation_note is withheld exactly as PostgREST
      // would withhold it.
      const data = opts.selectData;
      return Promise.resolve({
        data: Array.isArray(data) ? data.map(project) : data,
        error: opts.selectError ?? null,
      });
    }
    return Promise.resolve({
      data: (opts.duplicateRows ?? []).map(project),
      error: null,
    });
  };

  builder.maybeSingle = vi.fn(resolve);
  builder.single = vi.fn(resolve);
  builder.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
  return builder;
}

function candidateClient(opts: {
  job?: unknown;
  duplicateRows?: Array<Record<string, unknown>>;
  insertData?: unknown;
  insertError?: unknown;
  selectData?: unknown;
  selectError?: unknown;
} = {}) {
  return fakeAuthedClient({
    userId: "user-a",
    from: (table: string) => {
      if (table === "job_reports") return jobReportsBuilder(opts);
      if (table === "job_opportunities") {
        // `in` rather than `??`, because a caller passing `job: null` is
        // explicitly simulating "the ownership lookup found nothing".
        return fakeQueryResult("job" in opts ? opts.job : { id: REPORT.job_id });
      }
      return fakeQueryResult(null);
    },
  });
}

describe("GET /api/job-reports", () => {
  beforeEach(() => createClientMock.mockReset());

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { GET } = await freshRoute();
    expect((await GET()).status).toBe(401);
  });

  it("is never publicly cacheable", async () => {
    createClientMock.mockResolvedValue(candidateClient({ selectData: [REPORT] }));
    const { GET } = await freshRoute();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns the caller's reports", async () => {
    createClientMock.mockResolvedValue(candidateClient({ selectData: [REPORT] }));
    const { GET } = await freshRoute();
    const body = await (await GET()).json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].reason).toBe("Scam");
  });

  it("never returns the internal moderation note to the reporter", async () => {
    createClientMock.mockResolvedValue(
      candidateClient({
        selectData: [{ ...REPORT, moderation_note: "internal only" }],
      })
    );
    const { GET } = await freshRoute();
    const body = await (await GET()).json();
    // The service asks PostgREST for an explicit column list that omits
    // moderation_note, so the internal note is never projected out to the
    // reporter even though the row carries it.
    expect(body.reports[0]).not.toHaveProperty("moderation_note");
  });

  it("returns 500 when the read fails", async () => {
    createClientMock.mockResolvedValue(
      candidateClient({ selectData: null, selectError: { message: "db down" } })
    );
    const { GET } = await freshRoute();
    expect((await GET()).status).toBe(500);
  });
});

describe("POST /api/job-reports", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    isAdminMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an untrusted origin before doing any work", async () => {
    createClientMock.mockResolvedValue(candidateClient());
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest({ reason: "Scam" }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });

  it("rejects an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue(fakeAuthedClient({ userId: null }));
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest({ reason: "Scam" }))).status).toBe(401);
  });

  it("files a valid report", async () => {
    createClientMock.mockResolvedValue(candidateClient({ insertData: REPORT }));
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(
      postRequest({ jobId: REPORT.job_id, reason: "Scam", details: "Asked for payment" })
    );
    expect(response.status).toBe(201);
    expect((await response.json()).report.reason).toBe("Scam");
  });

  it("rejects a reason outside the fixed set", async () => {
    createClientMock.mockResolvedValue(candidateClient());
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest({ reason: "Spam" }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-uuid job id", async () => {
    createClientMock.mockResolvedValue(candidateClient());
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest({ jobId: "not-a-uuid", reason: "Scam" }))).status).toBe(400);
  });

  it("rejects details beyond the stored cap", async () => {
    createClientMock.mockResolvedValue(candidateClient());
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest({ reason: "Other", details: "x".repeat(2001) }));
    expect(response.status).toBe(400);
  });

  it("404s when the job is not the caller's", async () => {
    createClientMock.mockResolvedValue(candidateClient({ job: null }));
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest({ jobId: REPORT.job_id, reason: "Scam" }));
    expect(response.status).toBe(404);
  });

  it("409s on a duplicate report of the same job and reason", async () => {
    createClientMock.mockResolvedValue(
      candidateClient({ duplicateRows: [{ ...REPORT }] })
    );
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    const response = await POST(postRequest({ jobId: REPORT.job_id, reason: "Scam" }));
    expect(response.status).toBe(409);
  });

  it("rate limits a user after five reports in an hour", async () => {
    createClientMock.mockResolvedValue(candidateClient({ insertData: REPORT }));
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(postRequest({ reason: "Other" }));
      statuses.push(response.status);
    }
    // The first five pass the limiter; the sixth is throttled.
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("sets Retry-After when throttled", async () => {
    createClientMock.mockResolvedValue(candidateClient({ insertData: REPORT }));
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    let throttled: Response | null = null;
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(postRequest({ reason: "Other" }));
      if (response.status === 429) throttled = response;
    }
    expect(Number(throttled!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("rate limits by network independently of the user bucket", async () => {
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");

    // Twenty-one distinct users behind one IP: the per-user bucket never
    // fills, but the per-network bucket must.
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      createClientMock.mockResolvedValue(
        fakeAuthedClient({
          userId: `user-${i}`,
          from: (table: string) =>
            table === "job_reports"
              ? jobReportsBuilder({ insertData: REPORT })
              : fakeQueryResult(null),
        })
      );
      const response = await POST(
        postRequest({ reason: "Other" }, { "x-forwarded-for": "203.0.113.9" })
      );
      statuses.push(response.status);
    }
    expect(statuses[0]).toBe(201);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it("returns 500 when the insert fails", async () => {
    createClientMock.mockResolvedValue(
      candidateClient({ insertError: { message: "rls violation" } })
    );
    const { POST } = await freshRoute();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.ai");
    expect((await POST(postRequest({ jobId: REPORT.job_id, reason: "Scam" }))).status).toBe(500);
  });
});
