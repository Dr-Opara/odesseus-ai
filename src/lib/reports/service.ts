/**
 * Job report service (M7).
 *
 * A candidate reports a job or company that looks unsafe, misleading, or
 * fraudulent. Reports are private candidate data and are treated as abuse
 * surface, so this module is deliberately defensive:
 *
 *   - Reports are always owned by the reporting user. There is no anonymous
 *     filing path: `job_reports.user_id` is NOT NULL with an auth.users FK and
 *     the RLS insert policy pins it to auth.uid(). "Reporter if authenticated"
 *     is therefore satisfied by requiring a session, which also gives us a
 *     durable identity to rate-limit and deduplicate against.
 *   - A reported job must be one the reporter actually has. We verify the
 *     referenced opportunity belongs to the caller before writing, so the
 *     endpoint cannot be used to probe whether an arbitrary job id exists.
 *   - The reason must be one of the fixed set the UI offers, and details are
 *     length-capped, both mirrored by CHECK constraints server-side.
 *   - The internal moderation note is never returned to the reporting user.
 *
 * Moderation runs through a service-role-only RPC; clients get no UPDATE or
 * DELETE path at all, so a report's status can only ever move through
 * `odesseus_update_job_report_status`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AdminRole } from "@/lib/admin/capabilities";

export type ReportsClient = SupabaseClient<Database>;

/**
 * The exact reason set the Report Job UI offers. Kept in sync with
 * `job_reports_reason_check`; the database is the final authority, so a value
 * added here without the migration still fails closed at insert time.
 */
export const JOB_REPORT_REASONS = [
  "Scam",
  "Fake Company",
  "Misleading Job Description",
  "Misleading Salary",
  "Requests Payment",
  "Phishing Attempt",
  "Duplicate Listing",
  "Incorrect Location",
  "Other",
] as const;

export type JobReportReason = (typeof JOB_REPORT_REASONS)[number];

/** Mirrors `job_reports_status_check`. */
export const JOB_REPORT_STATUSES = [
  "new",
  "reviewing",
  "resolved",
  "dismissed",
] as const;

export type JobReportStatus = (typeof JOB_REPORT_STATUSES)[number];

/**
 * Statuses a moderator may set. `new` is the filing state and is deliberately
 * not a valid target: a report is triaged forward from the queue, never back
 * into "newly filed". Mirrors the RPC's own guard, and is separately enforced
 * by the authenticated insert policy so a filer cannot pre-judge their report.
 */
export const JOB_REPORT_MODERATION_STATUSES = [
  "reviewing",
  "resolved",
  "dismissed",
] as const;

export type JobReportModerationStatus =
  (typeof JOB_REPORT_MODERATION_STATUSES)[number];

/** Mirrors `job_reports_details_length_check`. */
export const JOB_REPORT_DETAILS_MAX = 2000;

/** Columns safe to return to the reporting candidate (no moderation_note). */
const CANDIDATE_COLUMNS =
  "id,job_id,reason,details,status,created_at,updated_at";

