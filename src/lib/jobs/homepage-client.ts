"use client";

/**
 * Browser-side reader for the public homepage job feed.
 *
 * The mobile splash is a client component with no server session, so it reads
 * the feed over HTTP from `GET /api/jobs/home-feed` — the same endpoint the
 * public contract already exposes, and the same query the server-rendered
 * homepage uses.
 *
 * One rule is enforced here rather than trusted to the endpoint: a client-side
 * read can never confirm whether the viewer is signed in, so a personalised
 * Match Score is always stripped before it reaches the carousel. A score is
 * only ever shown when the server that rendered the page (a server component
 * with a real session) supplied one.
 *
 * This is deliberately a separate module from `@/lib/jobs/homepage`: that one
 * imports Supabase server clients and must never enter a browser bundle.
 */

import type { HomepageJobsResult } from "./homepage-types";

type FeedResponse = {
  items?: Array<{
    id: string;
    title: string;
    company: string;
    companyLogoUrl?: string | null;
    sourceUrl?: string | null;
    location?: string | null;
    workArrangement?: string | null;
    salaryText?: string | null;
    applyUrl?: string | null;
    matchScore?: number;
  }>;
  error?: string;
};

/** `work_arrangement` arrives lowercase from the API; the UI is capitalised. */
function workArrangement(value: string | null | undefined) {
  if (value === "remote") return "Remote" as const;
  if (value === "hybrid") return "Hybrid" as const;
  if (value === "onsite" || value === "on-site") return "On-site" as const;
  return undefined;
}

/** Drops `matchScore` unconditionally. See the module header for why. */
function withoutMatchScore(result: HomepageJobsResult): HomepageJobsResult {
  if (result.status !== "ok") return result;
  return { ...result, data: result.data.map(({ matchScore: _matchScore, ...job }) => job) };
}

export async function getHomepageJobsClient(): Promise<HomepageJobsResult> {
  try {
    const response = await fetch("/api/jobs/home-feed", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { status: "unavailable", reason: "Could not load jobs right now." };
    }

    const payload = (await response.json()) as FeedResponse;
    if (!Array.isArray(payload.items)) {
      return { status: "unavailable", reason: "Could not load jobs right now." };
    }

    return {
      status: "ok",
      source: "live",
      data: payload.items.map((item) => ({
        id: item.id,
        title: item.title,
        company: item.company,
        ...(item.companyLogoUrl ? { companyLogoUrl: item.companyLogoUrl } : {}),
        ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(workArrangement(item.workArrangement)
          ? { workArrangement: workArrangement(item.workArrangement) }
          : {}),
        // Absent when the posting published none — never a default.
        ...(item.salaryText ? { salaryText: item.salaryText } : {}),
        ...(item.applyUrl ? { applyUrl: item.applyUrl } : {}),
      })),
    };
  } catch {
    return { status: "unavailable", reason: "Could not load jobs right now." };
  }
}

export { withoutMatchScore };
