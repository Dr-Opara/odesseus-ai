/**
 * Homepage live job feed (F1).
 *
 * `getHomepageJobs` is the client-side seam the mobile splash job carousel
 * talks through: it calls the real public `GET /api/jobs/home-feed` endpoint.
 * `getHomepageJobsForRequest` is the server-side equivalent used by the
 * server-rendered homepage, so the authenticated session cookie travels with
 * the request and the backend can attach a real Match Score.
 *
 * Production never returns fixtures. Development and test fall back to
 * `HOMEPAGE_JOB_FIXTURES` only when the real endpoint is unreachable, so local
 * UI work never depends on a live session. Presentation components only ever
 * see `status`/`data` — they never import the fixture file directly and never
 * branch on the environment themselves.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { HOMEPAGE_JOB_FIXTURES } from "./homepage-fixtures";
import { fetchHomeFeedJobs, toHomepageJobs, type HomeFeedResponse } from "./home-feed";
import type { HomepageJob, HomepageJobsResult } from "./homepage-types";

const HOME_FEED_LIMIT = 6;

/** Real fetch to the homepage job-feed endpoint. Null when unreachable. */
async function fetchLiveHomepageJobs(): Promise<HomepageJob[] | null> {
  try {
    const response = await fetch(`/api/jobs/home-feed?limit=${HOME_FEED_LIMIT}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return toHomepageJobs((await response.json()) as HomeFeedResponse);
  } catch {
    return null;
  }
}

export async function getHomepageJobs(): Promise<HomepageJobsResult> {
  const live = await fetchLiveHomepageJobs();
  return resolveHomepageJobs(live);
}

/**
 * Server-rendered homepage read. `signedIn` is resolved from the auth session
 * on the server, so logged-out visitors never receive a Match Score even if a
 * payload somehow carried one.
 */
export async function getHomepageJobsForRequest(
  signedIn: boolean,
  options?: { origin?: string; cookie?: string | null }
): Promise<HomepageJobsResult> {
  const live = await fetchHomeFeedJobs(options);
  const result = resolveHomepageJobs(live);
  if (result.status !== "ok" || signedIn) return result;
  return { ...result, data: stripMatchScores(result.data) };
}

function stripMatchScores(jobs: HomepageJob[]): HomepageJob[] {
  return jobs.map(({ matchScore: _matchScore, ...job }) => job);
}

function resolveHomepageJobs(live: HomepageJob[] | null): HomepageJobsResult {
  if (live) {
    return { status: "ok", data: live, source: "live" };
  }
  if (isProductionRuntime()) {
    return { status: "ok", data: [], source: "live" };
  }
  return { status: "ok", data: HOMEPAGE_JOB_FIXTURES, source: "fixture" };
}
