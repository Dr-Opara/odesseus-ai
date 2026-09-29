import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { readPublicHomeFeed } from "@/lib/jobs/home-feed";

export const runtime = "nodejs";

// Public surface: bounded per IP so the homepage cannot be scraped
// aggressively through the API.
const FEED_PER_MINUTE = 60;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

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
 *
 * The query itself lives in `src/lib/jobs/home-feed.ts` so this route and the
 * server-rendered homepage cannot drift into showing different jobs.
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
    const feed = await readPublicHomeFeed(supabase, service, { limit, offset, viewerId: userId });
    return NextResponse.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_JOB_FEED] home feed failed", message);
    return NextResponse.json({ error: "Could not load jobs." }, { status: 500 });
  }
}
