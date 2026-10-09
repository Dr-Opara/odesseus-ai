import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const service = createServiceClient();

  try {
    const [
      jobsCount,
      matchesCount,
      applicationsCount,
      jobsLatest,
      matchesLatest,
      applicationsLatest,
    ] = await Promise.all([
      service.from("public_job_posts").select("id", { count: "exact", head: true }),
      service
        .from("job_opportunities")
        .select("id", { count: "exact", head: true })
        .not("match_score", "is", null),
      service
        .from("applications")
        .select("id", { count: "exact", head: true })
        .not("submitted_at", "is", null),
      service
        .from("public_job_posts")
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("job_opportunities")
        .select("discovered_at")
        .order("discovered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("applications")
        .select("submitted_at,last_event_at")
        .not("submitted_at", "is", null)
        .order("last_event_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const errors = [
      jobsCount.error,
      matchesCount.error,
      applicationsCount.error,
      jobsLatest.error,
      matchesLatest.error,
      applicationsLatest.error,
    ].filter(Boolean);

    if (errors.length) {
      throw new Error(errors.map((error) => error?.message).join("; "));
    }

    const timestamps = [
      jobsLatest.data?.last_seen_at ?? null,
      matchesLatest.data?.discovered_at ?? null,
      applicationsLatest.data?.last_event_at ?? applicationsLatest.data?.submitted_at ?? null,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));

    const dataAsOf = timestamps.length
      ? new Date(Math.max(...timestamps.map((value) => value.getTime()))).toISOString()
      : null;

    return NextResponse.json(
      {
        jobsScanned: jobsCount.count ?? 0,
        matchesFound: matchesCount.count ?? 0,
        jobsApplied: applicationsCount.count ?? 0,
        dataAsOf,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error(
      "[ODESSEUS_HOME_ACTIVITY] aggregate read failed",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ error: "Activity unavailable." }, { status: 500 });
  }
}
