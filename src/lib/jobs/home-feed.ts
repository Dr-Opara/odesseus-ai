/**
 * Public homepage job feed — the single query behind `GET /api/jobs/home-feed`.
 *
 * Two consumers share it and must not drift:
 *
 *  1. the API route (`src/app/api/jobs/home-feed/route.ts`), which serves
 *     browser callers, and
 *  2. `getHomepageJobs` (`src/lib/jobs/homepage.ts`), which the server-rendered
 *     homepage uses so the first paint is already populated.
 *
 * The server path deliberately reads the database directly rather than
 * fetch()-ing its own route: a server component calling its own HTTP endpoint
 * would serialise a pointless request through the network stack, and — more
 * importantly — would route an internal read through the public rate limiter.
 *
 * Product rules enforced here, not in the caller:
 *
 *  - Only real, active postings. Closed and stale rows are excluded
 *    server-side so no client can ask for them back.
 *  - An anonymous caller never receives a Match Score. There is no candidate
 *    context to compute one from, and a default would be a fabrication.
 *  - A signed-in caller receives `matchScore` only where their own verified
 *    scoring row already exists for that posting. No row, no score.
 *  - `salaryText` is passed through or omitted. It is never defaulted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** At most this many cards per company on one page; refilled from the same
 * recency order so different employers stay visible. */
const MAX_PER_COMPANY = 3;

/** Extra rows pulled so the per-company cap can be filled from one round trip. */
const REFILL_EXTRA = 30;

type FeedRow = {
  id: string;
  company_name: string;
  title: string;
  location: string | null;
  work_arrangement: string | null;
  employment_type: string | null;
  salary_text: string | null;
  source_key: string;
  external_id: string;
  provider: string;
  source_url: string | null;
  apply_url: string | null;
  published_at: string | null;
  last_seen_at: string;
};

const FEED_COLUMNS =
  "id,company_name,title,location,work_arrangement,employment_type,salary_text,source_key,external_id,provider,source_url,apply_url,published_at,last_seen_at";

/** One feed item in the shape the public contract exposes. */
export type PublicFeedItem = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  workArrangement: string | null;
  employmentType: string | null;
  /** Absent when the source did not provide one; never defaulted. */
  salaryText: string | null;
  source: string;
  sourceUrl: string | null;
  /** Employer postings apply in-app; no external URL is fabricated. */
  applyUrl: string | null;
  postedAt: string | null;
  discoveredAt: string;
  /** Present only when the viewer's own verified scoring row exists. */
  matchScore?: number;
};

export type PublicHomeFeed = {
  items: PublicFeedItem[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * Reads the public feed.
 *
 * `viewerClient` is the caller's own session client and may be unauthenticated;
 * `service` is the backend-owned read client for the public table. Scores are
 * read through `viewerClient` so RLS scopes them to the viewer — a service
 * client would happily return another candidate's score.
 */
export async function readPublicHomeFeed(
  viewerClient: SupabaseClient,
  service: SupabaseClient,
  input: { limit: number; offset: number; viewerId: string | null }
): Promise<PublicHomeFeed> {
  const { limit, offset, viewerId } = input;

  const [{ data: rows, error: rowsError }, { count, error: countError }] = await Promise.all([
    service
      .from("public_job_posts")
      .select(FEED_COLUMNS)
      .eq("is_active", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit + REFILL_EXTRA - 1),
    service
      .from("public_job_posts")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  if (rowsError) throw new Error(rowsError.message);
  if (countError) throw new Error(countError.message);

  const seen = new Map<string, number>();
  const items: FeedRow[] = [];
  for (const row of (rows ?? []) as FeedRow[]) {
    const used = seen.get(row.company_name) ?? 0;
    if (used >= MAX_PER_COMPANY) continue;
    seen.set(row.company_name, used + 1);
    items.push(row);
    if (items.length >= limit) break;
  }

  // Verified scores only: the viewer's own scored rows, matched on the stable
  // provider identity. No row, no score — never a default.
  let scores = new Map<string, number>();
  if (viewerId && items.length > 0) {
    const sources = [...new Set(items.map((item) => item.source_key))];
    const externals = [...new Set(items.map((item) => item.external_id))];

    const { data: scored, error: scoredError } = await viewerClient
      .from("job_opportunities")
      .select("source,external_id,match_score")
      .eq("user_id", viewerId)
      .in("source", sources)
      .in("external_id", externals);

    if (scoredError) throw new Error(scoredError.message);

    scores = new Map(
      ((scored ?? []) as Array<{ source: string | null; external_id: string | null; match_score: number | null }>)
        .filter((row) => row.source !== null && row.external_id !== null && row.match_score !== null)
        .map((row) => [`${row.source}::${row.external_id}`, row.match_score as number])
    );
  }

  return {
    items: items.map((item) => {
      const key = `${item.source_key}::${item.external_id}`;
      const matchScore = scores.get(key);
      return {
        id: item.id,
        title: item.title,
        company: item.company_name,
        location: item.location,
        workArrangement: item.work_arrangement,
        employmentType: item.employment_type,
        salaryText: item.salary_text,
        source: item.provider,
        sourceUrl: item.source_url,
        applyUrl: item.apply_url,
        postedAt: item.published_at,
        discoveredAt: item.last_seen_at,
        ...(matchScore !== undefined ? { matchScore } : {}),
      };
    }),
    total: count ?? 0,
    limit,
    offset,
  };
}

export { MAX_PER_COMPANY, REFILL_EXTRA };
