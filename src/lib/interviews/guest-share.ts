/**
 * No-account Guest Live Access (Phase 2O), shared server logic.
 *
 * The simplified model: a Share Annual owner generates a secure link and
 * shares it manually. The guest opens the link, enters their own interview
 * context, and uses the SAME Live session/guidance/transcript/post-interview
 * infrastructure as applicants. There is no guest account, no guest login,
 * no guest wallet, no slot accounting, and no separate Live engine.
 *
 * Security posture:
 * - Links carry a 256-bit random token; only its SHA-256 hex digest is
 *   stored. The raw token is returned once at creation and never logged.
 * - The token never encodes the owner user id or any database id.
 * - All guest traffic is server-mediated with the service role, scoped to
 *   the single guest record resolved from the token. Anonymous clients get
 *   no direct database privileges.
 * - Guest rows reuse applicant tables (interviews, live_interview_sessions,
 *   transcript, guidance) with source = 'guest_share_link' so the existing
 *   lifecycle works unchanged; candidate-facing reads exclude that source
 *   so guest content never leaks into the owner's dashboard, export,
 *   reminders, or workspace.
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  readLiveEntitlement,
  type LiveEntitlementRow,
} from "@/lib/billing/live-entitlement";
import type { Database } from "@/types/database";
import type { InterviewWorkspaceContext } from "./context";

/** Interview source marking rows that belong to a guest session. */
export const GUEST_SHARE_SOURCE = "guest_share_link";

/** Guest resume files live under this storage prefix, never under a user id. */
export const GUEST_RESUME_PREFIX = "guests";

export type GuestAccessRecord =
  Database["public"]["Tables"]["guest_access_records"]["Row"];

type ServiceClient = ReturnType<typeof createServiceClient>;

/** 256-bit random link token, hex-encoded. Unguessable by construction. */
export function generateGuestLinkToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hex digest. This is the only form ever stored or compared. */
export function hashGuestLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Basic shape guard so malformed links fail fast without a DB round trip. */
export function isPlausibleGuestLinkToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/** First client IP for rate-limit keys; never the guest token. */
export function guestRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/**
 * Rate-limit bucket for token-scoped guest writes, keyed by a token-hash
 * prefix (never the raw token, which must not land in logs or stores).
 */
export function guestTokenBucket(token: string, action: string): string {
  return `live:guest:${hashGuestLinkToken(token).slice(0, 16)}:${action}`;
}

/**
 * Whether an entitlement row authorizes its holder to mint guest links:
 * an active Share Annual owner with current access. Guests, monthly and
 * personal-annual holders, pass holders, and lapsed memberships are out.
 */
export function canGenerateGuestLinks(row: LiveEntitlementRow): boolean {
  return row.has_access && row.is_owner && row.plan === "share_annual";
}

/** Guest setup payload. Everything here belongs to the guest session. */
export const guestSetupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(200),
  jobDescription: z.string().trim().max(20000).nullable().default(null),
  resumeText: z.string().trim().max(60000).nullable().default(null),
  interviewType: z
    .enum(["recruiter", "hiring_manager", "behavioral", "technical", "panel", "executive", "other"])
    .nullable()
    .default(null),
  round: z.string().trim().max(100).nullable().default(null),
  notes: z.string().trim().max(10000).nullable().default(null),
});

export type GuestSetupInput = z.infer<typeof guestSetupSchema>;

/**
 * Resolve a guest record from its raw link token. Returns null for unknown,
 * malformed, or cancelled links. Never reveals why: a wrong token and a
 * retired link look identical from the outside. Completed links still
 * resolve so the guest can read their finished session state; mutations
 * enforce their own status rules.
 */
export async function resolveGuestAccessRecord(
  service: ServiceClient,
  token: string
): Promise<GuestAccessRecord | null> {
  if (!isPlausibleGuestLinkToken(token)) return null;

  const { data, error } = await service
    .from("guest_access_records")
    .select("*")
    .eq("token_sha256", hashGuestLinkToken(token))
    .maybeSingle();

  if (error || !data) return null;
  if (data.status === "cancelled") return null;
  return data;
}

export type GuestAccessLoad =
  | { ok: true; record: GuestAccessRecord }
  | { ok: false; status: number; error: string };

/**
 * Full guest authorization for a token-scoped route: valid link plus a
 * currently-valid Share Annual owner behind it. The guest never
 * authenticates; this check is the entire credential. No applicant data is
 * loaded or returned here.
 */
