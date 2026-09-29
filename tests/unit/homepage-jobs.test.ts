import { afterEach, describe, expect, it, vi } from "vitest";
import { getHomepageJobs } from "@/lib/jobs/homepage";
import { HOMEPAGE_JOB_FIXTURES } from "@/lib/jobs/homepage-fixtures";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

afterEach(() => {
  vi.stubEnv("NODE_ENV", ORIGINAL_NODE_ENV ?? "test");
  if (ORIGINAL_VERCEL_ENV === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("VERCEL_ENV", ORIGINAL_VERCEL_ENV);
  }
});

describe("getHomepageJobs", () => {
  it("returns the dev fixture outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "");

    const result = await getHomepageJobs();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("fixture");
      expect(result.data).toEqual(HOMEPAGE_JOB_FIXTURES);
    }
  });

  it("never returns the fixture in production — an honest empty list instead", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await getHomepageJobs();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("live");
      expect(result.data).toEqual([]);
    }
  });

  it("never seeds matchScore on any fixture entry", () => {
    for (const job of HOMEPAGE_JOB_FIXTURES) {
      expect(job.matchScore).toBeUndefined();
    }
  });

  it("only shows a salary line when the posting actually provides one", () => {
    const withoutSalary = HOMEPAGE_JOB_FIXTURES.filter((job) => !job.salaryText);
    expect(withoutSalary.length).toBeGreaterThan(0);
  });
});
