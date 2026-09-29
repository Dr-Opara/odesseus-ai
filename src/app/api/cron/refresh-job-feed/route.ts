import { NextResponse } from "next/server";
import { runPublicFeedIngestion } from "@/lib/jobs/feed-ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Refresh the public homepage job feed: re-fetch configured ATS provider
 * feeds, mirror published employer postings, and retire stale rows.
 * Authorized with the CRON_SECRET bearer like the other maintenance crons.
 * Idempotent and best-effort per source: a failing provider is recorded in
 * the summary, never fatal to the tick.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runPublicFeedIngestion();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_JOB_FEED] refresh tick failed", message);
    return NextResponse.json({ error: "Job feed refresh failed." }, { status: 500 });
  }
}