export async function loadGuestAccess(
  service: ServiceClient,
  token: string
): Promise<GuestAccessLoad> {
  const record = await resolveGuestAccessRecord(service, token);
  if (!record) {
    return { ok: false, status: 404, error: "This guest link is not valid." };
  }

  const entitlement = await readLiveEntitlement(record.owner_user_id);
  if (!entitlement.ok || !canGenerateGuestLinks(entitlement.row)) {
    return { ok: false, status: 403, error: "This guest link is no longer active." };
  }

  return { ok: true, record };
}

/**
 * True when a candidate-facing read must skip this interview: guest-share
 * rows are private to their guest session even though they share the
 * owner's user_id.
 */
export function isGuestShareInterview(row: { source: string | null }): boolean {
  return row.source === GUEST_SHARE_SOURCE;
}

/**
 * Owner-side guard for per-interview routes (workspace, settings, audit,
 * eligibility): returns the interview when it is a genuine candidate row,
 * null when it is missing or belongs to a guest session. Guest content is
 * reachable only through the token-scoped guest routes.
 */
export async function getCandidateInterview(
  service: ServiceClient,
  interviewId: string,
  userId: string
): Promise<{ id: string } | null> {
  const { data } = await service
    .from("interviews")
    .select("id,source")
    .eq("id", interviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || isGuestShareInterview(data)) return null;
  return data;
}

/**
 * Owner-side guard for Live session routes (activate, end, fail, recover,
 * transcript, webrtc): a guest-linked session must never be driven through
 * the applicant's authenticated endpoints. Returns true when the caller may
 * proceed.
 */
export async function isCandidateLiveSession(
  service: ServiceClient,
  sessionId: string,
  interviewId: string,
  userId: string
): Promise<boolean> {
  const [{ data: session }, { data: interview }] = await Promise.all([
    service
      .from("live_interview_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("interview_id", interviewId)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("interviews")
      .select("source")
      .eq("id", interviewId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!session || !interview) return false;
  return !isGuestShareInterview(interview);
}

/** PostgREST OR filter matching every non-guest interview, nulls included. */
export const NON_GUEST_INTERVIEW_FILTER =
  "source.is.null,source.neq.guest_share_link";

function roundNumberFromGuestRound(round: string | null): number | null {
  if (!round) return null;
  const parsed = Number.parseInt(round, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build the Live context for a guest session in the EXACT shape applicant
 * Live expects (InterviewWorkspaceContext), populated only from guest data.
 * No applicant profile, resume, application, or history is read here.
 */
export function buildGuestLiveContext(input: {
  record: GuestAccessRecord;
  interview: {
    id: string;
    status: string;
    interview_type: string | null;
  };
}): InterviewWorkspaceContext {
  const { record, interview } = input;

  return {
    interview: {
      id: interview.id,
      stage: null,
      interviewType: record.guest_interview_type,
      responseStyle: "conversational",
      responseLength: "30_45",
      roundNumber: roundNumberFromGuestRound(record.guest_round),
      interviewerDetails: null,
      company: record.guest_company,
      location: null,
      meetingType: null,
      notes: record.guest_notes,
      applicationUrl: null,
      source: GUEST_SHARE_SOURCE,
      status: interview.status,
      scheduledAt: null,
      timezone: null,
      durationMinutes: null,
      readinessGeneratedAt: null,
    },
    application: {
      id: null,
      companyName: record.guest_company,
      roleTitle: record.guest_role_title,
      jobSnapshot: record.guest_job_description
        ? { description: record.guest_job_description }
        : null,
      executionMode: null,
      matchScoreSnapshot: null,
      answersSnapshot: null,
      resumeSnapshot: record.guest_resume_profile ?? record.guest_resume_text ?? null,
    },
    candidate: {
      fullName: record.guest_name,
    },
    readiness: {
      version: null,
      generatedAt: null,
      briefing: null,
      likelyQuestions: null,
      behavioralQuestions: null,
      starPrompts: null,
      technicalConceptQuestions: null,
      companySpecific: null,
      questionsToAskInterviewer: null,
      prepSummary: null,
    },
    priorRounds: [],
    mockSessionsReady: false,
    entitlement: {
      hasAccess: true,
      source: "membership",
      plan: "share_annual",
      sessionsRemaining: 0,
      unlimitedUntil: null,
    },
  };
}
