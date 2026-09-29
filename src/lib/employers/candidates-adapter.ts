/**
 * Employer candidates and Fit Score adapter — real backend reads.
 *
 * Replaces a development fixture. The hiring backend now exists
 * (`src/lib/employer/hiring.ts`, reached through
 * `/api/employer/orgs/[orgId]/candidates/*` and `.../fit-score`).
 *
 * Three rules this module exists to hold:
 *
 *  1. **Fit Score is never computed here.** `getFitScore` returns a persisted,
 *     evidence-backed row the backend wrote. If no row exists the score is
 *     absent, and the UI says so. A frontend calculation would be a second
 *     scoring policy that could disagree with the one employers are shown.
 *  2. **No candidate-private data crosses this boundary.** Live transcripts,
 *     guidance, mock-interview feedback, and post-interview analysis are
 *     candidate-only. The backend's applicant payload does not contain them
 *     and neither does anything below — `tests/unit/employers-candidate-live-isolation.test.ts`
 *     enforces the import boundary.
 *  3. **Identity is a separate, narrow read.** The applicant's name and contact
 *     address come from `odesseus_get_employer_applicant_identities`, which
 *     proves the whole membership -> org -> job -> application chain itself
 *     and returns no user id. Nothing here is a key into another candidate
 *     table.
 *  4. **No candidate identity is invented.** The name is the candidate's own
 *     display name, and the label falls back to the role they applied for when
 *     it is absent — never to a name derived from an email address.
 */

import { createClient } from "@/lib/supabase/server";
import { getFitScore, getPipeline, listApplicantIdentities, listApplicants } from "@/lib/employer/hiring";
import type { EmployerApplicantIdentity } from "@/lib/employer/hiring";
import { resolveEmployerContext } from "./context";
import { splitRequirementLines } from "./job-description";
import { DEFAULT_STAGE, isStoredStage, toProductStage } from "./stages";
import type { CandidateDetail, CandidateListItem, FitScore, PipelineStage } from "./types";
import type { EmployerResult } from "./result";

/**
 * The applicant's pipeline stage.
 *
 * History is absent for an applicant who has not been moved yet, which is
 * `APPLIED` — the pipeline's entry point, and what the backend's own
 * `currentStages` implies for a missing row.
 */
function toStage(value: unknown): PipelineStage {
  return isStoredStage(value) ? toProductStage(value) : DEFAULT_STAGE;
}

/** The backend's applicant row, in the camelCase the service returns. */
type ServiceApplicant = {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  jobStatus: string;
  applicationStatus: string;
  submittedAt: string | null;
  companyName: string;
  roleTitle: string;
  resumeSnapshot: unknown;
  jobSnapshot: unknown;
  matchScoreSnapshot: number | null;
  verificationEvidence: unknown;
};

/**
 * The label an applicant row shows.
 *
 * The applicant's own display name, from the identity read. A candidate who
 * applied to this employer has disclosed their name to them, and the employer
 * cannot run a hiring process without being able to see and contact who
 * applied.
 *
 * When the name is genuinely absent -- no profile, or the candidate cleared the
 * field -- the label falls back to the role they applied for, which is real
 * context the employer already has. It is never derived from the email
 * local-part: turning `ada.lovelace@` into "Ada Lovelace" is a guess about a
 * person, and the rule that forbids inventing qualifications forbids inventing
 * identity just as much.
 */
function applicantLabel(
  applicant: ServiceApplicant,
  identity: EmployerApplicantIdentity | undefined
): string {
  return identity?.candidateName?.trim() || applicant.roleTitle?.trim() || "Applicant";
}

/** Projects an applicant row onto the candidates-list display type. */
function toListItem(
  applicant: ServiceApplicant,
  identity: EmployerApplicantIdentity | undefined
): CandidateListItem {
  return {
    id: applicant.applicationId,
    name: applicantLabel(applicant, identity),
    email: identity?.candidateEmail ?? undefined,
    appliedJobId: applicant.jobId,
    appliedJobTitle: applicant.jobTitle,
    // The applicant's own pipeline stage comes from the pipeline read; the
    // application status is a different lifecycle (submitted/verified) and is
    // not the same thing, so it is not substituted here.
    stage: DEFAULT_STAGE,
    location: undefined,
    experienceSummary: undefined,
    appliedAt: applicant.submittedAt ?? new Date(0).toISOString(),
  };
}

/** Projects the persisted Fit Score row onto the display type. */
function toFitScore(row: {
  score: number;
  requiredMatches: unknown;
  preferredMatches: unknown;
  missingQualifications: unknown;
  missingSkills: unknown;
  locationAlignment: unknown;
  blockers: unknown;
  explanation: string;
}): FitScore {
  return {
    overall: row.score,
    requiredMatches: toStringList(row.requiredMatches),
    preferredMatches: toStringList(row.preferredMatches),
    // The backend stores no separate resume-evidence array on the cached row;
    // its own explanation is the evidence summary, so it is surfaced once
    // rather than repeated per bullet.
    resumeEvidence: row.explanation ? [row.explanation] : [],
    missingQualifications: toStringList(row.missingQualifications),
    missingSkills: toStringList(row.missingSkills),
    locationAlignment:
      typeof row.locationAlignment === "boolean" ? row.locationAlignment : undefined,
    blockers: toStringList(row.blockers),
  };
}

/**
 * Coerces a stored evidence column to a string list.
 *
 * The columns are JSONB and may hold strings or `{text}` objects depending on
 * which writer produced them. Anything unrecognised is dropped rather than
 * rendered as `[object Object]`.
 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      out.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object" && "text" in entry) {
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) out.push(text.trim());
    }
  }
  return out;
}

/**
 * The organization's applicants, optionally narrowed to one job or stage.
 *
 * `stage` is applied here rather than in the database: the applicant's current
 * stage is derived from the latest `employer_pipeline_stages` row, and the
 * backend's applicant RPC does not join that history. Deriving it from the
 * same history the Pipeline screen reads is the one consistent answer.
 */
