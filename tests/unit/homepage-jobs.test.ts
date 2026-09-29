import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHomepageJobs, getHomepageJobsForRequest } from "@/lib/jobs/homepage";
import { toHomepageJob, toHomepageJobs } from "@/lib/jobs/home-feed";
import { HOMEPAGE_JOB_FIXTURES } from "@/lib/jobs/homepage-fixtures";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

/** Stub the real home-feed endpoint the carousel reads through. */
function stubFeed(handler: (url: string) => { status?: number; body: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const { status = 200, body } = handler(String(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_NODE_ENV === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("NODE_ENV", ORIGINAL_NODE_ENV);
  }
  if (ORIGINAL_VERCEL_ENV === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("VERCEL_ENV", ORIGINAL_VERCEL_ENV);
  }
});

describe("homepage feed mapping", () => {
  it("maps a real posting onto the carousel card", () => {
    const job = toHomepageJob({
      id: "posting-1",
      title: "Senior Backend Engineer",
      company: "Acme Robotics",
      location: "Remote",
      workArrangement: "Remote",
      employmentType: "Full-time",
      salaryText: "$150K – $190K",
      applyUrl: "/jobs/1",
    });

    expect(job).toEqual({
      id: "posting-1",
      title: "Senior Backend Engineer",
      company: "Acme Robotics",
      applyUrl: "/jobs/1",
      location: "Remote",
      workArrangement: "Remote",
      salaryText: "$150K – $190K",
      tags: ["Full-time"],
    });
  });

  it("keeps only a real work arrangement and never defaults a salary", () => {
    const job = toHomepageJob({
      id: "posting-2",
      title: "Data Analyst",
      company: "Fernbank Health",
      workArrangement: "onsite-full-time",
      salaryText: null,
    });

    expect(job.workArrangement).toBeUndefined();
    expect(job.salaryText).toBeUndefined();
  });

  it("omits matchScore when the backend did not send one", () => {
    const job = toHomepageJob({ id: "posting-3", title: "Role", company: "Company" });
    expect(job.matchScore).toBeUndefined();
  });

  it("keeps a Match Score the backend actually returned", () => {
    const job = toHomepageJob({ id: "posting-4", title: "Role", company: "Company", matchScore: 91 });
    expect(job.matchScore).toBe(91);
  });

  it("returns an empty list when the payload has no items", () => {
    expect(toHomepageJobs({})).toEqual([]);
  });
});

describe("getHomepageJobs", () => {
  it("reads the real home-feed endpoint when it responds", async () => {
    const spy = stubFeed(() => ({
      body: { items: [{ id: "posting-1", title: "Role", company: "Company" }], total: 1 },
    }));

    const result = await getHomepageJobs();

    expect(spy.mock.calls[0][0]).toContain("/api/jobs/home-feed");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("live");
      expect(result.data).toHaveLength(1);
    }
  });

  it("returns the dev fixture outside production only when the endpoint is unreachable", async () => {
    stubFeed(() => ({ status: 500, body: { error: "Could not load jobs." } }));

    const result = await getHomepageJobs();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("fixture");
      expect(result.data).toEqual(HOMEPAGE_JOB_FIXTURES);
    }
  });

  it("never returns the fixture in production — an honest empty list instead", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFeed(() => ({ status: 500, body: { error: "Could not load jobs." } }));

    const result = await getHomepageJobs();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("live");
      expect(result.data).toEqual([]);
    }
  });
});

describe("getHomepageJobsForRequest (server-rendered homepage)", () => {
  // The real call derives its origin from the incoming request; tests pin it.
  const ORIGIN = { origin: "https://odesseus.test", cookie: "session=1" };

  it("strips Match Scores for a logged-out visitor even if the payload carried one", async () => {
    stubFeed(() => ({
      body: { items: [{ id: "posting-1", title: "Role", company: "Company", matchScore: 88 }] },
    }));

    const result = await getHomepageJobsForRequest(false, ORIGIN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].matchScore).toBeUndefined();
    }
  });

  it("keeps the Match Score for a signed-in candidate the backend scored", async () => {
    stubFeed(() => ({
      body: { items: [{ id: "posting-1", title: "Role", company: "Company", matchScore: 88 }] },
    }));

    const result = await getHomepageJobsForRequest(true, ORIGIN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].matchScore).toBe(88);
    }
  });

  it("forwards the session cookie so the backend can score the feed", async () => {
    const spy = stubFeed(() => ({ body: { items: [] } }));

    await getHomepageJobsForRequest(true, ORIGIN);

    const init = spy.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)?.cookie).toBe("session=1");
  });
});

describe("dev fixtures stay honest", () => {
  it("never seeds matchScore on any fixture entry", () => {
    for (const job of HOMEPAGE_JOB_FIXTURES) {
      expect(job.matchScore).toBeUndefined();
    }
  });

  it("only shows a salary line when the posting actually provides one", () => {
    expect(HOMEPAGE_JOB_FIXTURES.filter((job) => !job.salaryText).length).toBeGreaterThan(0);
  });
});
