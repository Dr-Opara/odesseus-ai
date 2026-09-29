import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

// Public surface: bounded per IP so the homepage cannot be scraped
// aggressively through the API.
const FEED_PER_MINUTE = 60;

// At most this many cards per company on one page; the page is refilled
// from the same recency order so different employers stay visible.
const MAX_PER_COMPANY = 3;
const REFILL_EXTRA = 30;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

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

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}

/**
 * Public homepage job feed: real, active postings only.
 *
 * Anonymous callers receive job facts and never a Match Score — there is no
 * candidate context to compute one from. Signed-in callers additionally
 * receive a matchScore ONLY where their own verified scoring row already
 * exists for that posting; otherwise the field is omitted, never fabricated.
 */
export async function GET(request: Request) {
  const rate = checkRateLimit(`jobs:home-feed:${clientIp(request)}`, FEED_PER_MINUTE, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the feed parameters." }, { status: 400 });
  }
  const { limit, offset } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub ?? null;

  const service = createServiceClient();

  try {
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

    // Verified scores only: the viewer's own scored rows, matched on the
    // stable provider identity. No row, no score — never a default.
    let scores = new Map<string, number>();
    if (userId && items.length > 0) {
      const pairs = items.map((item) => ({
        source: item.source_key,
        external_id: item.external_id,
      }));
      const sources = [...new Set(pairs.map((p) => p.source))];
      const externals = [...new Set(pairs.map((p) => p.external_id))];

      const { data: scored, error: scoredError } = await supabase
        .from("job_opportunities")
        .select("source,external_id,match_score")
        .eq("user_id", userId)
        .in("source", sources)
        .in("external_id", externals);

      if (scoredError) throw new Error(scoredError.message);

      scores = new Map(
        ((scored ?? []) as Array<{ source: string | null; external_id: string | null; match_score: number | null }>)
          .filter((row) => row.source !== null && row.external_id !== null && row.match_score !== null)
          .map((row) => [`${row.source}::${row.external_id}`, row.match_score as number])
      );
    }

    return NextResponse.json({
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
          // Absent when the source did not provide one; never defaulted.
          salaryText: item.salary_text,
          source: item.provider,
          sourceUrl: item.source_url,
          // Employer postings apply in-app; no external URL is fabricated.
          applyUrl: item.apply_url,
          postedAt: item.published_at,
          discoveredAt: item.last_seen_at,
          ...(matchScore !== undefined ? { matchScore } : {}),
        };
      }),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_JOB_FEED] home feed failed", message);
    return NextResponse.json({ error: "Could not load jobs." }, { status: 500 });
  }
}
