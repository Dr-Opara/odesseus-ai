import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The homepage job feed is now backed by the real public feed query
 * (`src/lib/jobs/home-feed.ts`). These tests are static guards rather than
 * database tests, because the real query needs a live Supabase project; the
 * behavioural coverage for the query itself lives in
 * `tests/integration/job-feed-api.test.ts`.
 *
 * The guards that matter here are the two the previous fixture design made
 * impossible to state:
 *
 *  1. There is no fixture module any more, so a production deploy cannot serve
 *     invented companies or invented salaries by falling back to one.
 *  2. Neither the server reader nor the browser reader can invent a Match
 *     Score: the server one only forwards a score the backend returned for the
 *     signed-in viewer, and the browser one strips scores unconditionally.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(() => {
  vi.unstubAllEnvs();
});

const root = process.cwd();

function readSource(relative: string) {
  return readFileSync(join(root, relative), "utf8");
}

/** Removes comments so prose naming the retired fixture is not read as a reference. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the homepage has no fixture fallback", () => {
  it("the fixture module is gone", () => {
    expect(existsSync(join(root, "src/lib/jobs/homepage-fixtures.ts"))).toBe(false);
  });

  it("no source file references the retired fixture", () => {
    for (const file of [
      "src/lib/jobs/homepage.ts",
      "src/lib/jobs/homepage-client.ts",
      "src/lib/jobs/home-feed.ts",
      "src/components/homepage-job-feed.tsx",
      "src/components/job-carousel.tsx",
      "src/components/homepage-body.tsx",
      "src/app/page.tsx",
    ]) {
      // Comments are stripped: `homepage.ts` names the retired fixture in its
      // doc block to explain why the fallback is gone, which is the opposite
      // of referencing it.
      expect(
        stripComments(readSource(file)),
        `${file} must not reference the homepage fixture`
      ).not.toMatch(/HOMEPAGE_JOB_FIXTURES/);
    }
  });

  it("the server reader returns source 'live' and never 'fixture'", () => {
    const source = readSource("src/lib/jobs/homepage.ts");
    expect(source).toContain('source: "live"');
    expect(source).not.toMatch(/source:\s*"fixture"/);
    // No environment gate around the data source: production and development
    // read the same real feed, which is the point.
    expect(source).not.toContain("isProductionRuntime");
  });
});

describe("the homepage reader is backed by the real feed query", () => {
  it("the server reader calls the shared public feed service", () => {
    const source = readSource("src/lib/jobs/homepage.ts");
    expect(source).toContain("readPublicHomeFeed");
    expect(source).toContain("createServiceClient");
  });

  it("the public API route calls the same shared service", () => {
    const source = readSource("src/app/api/jobs/home-feed/route.ts");
    expect(source).toContain("readPublicHomeFeed");
  });

  it("the shared service reads only active postings and never defaults a salary", () => {
    const source = readSource("src/lib/jobs/home-feed.ts");
    expect(source).toContain('.eq("is_active", true)');
    // A salary is passed through or omitted; the query must not invent one.
    expect(source).toContain("salaryText: item.salary_text");
    expect(source).not.toMatch(/salaryText:\s*"\$/);
  });

  it("the shared service attaches a Match Score only from a real scored row", () => {
    const source = readSource("src/lib/jobs/home-feed.ts");
    expect(source).toContain("match_score");
    // The score is read through the viewer's own session client, so RLS
    // scopes it to them. A service client here would leak another
    // candidate's score.
    expect(source).toContain("viewerClient");
    expect(source).toContain("...(matchScore !== undefined ? { matchScore } : {})");
  });

  it("an anonymous viewer is never given a score", () => {
    const source = readSource("src/lib/jobs/home-feed.ts");
    expect(source).toContain("if (viewerId && items.length > 0)");
  });
});

describe("browser-side reads cannot show personalization", () => {
  it("the client reader strips Match Score unconditionally", () => {
    const source = readSource("src/lib/jobs/homepage-client.ts");
    expect(source).toContain("withoutMatchScore");
    expect(source).toMatch(/matchScore: _matchScore/);
  });

  it("the client reader goes over HTTP, never importing server Supabase", () => {
    const source = readSource("src/lib/jobs/homepage-client.ts");
    expect(source).toContain("/api/jobs/home-feed");
    expect(source).not.toContain("@/lib/supabase/server");
    expect(source).not.toContain("@/lib/jobs/homepage\"");
  });

  it("the carousel component does not import the server reader", () => {
    const source = readSource("src/components/homepage-job-feed.tsx");
    expect(source).toContain("homepage-client");
    expect(source).not.toMatch(/from\s+["']@\/lib\/jobs\/homepage["']/);
  });
});
