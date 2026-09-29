/**
 * Server-side reader for the public homepage job feed.
 *
 * Backed by the same query that serves `GET /api/jobs/home-feed`
 * (`src/lib/jobs/home-feed.ts`), so the server-rendered homepage and the API
 * can never show different jobs. The server reads the database directly
 * rather than fetch()-ing its own route: an internal read has no business
 * paying the public rate limit or making a network hop.
 *
 * There is no fixture fallback. A previous version returned
 * `HOMEPAGE_JOB_FIXTURES` outside production, which meant the marketing
 * homepage silently served invented companies and invented salaries on every
 * developer machine and in every non-production preview. A real product page
 * either shows real postings or shows its honest empty state — the carousel
 * already has one.
 *
 * The result is `EmployerJobsResult`-shaped (see `./homepage-types.ts`) so
 * `JobCarousel` and its clients are unchanged by this rewrite.
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readPublicHomeFeed } from "./home-feed";
import type { HomepageJob, HomepageJobsResult } from "./homepage-types";

/** One page of cards, matching the API's own default page size. */
const FEED_LIMIT = 24;

/** `work_arrangement` is stored lowercase; the UI vocabulary is capitalised. */
function workArrangement(value: string | null): HomepageJob["workArrangement"] {
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "onsite" || value === "on-site") return "On-site";
  return undefined;
}

/**
 * How recently the posting was published, as the carousel's freshness label.
 * Derived from a real timestamp, and omitted entirely when there is none.
 */
function freshnessLabel(publishedAt: string | null, discoveredAt: string): string | undefined {
  const iso = publishedAt ?? discoveredAt;
  if (!iso) return undefined;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return undefined;

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Just posted";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  return "Active";
}

export async function getHomepageJobs(): Promise<HomepageJobsResult> {
  try {
    const viewer = await createClient();
    const { data: auth } = await viewer.auth.getClaims();
    const service = createServiceClient();

    const feed = await readPublicHomeFeed(viewer, service, {
      limit: FEED_LIMIT,
      offset: 0,
      viewerId: auth?.claims?.sub ?? null,
    });

    const data: HomepageJob[] = feed.items.map((item) => ({
      id: item.id,
      title: item.title,
      company: item.company,
      location: item.location ?? undefined,
      workArrangement: workArrangement(item.workArrangement),
      // Absent when the source published none — never a default.
      ...(item.salaryText ? { salaryText: item.salaryText } : {}),
      ...(freshnessLabel(item.postedAt, item.discoveredAt)
        ? { freshnessLabel: freshnessLabel(item.postedAt, item.discoveredAt) }
        : {}),
      ...(item.applyUrl ? { applyUrl: item.applyUrl } : {}),
      // Only ever present when the backend returned a real verified score for
      // this signed-in viewer. Signed-out readers get no score at all.
      ...(item.matchScore !== undefined ? { matchScore: item.matchScore } : {}),
    }));

    return { status: "ok", data, source: "live" };
  } catch (error) {
    // The homepage must still render. Report the failure honestly through the
    // existing unavailable state so the carousel shows its retry affordance
    // rather than an empty feed that looks like "no jobs right now".
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_JOB_FEED] homepage read failed", message);
    return { status: "unavailable", reason: "Could not load jobs right now." };
  }
}
