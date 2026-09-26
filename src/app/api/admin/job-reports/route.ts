import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ADMIN_RESPONSE_HEADERS,
  adminAuthorizationError,
  requireCapability,
} from "@/lib/admin/authorize";
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
 *
 * Requires `job_reports:read`, so a finance admin is refused: settling a
 * billing dispute is not a reason to see who reported a job listing.
 */
export async function GET(request: Request) {
  const authorization = await requireCapability(request, "job_reports:read");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const userId = authorization.userId;

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
    return NextResponse.json(page, { headers: ADMIN_RESPONSE_HEADERS });
  } catch (error) {
    console.error("[ODESSEUS_JOB_REPORT] queue read failed", error);
    return NextResponse.json(
      { error: "Could not load the moderation queue." },
      { status: 500 }
    );
  }
}
