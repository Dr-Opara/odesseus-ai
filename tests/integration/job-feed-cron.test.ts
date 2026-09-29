import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const runIngestionMock = vi.fn();

vi.mock("@/lib/jobs/feed-ingestion", () => ({
  runPublicFeedIngestion: (...args: unknown[]) => runIngestionMock(...args),
}));

describe("GET /api/cron/refresh-job-feed (2S)", () => {
  beforeEach(() => {
    runIngestionMock.mockReset();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects callers without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/refresh-job-feed/route");
    const response = await GET(new Request("http://localhost/x"));
    expect(response.status).toBe(401);
    expect(runIngestionMock).not.toHaveBeenCalled();
  });

  it("runs the tick and reports its summary", async () => {
    runIngestionMock.mockResolvedValue({
      sourcesConfigured: 2,
      sourcesSucceeded: 2,
      sourcesFailed: 0,
      postingsUpserted: 10,
      employerMirrored: 3,
      employerDeactivated: 0,
      deactivatedStale: 1,
      errors: [],
    });

    const { GET } = await import("@/app/api/cron/refresh-job-feed/route");
    const response = await GET(
      new Request("http://localhost/x", { headers: { authorization: "Bearer cron-secret" } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, postingsUpserted: 10, employerMirrored: 3 });
    expect(runIngestionMock).toHaveBeenCalledOnce();
  });
});
