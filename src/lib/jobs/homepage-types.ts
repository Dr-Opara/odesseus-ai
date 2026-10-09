/** Public homepage job feed contract (F1-D). Distinct from `src/lib/jobs/types.ts`'s
 * `NormalizedJobPosting`, which belongs to the backend ingestion/discovery pipeline. */
export type HomepageJob = {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  sourceUrl?: string;
  location?: string;
  workArrangement?: "Remote" | "Hybrid" | "On-site";
  salaryText?: string;
  freshnessLabel?: string;
  tags?: string[];
  applyUrl?: string;
  /** Only ever present when a signed-in user's real Match Score was returned by the backend. */
  matchScore?: number;
};

/**
 * The feed result.
 *
 * `source` is a single-valued marker rather than a choice. It used to be
 * `"live" | "fixture"`, back when `getHomepageJobs` returned
 * `HOMEPAGE_JOB_FIXTURES` outside production — which meant a preview deploy or
 * a developer's own machine served invented companies and invented salaries on
 * the public marketing homepage. Both readers now hit the real public feed, so
 * narrowing the union makes a fixture path a compile error rather than
 * something to catch in review.
 *
 * `unavailable` is deliberately distinct from an empty `ok` list: "we could not
 * load jobs" and "there are no jobs right now" are different statements, and
 * the carousel presents them differently.
 */
export type HomepageJobsResult =
  | { status: "ok"; data: HomepageJob[]; source: "live" }
  | { status: "unavailable"; reason: string };
