/**
 * Server-rendered homepage feed read (F1).
 *
 * Server-only: it derives the request's own origin and forwards the session
 * cookie so the backend can attach a real Match Score for a signed-in
 * candidate, then strips that score for a logged-out visitor. A logged-out
 * visitor never sees personalization, even if a payload somehow carried one.
 */
import { fetchHomeFeedJobs } from "./home-feed-server";
import { resolveHomepageJobs } from "./homepage";
import type { HomepageJob, HomepageJobsResult } from "./homepage-types";

export async function getHomepageJobsForRequest(
  signedIn: boolean,
  options?: { origin?: string; cookie?: string | null }
): Promise<HomepageJobsResult> {
  const result = resolveHomepageJobs(await fetchHomeFeedJobs(options));
  if (result.status !== "ok" || signedIn) return result;
  return { ...result, data: stripMatchScores(result.data) };
}

function stripMatchScores(jobs: HomepageJob[]): HomepageJob[] {
  return jobs.map(({ matchScore: _matchScore, ...job }) => job);
}
