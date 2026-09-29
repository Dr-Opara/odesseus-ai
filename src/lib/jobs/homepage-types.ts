/** Public homepage job feed contract (F1-D). Distinct from `src/lib/jobs/types.ts`'s
 * `NormalizedJobPosting`, which belongs to the backend ingestion/discovery pipeline. */
export type HomepageJob = {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  location?: string;
  workArrangement?: "Remote" | "Hybrid" | "On-site";
  salaryText?: string;
  freshnessLabel?: string;
  tags?: string[];
  applyUrl?: string;
  /** Only ever present when a signed-in user's real Match Score was returned by the backend. */
  matchScore?: number;
};

export type HomepageJobsResult =
  | { status: "ok"; data: HomepageJob[]; source: "live" | "fixture" }
  | { status: "unavailable"; reason: string };
