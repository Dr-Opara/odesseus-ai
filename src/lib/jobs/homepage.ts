/**
 * Homepage live job feed (F1).
 *
 * `getHomepageJobs` is the client-side seam the mobile splash job carousel
 * talks through: it calls the real public `GET /api/jobs/home-feed` endpoint.
 * `getHomepageJobsForRequest` (in `./homepage-server`) is the server-side
 * equivalent used by the server-rendered homepage, so the authenticated
 * session cookie travels with the request and the backend can attach a real
 * Match Score.
 *
 * Production never returns fixtures. Development and test fall back to
 * `HOMEPAGE_JOB_FIXTURES` only when the real endpoint is unreachable, so local
 * UI work never depends on a live session. Presentation components only ever
 * see `status`/`data` — they never import the fixture file directly and never
 * branch on the environment themselves.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { HOMEPAGE_JOB_FIXTURES } from "./homepage-fixtures";
import { toHomepageJobs, type HomeFeedResponse } from "./home-feed";
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
  return resolveHomepageJobs(await fetchLiveHomepageJobs());
}

/**
 * The one place the fixture fallback is decided. A live response always wins;
 * an unreachable endpoint yields an empty list in production (an honest
 * "nothing to show" rather than invented postings) and the dev fixture
 * everywhere else.
 */
export function resolveHomepageJobs(live: HomepageJob[] | null): HomepageJobsResult {
  if (live) {
    return { status: "ok", data: live, source: "live" };
  }
  if (isProductionRuntime()) {
    return { status: "ok", data: [], source: "live" };
  }
  return { status: "ok", data: HOMEPAGE_JOB_FIXTURES, source: "fixture" };
}
