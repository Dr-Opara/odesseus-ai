/**
 * INTEGRATION POINT — homepage live job feed backend (owned by OpenCode, not
 * yet shipped). `getHomepageJobs` is the single seam the homepage/mobile
 * splash job carousel talks through. In development/test it falls back to
 * `HOMEPAGE_JOB_FIXTURES`; in production, with no live source configured, it
 * returns an honest empty list rather than fabricated postings. Presentation
 * components only ever see `status`/`data` — never import the fixture file
 * directly and never branch on environment themselves.
 *
 * To wire this up once the backend ships: replace `fetchLiveHomepageJobs`
 * with a real fetch/server action call, keeping the exported types so
 * `JobCarousel` does not need to change.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { HOMEPAGE_JOB_FIXTURES } from "./homepage-fixtures";
import type { HomepageJob, HomepageJobsResult } from "./homepage-types";

/** INTEGRATION POINT: replace with a real fetch to OpenCode's homepage job-feed endpoint. */
async function fetchLiveHomepageJobs(): Promise<HomepageJob[] | null> {
  return null;
}

export async function getHomepageJobs(): Promise<HomepageJobsResult> {
  const live = await fetchLiveHomepageJobs();
  if (live) {
    return { status: "ok", data: live, source: "live" };
  }

  if (isProductionRuntime()) {
    return { status: "ok", data: [], source: "live" };
  }

  return { status: "ok", data: HOMEPAGE_JOB_FIXTURES, source: "fixture" };
}
