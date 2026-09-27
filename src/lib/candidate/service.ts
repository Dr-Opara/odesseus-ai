/**
 * Shared candidate read services (Phase 5).
 *
 * These are the single source of truth for fetching a candidate's own records.
 * Desktop pages and mobile screens both call these functions with the same
 * authenticated Supabase client, so every screen renders the same persisted
 * data through the same queries. All queries are owner-scoped by `userId`
 * (matching the row-level security policies) — callers resolve the user from
 * the auth session exactly once, never from client input.
 *
 * Passing an authenticated client (instead of importing `createClient`
 * internally) keeps these functions testable with the shared fake clients in
 * `tests/helpers` and keeps them usable from any server context.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  CandidateActivity,
  CandidateApplication,
  CandidateDocument,
  CandidateInterview,
  CandidateJob,
  CandidateJobPreferences,
  CandidateProfile,
  CandidateResumeTailoring,
  CreditBalance,
} from "./types";

export type CandidateClient = SupabaseClient<Database>;

const PROFILE_COLUMNS =
  "full_name,headline,location,work_preference,country_code,locale,preferred_currency,preferred_language,timezone,application_contact_email,onboarding_completed";

const JOB_COLUMNS =
  "id,company_name,role_title,location,work_arrangement,employment_type,salary_text,description,match_score,status,source,source_url,discovered_at";

const APP_COLUMNS =
  "id,company_name,role_title,status,submitted_at,last_event_at,match_score_snapshot";

/** Resolves the signed-in user id from the auth claims, or null. */
export async function getCandidateUserId(
  client: CandidateClient
): Promise<string | null> {
  const { data: auth } = await client.auth.getClaims();
  const sub = auth?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/** The candidate's own profile row, or null when the record does not exist. */
export async function getCandidateProfile(
  client: CandidateClient,
  userId: string
): Promise<CandidateProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load profile: ${error.message}`);
  }
  return (data as CandidateProfile | null) ?? null;
}

/**
 * The candidate's wallet balance plus Live entitlement state.
 *
 * `wallet_balance_cents` is intentionally the only application-spend column
 * read here. The legacy `application_credits` column is still in the schema
 * but is never surfaced: the wallet is the active currency, and reading both
 * would invite a second, contradictory balance into the UI.
 */
export async function getCreditBalance(
  client: CandidateClient,
  userId: string
): Promise<CreditBalance> {
  const { data, error } = await client
    .from("credit_balances")
    .select("wallet_balance_cents,interview_passes,live_unlimited_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load credit balance: ${error.message}`);
  }
  // The row is snake_case from Postgres; the returned CreditBalance is
  // camelCase. The mapping is explicit so a column rename breaks the build
  // rather than silently rendering a $0.00 balance.
  const row = data as {
    wallet_balance_cents?: number | null;
    interview_passes?: number | null;
    live_unlimited_until?: string | null;
  } | null;
  return {
    walletBalanceCents: row?.wallet_balance_cents ?? 0,
    interviewPasses: row?.interview_passes ?? 0,
    liveUnlimitedUntil: row?.live_unlimited_until ?? null,
  };
}

/**
 * Jobs surfaced for the candidate, ordered by match score then recency.
 * `excludeStatuses` filters out closed/rejected discoveries by default.
 */
export async function getRecommendedJobs(
  client: CandidateClient,
  userId: string,
  options: { limit?: number; excludeStatuses?: string[] } = {}
): Promise<CandidateJob[]> {
  const { limit, excludeStatuses = ["closed", "rejected"] } = options;

  let query = client
    .from("job_opportunities")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .order("match_score", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false });

  if (excludeStatuses.length) {
    query = query.not("status", "in", `(${excludeStatuses.join(",")})`);
  }
  if (limit && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load job matches: ${error.message}`);
  }
  return (data as CandidateJob[]) ?? [];
}

/** The candidate's saved jobs (persisted via job status = "saved"). */
export async function getSavedJobs(
  client: CandidateClient,
  userId: string
): Promise<CandidateJob[]> {
  const { data, error } = await client
    .from("job_opportunities")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "saved")
    .order("discovered_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load saved jobs: ${error.message}`);
  }
  return (data as CandidateJob[]) ?? [];
}

/** One job opportunity owned by the candidate, or null (caller maps to 404). */
export async function getJobMatch(
  client: CandidateClient,
  userId: string,
  jobId: string
): Promise<CandidateJob | null> {
  const { data, error } = await client
    .from("job_opportunities")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load job match: ${error.message}`);
  }
  return (data as CandidateJob | null) ?? null;
}

/**
 * One job opportunity plus its stored match assessment (the raw
 * `match_breakdown` jsonb). Callers validate the breakdown with
 * `matchAssessmentSchema`; a row without a usable breakdown maps to 404.
 */
export async function getJobMatchWithBreakdown(
  client: CandidateClient,
  userId: string,
  jobId: string
): Promise<{ job: CandidateJob; match_breakdown: unknown } | null> {
  const { data, error } = await client
    .from("job_opportunities")
    .select(`${JOB_COLUMNS},match_breakdown`)
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load job match: ${error.message}`);
  }
  const row = data as (CandidateJob & { match_breakdown: unknown }) | null;
  return row ? { job: row, match_breakdown: row.match_breakdown } : null;
}

