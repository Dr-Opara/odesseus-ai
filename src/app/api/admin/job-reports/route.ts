import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin } from "@/lib/partners/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  JOB_REPORT_STATUSES,
  listJobReportQueue,
  type JobReportStatus,
} from "@/lib/reports/service";

export const runtime = "nodejs";

// Built from the shared constant rather than re-listing the states, so the
// queue filter cannot drift from the domain the database enforces.
const statusFilter = z.enum(JOB_REPORT_STATUSES);

/**
 * The moderation queue. Admin-only and service-role backed: reading every
 * candidate's report is exactly what the candidate-scoped RLS policies deny,
 * so this route is the deliberate, audited exception. Reporters' details are
 * never exposed to employers — the only non-admin reader of job_reports is the
 * reporting candidate, and only for their own rows.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (!(await isAdmin(userId))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  // A queue viewer is trusted, but the queue is still a bounded read: cap the
  // page size and throttle so one admin client cannot pull the whole table in
  // a loop.
  const rate = checkRateLimit(`job-report-queue:admin:${userId}`, 120, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many queue requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return NextResponse.json({ error: "Invalid pagination." }, { status: 400 });
  }

  let status: JobReportStatus | null = null;
  if (rawStatus !== null) {
    const parsed = statusFilter.safeParse(rawStatus);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    status = parsed.data;
  }

  try {
    const page = await listJobReportQueue(createServiceClient(), { status, limit, offset });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[ODESSEUS_JOB_REPORT] queue read failed", error);
    return NextResponse.json(
      { error: "Could not load the moderation queue." },
      { status: 500 }
    );
  }
}