export async function getCandidates(filter?: {
  jobId?: string;
  stage?: PipelineStage;
}): Promise<EmployerResult<CandidateListItem[]>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const [applicants, identities, stages] = await Promise.all([
      listApplicants(supabase, resolved.context.orgId, filter?.jobId) as Promise<
        ServiceApplicant[]
      >,
      listApplicantIdentities(supabase, resolved.context.orgId, filter?.jobId),
      currentStagesFor(supabase, resolved.context.orgId, filter?.jobId),
    ]);

    const byApplication = new Map(identities.map((row) => [row.applicationId, row]));

    let data = applicants.map((applicant) => {
      const identity = byApplication.get(applicant.applicationId);
      return {
        ...toListItem(applicant, identity),
        stage: stages[applicant.applicationId] ?? toStage(undefined),
      };
    });

    if (filter?.stage) data = data.filter((item) => item.stage === filter.stage);

    return { status: "ok", data, source: "live" };
  } catch (error) {
    return toFailure("load your applicants", error);
  }
}

/** Current stage per application, read from the pipeline history. */
async function currentStagesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  jobId?: string
): Promise<Record<string, PipelineStage>> {
  const history = await getPipeline(supabase, orgId, jobId);
  const current: Record<string, PipelineStage> = {};
  // `getPipeline` orders by created_at ascending, so the last write per
  // application is that application's current stage.
  for (const entry of history) {
    current[entry.applicationId] = toStage(entry.stage);
  }
  return current;
}

/**
 * One applicant, with the backend's Fit Score when one has been computed.
 *
 * The score is read, never derived. A candidate whose fit has not been scored
 * yet has no `fitScore` and the detail page says so rather than showing 0%.
 */
export async function getCandidateDetail(
  applicationId: string
): Promise<EmployerResult<CandidateDetail>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const [applicants, identities, stages] = await Promise.all([
      listApplicants(supabase, resolved.context.orgId) as Promise<ServiceApplicant[]>,
      listApplicantIdentities(supabase, resolved.context.orgId),
      currentStagesFor(supabase, resolved.context.orgId),
    ]);

    const applicant = applicants.find((row) => row.applicationId === applicationId);
    if (!applicant) {
      return { status: "unavailable", reason: "That applicant could not be found." };
    }

    const stage = stages[applicationId] ?? toStage(undefined);
    const identity = identities.find((row) => row.applicationId === applicationId);

    // Fit Score is org- and job-scoped on the server. A row for a different
    // job or org cannot be read here, so a missing row is genuinely unscored
    // rather than hidden.
    const fitScoreRow = await getFitScore(
      supabase,
      resolved.context.orgId,
      applicant.jobId,
      applicationId
    );

    const jobSnapshotRequirements = readSnapshotRequirements(applicant.jobSnapshot);

    return {
      status: "ok",
      source: "live",
      data: {
        ...toListItem(applicant, identity),
        stage,
        fitScore: fitScoreRow ? toFitScore(fitScoreRow) : undefined,
        requiredQualifications: jobSnapshotRequirements.required,
        preferredQualifications: jobSnapshotRequirements.preferred,
        // The application answers vault and employer notes are candidate- and
        // employer-private records with no employer-readable read on this
        // backend. They are left absent rather than reconstructed from the
        // resume snapshot, which is the candidate's own private file.
        applicationAnswers: undefined,
        employerNotes: undefined,
        resumeUrl: undefined,
      },
    };
  } catch (error) {
    return toFailure("load this applicant", error);
  }
}

/**
 * Reads the requirement lists off the job snapshot the application froze.
 *
 * The snapshot is the job as it was when the candidate applied, which is the
 * right basis for explaining a fit score. Anything unexpected yields an empty
 * list, not a guess.
 */
function readSnapshotRequirements(snapshot: unknown): {
  required: string[] | undefined;
  preferred: string[] | undefined;
} {
  if (!snapshot || typeof snapshot !== "object") return { required: undefined, preferred: undefined };
  const row = snapshot as Record<string, unknown>;
  return {
    required: splitRequirementLines(
      typeof row.requirementsText === "string" ? row.requirementsText : undefined
    ),
    preferred: splitRequirementLines(
      typeof row.preferredText === "string" ? row.preferredText : undefined
    ),
  };
}

/**
 * Requests a Fit Score for one application.
 *
 * Goes over HTTP so the route's hiring-manager check and its cached-row-then-
 * compute ordering stay authoritative. The caller is expected to treat a
 * non-ok response as "not scored" rather than to retry into a loop.
 */
export async function requestFitScore(
  applicationId: string,
  jobId: string,
  options?: { refresh?: boolean }
): Promise<EmployerResult<FitScore>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(
      `/api/employer/orgs/${resolved.context.orgId}/candidates/${applicationId}/fit-score`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, refresh: options?.refresh ?? false }),
      }
    );
    const payload = (await response.json().catch(() => ({}))) as {
      fitScore?: Parameters<typeof toFitScore>[0];
      error?: string;
    };
    if (!response.ok || !payload.fitScore) {
      return { status: "unavailable", reason: payload.error ?? "Could not score this applicant." };
    }
    return { status: "ok", data: toFitScore(payload.fitScore), source: "live" };
  } catch (error) {
    return toFailure("score this applicant", error);
  }
}

function toFailure(subject: string, error: unknown): EmployerResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ODESSEUS_EMPLOYER_HIRING] ${subject} failed`, message);
  return { status: "unavailable", reason: `Odesseus could not ${subject} right now.` };
}
