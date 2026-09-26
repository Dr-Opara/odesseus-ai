import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit, clientIp } from "@/lib/security/rate-limit";
import {
  JOB_REPORT_DETAILS_MAX,
  JOB_REPORT_REASONS,
  fileJobReport,
  listCandidateJobReports,
} from "@/lib/reports/service";

export const runtime = "nodejs";

// Abuse protection. Two independent buckets so neither a single account nor a
// single network can flood the moderation queue:
//   per user  — 5 reports/hour
//   per IP    — 20 reports/hour
// The in-memory limiter is best-effort per warm instance (see rate-limit.ts);
// it is a speed bump against casual abuse, not a durable quota. The duplicate
// check in the service is the real backstop for a persistent abuser.
const USER_REPORT_LIMIT = 5;
const IP_REPORT_LIMIT = 20;
const REPORT_WINDOW_MS = 60 * 60 * 1000;

const reportSchema = z.object({
  jobId: z.string().uuid().nullish(),
  reason: z.enum(JOB_REPORT_REASONS),
  details: z.string().max(JOB_REPORT_DETAILS_MAX).nullish(),
});

/** The caller's own reports, newest first. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const reports = await listCandidateJobReports(supabase, userId);
    return NextResponse.json(
      { reports },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[ODESSEUS_JOB_REPORT] list failed", error);
    return NextResponse.json({ error: "Could not load your reports." }, { status: 500 });
  }
}

/** Files a report about a job or company. */
export async function POST(request: Request) {
  // A report is a real-world side effect (it enters a moderation queue), so it
  // takes the same origin check as the money-moving routes.
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const perUser = checkRateLimit(
    `job-report:user:${userId}`,
    USER_REPORT_LIMIT,
    REPORT_WINDOW_MS
  );
  if (!perUser.allowed) {
    return NextResponse.json(
      { error: "You have filed a few reports already. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(perUser.retryAfterMs / 1000)) } }
    );
  }

  const perIp = checkRateLimit(
    `job-report:ip:${clientIp(request)}`,
    IP_REPORT_LIMIT,
    REPORT_WINDOW_MS
  );
  if (!perIp.allowed) {
    return NextResponse.json(
      { error: "Too many reports from this network. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(perIp.retryAfterMs / 1000)) } }
    );
  }

  let input: z.infer<typeof reportSchema>;
  try {
    input = reportSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "That report is not valid." }, { status: 400 });
  }

  const result = await fileJobReport(supabase, {
    userId,
    jobId: input.jobId ?? null,
    reason: input.reason,
    details: input.details ? input.details.trim() || null : null,
  });

  if (result.ok) {
    return NextResponse.json({ report: result.report }, { status: 201 });
  }

  switch (result.code) {
    case "job_not_found":
      return NextResponse.json(
        { error: "That job is not in your list." },
        { status: 404 }
      );
    case "duplicate":
      return NextResponse.json(
        { error: "You have already reported this." },
        { status: 409 }
      );
    case "invalid":
      return NextResponse.json({ error: "That report is not valid." }, { status: 400 });
    default:
      console.error(
        "[ODESSEUS_JOB_REPORT] filing failed",
        userId,
        input.reason,
        new Error("insert rejected")
      );
      return NextResponse.json(
        { error: "Could not file that report. Please try again." },
        { status: 500 }
      );
  }
}