export type CandidateJobReport = {
  id: string;
  job_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FileJobReportInput = {
  userId: string;
  jobId: string | null;
  reason: JobReportReason;
  details: string | null;
};

export type FileJobReportResult =
  | { ok: true; report: CandidateJobReport }
  | { ok: false; code: "job_not_found" | "duplicate" | "invalid" | "error" };

/** Type guard used by the route before it trusts a client-supplied reason. */
export function isJobReportReason(value: unknown): value is JobReportReason {
  return (
    typeof value === "string" &&
    (JOB_REPORT_REASONS as readonly string[]).includes(value)
  );
}

export function isJobReportModerationStatus(
  value: unknown
): value is JobReportModerationStatus {
  return (
    typeof value === "string" &&
    (JOB_REPORT_MODERATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Files one report for the calling user.
 *
 * Duplicate protection: a user who already reported the same job with the
 * same reason is not allowed to pile on near-identical rows. This is checked
 * in application code against the user's own visible reports (RLS keeps this
 * read to their rows) rather than with a database constraint, because a unique
 * index on (user_id, job_id, reason) would permanently block a legitimate
 * re-report after an unrelated moderation action.
 */
export async function fileJobReport(
  client: ReportsClient,
  input: FileJobReportInput
): Promise<FileJobReportResult> {
  const { userId, jobId, reason, details } = input;

  if (!isJobReportReason(reason)) return { ok: false, code: "invalid" };
  if (details !== null && details.length > JOB_REPORT_DETAILS_MAX) {
    return { ok: false, code: "invalid" };
  }

  // A report must reference one of the caller's own opportunities. This is an
  // ownership check, not just an existence check, so the endpoint cannot be
  // used to test whether someone else's job id is real.
  if (jobId) {
    const { data: job, error: jobError } = await client
      .from("job_opportunities")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (jobError) return { ok: false, code: "error" };
    if (!job) return { ok: false, code: "job_not_found" };
  }

  const { data: existing } = await client
    .from("job_reports")
    .select("id,reason,job_id")
    .eq("user_id", userId)
    .eq("reason", reason)
    .order("created_at", { ascending: false })
    .limit(20);

  if (
    (existing ?? []).some(
      (row) => (row.job_id ?? null) === (jobId ?? null)
    )
  ) {
    return { ok: false, code: "duplicate" };
  }

  const { data, error } = await client
    .from("job_reports")
    .insert({
      user_id: userId,
      job_id: jobId,
      reason,
      details,
      // A report is always born unreviewed. The insert policy pins this too, so
      // a direct PostgREST call cannot pre-judge its own moderation outcome.
      status: "new",
    })
    .select(CANDIDATE_COLUMNS)
    .maybeSingle();

  if (error || !data) return { ok: false, code: "error" };

  return { ok: true, report: data as CandidateJobReport };
}

/** The caller's own reports, newest first. Scoped to them by RLS. */
export async function listCandidateJobReports(
  client: ReportsClient,
  userId: string,
  limit = 25
): Promise<CandidateJobReport[]> {
  const { data, error } = await client
    .from("job_reports")
    .select(CANDIDATE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) {
    throw new Error(`Could not load job reports: ${error.message}`);
  }

  return (data ?? []) as CandidateJobReport[];
}

export type ModerationQueueEntry = CandidateJobReport & {
  user_id: string;
  moderation_note: string | null;
};

export type JobReportQueuePage = {
  items: ModerationQueueEntry[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * The moderation queue. Requires a service-role client: moderators read every
 * candidate's report, which the candidate-scoped RLS policies correctly deny,
 * so this must never run on a user client.
 */
export async function listJobReportQueue(
  client: SupabaseClient<Database>,
  options: { status?: JobReportStatus | null; limit?: number; offset?: number } = {}
): Promise<JobReportQueuePage> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = client
    .from("job_reports")
    .select(
      "id,user_id,job_id,reason,details,status,moderation_note,created_at,updated_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: true });

  if (options.status) query = query.eq("status", options.status);

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Could not load the job report queue: ${error.message}`);
  }

  return {
    items: (data ?? []) as ModerationQueueEntry[],
    total: count ?? 0,
    limit,
    offset,
  };
}

/**
 * Moves a report through the moderation queue via the service-role-only RPC.
 * The RPC re-validates the status and report existence, and writes the audit row
 * for the transition inside the same transaction, so this returns a failure
 * rather than throwing for a malformed transition.
 *
 * The actor is a required argument rather than an optional one. An audit trail
 * with a nullable actor is an audit trail that is silently empty for any caller
 * who forgot one.
 */
export async function setJobReportStatus(
  client: SupabaseClient<Database>,
  input: {
    reportId: string;
    status: JobReportModerationStatus;
    note: string | null;
    actor: { userId: string; role: AdminRole; email: string | null };
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!isJobReportModerationStatus(input.status)) {
    return { ok: false, error: "That moderation status is not allowed." };
  }
  if (input.note !== null && input.note.length > JOB_REPORT_DETAILS_MAX) {
    return { ok: false, error: "That moderation note is too long." };
  }

  const { error } = await client.rpc("odesseus_update_job_report_status", {
    p_report_id: input.reportId,
    p_status: input.status,
    p_note: input.note,
    p_actor_user_id: input.actor.userId,
    p_actor_email: input.actor.email,
    p_actor_role: input.actor.role,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
