/**
 * Server-side read of the public home feed (F1).
 *
 * Split from `./home-feed` because the mapping is shared with the client while
 * this read needs `next/headers`: the request's own origin and session cookie
 * are what let the backend attach a real Match Score to the response. Kept in
 * a server-only module so the client bundle never pulls in a server-only API.
 */
import { headers } from "next/headers";
import { toHomepageJobs, type HomeFeedResponse } from "./home-feed";
import type { HomepageJob } from "./homepage-types";

const HOME_FEED_LIMIT = 6;

export async function fetchHomeFeedJobs(options?: {
  /** Overrides the request-derived origin. Used by tests. */
  origin?: string;
  cookie?: string | null;
}): Promise<HomepageJob[] | null> {
  try {
    let origin = options?.origin;
    let cookie = options?.cookie;

    if (origin === undefined) {
      const requestHeaders = await headers();
      const host =
        requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? null;
      if (!host) return null;
      const proto =
        requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      origin = `${proto}://${host}`;
      cookie = requestHeaders.get("cookie");
    }

    const response = await fetch(`${origin}/api/jobs/home-feed?limit=${HOME_FEED_LIMIT}`, {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    });
    if (!response.ok) return null;
    return toHomepageJobs((await response.json()) as HomeFeedResponse);
  } catch {
    return null;
  }
}
