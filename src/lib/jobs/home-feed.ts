/**
 * Homepage job feed contract (F1).
 *
 * The real backend surface is `GET /api/jobs/home-feed`, which returns
 * `{ items, total, limit, offset }` where every item is a real, active
 * posting. Anonymous callers receive job facts only — the backend omits
 * `matchScore` when there is no candidate context to compute one from, and
 * this module never invents one either.
 *
 * This file is the single place the homepage maps that payload onto the
 * presentation shape the carousel renders. It exists so the server-rendered
 * homepage and the client-fetched mobile splash agree on the mapping.
 */
import { headers } from "next/headers";
import type { HomepageJob } from "./homepage-types";

const HOME_FEED_LIMIT = 6;

type HomeFeedItem = {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  workArrangement?: string | null;
  employmentType?: string | null;
  salaryText?: string | null;
  sourceUrl?: string | null;
  applyUrl?: string | null;
  matchScore?: number;
};

export type HomeFeedResponse = { items?: HomeFeedItem[] };

/** Map one backend feed item onto the carousel's card shape. */
export function toHomepageJob(item: HomeFeedItem): HomepageJob {
  const workArrangement =
    item.workArrangement === "Remote" || item.workArrangement === "Hybrid" || item.workArrangement === "On-site"
      ? item.workArrangement
      : undefined;

  return {
    id: item.id,
    title: item.title,
    company: item.company,
    // Employer postings are applied to in-app; an external URL is only used
    // when the source actually published one.
    applyUrl: item.applyUrl || item.sourceUrl || "/jobs",
    ...(item.location ? { location: item.location } : {}),
    ...(workArrangement ? { workArrangement } : {}),
    ...(item.salaryText ? { salaryText: item.salaryText } : {}),
    ...(item.employmentType ? { tags: [item.employmentType] } : {}),
    ...(typeof item.matchScore === "number" ? { matchScore: item.matchScore } : {}),
  };
}

export function toHomepageJobs(payload: HomeFeedResponse): HomepageJob[] {
  if (!Array.isArray(payload.items)) return [];
  return payload.items.map(toHomepageJob);
}

/**
 * Server-side read of the real home feed. Uses the request's own origin so
 * the authenticated session cookie travels with the call, which is what lets
 * the backend attach a real Match Score. Returns null when the feed cannot be
 * read so the caller can decide honestly (dev fixture vs. empty list) rather
 * than rendering invented postings.
 */
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
