/**
 * Homepage job feed mapping (F1).
 *
 * The real backend surface is `GET /api/jobs/home-feed`, which returns
 * `{ items, total, limit, offset }` where every item is a real, active
 * posting. Anonymous callers receive job facts only — the backend omits
 * `matchScore` when there is no candidate context to compute one from, and
 * this module never invents one either.
 *
 * This file is pure and client-safe: the server-rendered read that needs the
 * request's own origin and session cookie lives in `./home-feed-server`.
 */
import type { HomepageJob } from "./homepage-types";

export type HomeFeedItem = {
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