/** The candidate's applications, most recently active first. */
export async function getApplications(
  client: CandidateClient,
  userId: string,
  options: { status?: string; limit?: number } = {}
): Promise<CandidateApplication[]> {
  const { status, limit } = options;

  let query = client
    .from("applications")
    .select(APP_COLUMNS)
    .eq("user_id", userId)
    .order("last_event_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (limit && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load applications: ${error.message}`);
  }
  return (data as CandidateApplication[]) ?? [];
}

/**
 * Recent calendar of what changed for this candidate: application status
 * events plus detected external signals, merged and sorted newest first.
 * This is the "recent agent activity" feed used by dashboard surfaces.
 */
export async function getRecentActivity(
  client: CandidateClient,
  userId: string,
  limit = 6
): Promise<CandidateActivity[]> {
  const eventsResult = await client
    .from("application_status_events")
    .select("id,title,detail,occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit * 2);

  const signalsResult = await client
    .from("external_signals")
    .select("id,title,signal_type,occurred_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit * 2);

  if (eventsResult.error) {
    throw new Error(`Could not load application activity: ${eventsResult.error.message}`);
  }
  if (signalsResult.error) {
    throw new Error(`Could not load signal activity: ${signalsResult.error.message}`);
  }

  const events = eventsResult.data ?? [];
  const signals = signalsResult.data ?? [];

  const signalTitle = (signal_type: string) =>
    signal_type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return [
    ...events.map((event) => ({
      key: `event-${event.id}`,
      title: event.title ?? "",
      detail: event.detail,
      at: event.occurred_at,
    })),
    ...signals.map((signal) => ({
      key: `signal-${signal.id}`,
      title: signal.title || signalTitle(signal.signal_type),
      detail: signalTitle(signal.signal_type),
      at: signal.occurred_at || signal.created_at,
    })),
  ]
    .filter((item) => item.title)
    .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
    .slice(0, limit);
}

/** The candidate's upcoming (active) interviews, soonest first. */
export async function getUpcomingInterviews(
  client: CandidateClient,
  userId: string,
  options: { limit?: number } = {}
): Promise<CandidateInterview[]> {
  const { limit } = options;

  let query = client
    .from("interviews")
    .select("id,stage,scheduled_at,status,meeting_provider,readiness_generated_at,applications(company_name,role_title)")
    .eq("user_id", userId)
    .in("status", ["invited", "scheduled", "ready", "live"])
    .order("scheduled_at", { ascending: true });

  if (limit && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load interviews: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    id: string;
    stage: string | null;
    scheduled_at: string | null;
    status: string;
    meeting_provider: string | null;
    readiness_generated_at: string | null;
    applications: { company_name: string; role_title: string } | null;
  }>).map((interview) => ({
    id: interview.id,
    stage: interview.stage,
    scheduled_at: interview.scheduled_at,
    status: interview.status,
    meeting_provider: interview.meeting_provider,
    readiness_generated_at: interview.readiness_generated_at,
    role_title: interview.applications?.role_title ?? null,
    company_name: interview.applications?.company_name ?? null,
  }));
}

/** The candidate's saved job-search preferences, or null when unset. */
export async function getJobPreferences(
  client: CandidateClient,
  userId: string
): Promise<CandidateJobPreferences | null> {
  const { data, error } = await client
    .from("job_preferences")
    .select("min_match_score,target_titles,target_locations,employment_types,industries,remote_only,minimum_salary,work_authorization,sponsorship_needed")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load job preferences: ${error.message}`);
  }
  return (data as CandidateJobPreferences | null) ?? null;
}

/** The candidate's resumes, newest first (documents beyond resumes do not
 * exist in the schema yet; cover letters and certificates are not in scope). */
export async function getDocuments(
  client: CandidateClient,
  userId: string,
  options: { limit?: number } = {}
): Promise<CandidateDocument[]> {
  const { limit } = options;

  let query = client
    .from("resumes")
    .select("id,file_name,storage_path,mime_type,size_bytes,is_master,is_approved,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (limit && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load documents: ${error.message}`);
  }
  return (data as CandidateDocument[]) ?? [];
}

/**
 * One tailor run owned by the candidate, with the job it was created for and
 * the source resume it was derived from. Callers map a missing record to 404
 * and validate the two JSON payloads with `tailoredResumeSchema` /
 * `resumeProfileSchema`.
 */
export async function getResumeTailoring(
  client: CandidateClient,
  userId: string,
  tailoringId: string
): Promise<CandidateResumeTailoring | null> {
  const { data, error } = await client
    .from("resume_tailorings")
    .select(
      "id,job_id,version_number,status,improvement_count,changes,tailored_resume," +
        "job_opportunities(company_name,role_title,match_score)," +
        "resumes!resume_tailorings_source_resume_id_fkey(parsed_data)"
    )
    .eq("id", tailoringId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load resume tailoring: ${error.message}`);
  }

  const row = data as
    | {
        id: string;
        job_id: string;
        version_number: number;
        status: string;
        improvement_count: number;
        changes: unknown[];
        tailored_resume: unknown;
        job_opportunities: {
          company_name: string | null;
          role_title: string | null;
          match_score: number | null;
        } | null;
        resumes: { parsed_data: unknown } | null;
      }
    | null;

  if (!row) return null;

  return {
    id: row.id,
    jobId: row.job_id,
    versionNumber: row.version_number,
    status: row.status,
    improvementCount: row.improvement_count,
    job: row.job_opportunities,
    tailored: row.tailored_resume,
    changes: Array.isArray(row.changes) ? row.changes : [],
    sourceParsed: row.resumes?.parsed_data ?? null,
  };
}