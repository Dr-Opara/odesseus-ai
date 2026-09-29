/**
 * Employer hiring backend: applicants, Fit Score, pipeline (Phase 2R).
 *
 * Authorization model:
 * - Reads run on the caller's session client against member-scoped RLS or
 *   the membership-gated applicants RPC, so Org A can never see Org B.
 * - Writes (fit computation, pipeline transitions) run service-side after
 *   the route verifies a hiring-manager role (owner/admin/recruiter) via
 *   getOrgRole. Viewers read only.
 * - Applicants are applications to the org's own jobs, resolved through the
 *   existing attribution edge (applications.job_id ->
 *   job_opportunities.employer_job_id -> employer_jobs.org_id). Candidate
 *   user ids, Live content, mock feedback, prep, and post-interview analysis
 *   are never selected here.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { EmployerClient } from "./service";
import type { OrgRole } from "./service";
import { generateEmployerFitScore, EMPLOYER_FIT_MODEL_VERSION } from "@/lib/ai/employer-fit";
import type { EmployerFitScore } from "@/lib/ai/schemas";
import { notifyEmployerMembers } from "@/lib/notifications/employer";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Locked hiring pipeline vocabulary. */
export const PIPELINE_STAGES = [
  "applied",
  "reviewing",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
  return (
    typeof value === "string" &&
    (PIPELINE_STAGES as readonly string[]).includes(value)
  );
}

/** Roles allowed to compute scores and move pipeline stages. */
const HIRING_MANAGER_ROLES: readonly OrgRole[] = ["owner", "admin", "recruiter"];

export function isHiringManager(role: OrgRole | null): boolean {
  return role !== null && (HIRING_MANAGER_ROLES as readonly string[]).includes(role);
}

/** Score at or above which a strong-fit notice goes to the hiring team. */
export const STRONG_FIT_THRESHOLD = 85;

export type EmployerApplicant = {
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

export type EmployerFitScoreView = {
  id: string;
  score: number;
  requiredMatches: unknown;
  preferredMatches: unknown;
  missingQualifications: unknown;
  missingSkills: unknown;
  locationAlignment: unknown;
  blockers: unknown;
  explanation: string;
  modelVersion: string;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
};

export type PipelineHistoryEntry = {
  id: string;
  jobId: string;
  applicationId: string;
  stage: PipelineStage;
  changedBy: string | null;
  notes: string | null;
  createdAt: string;
};

/**
 * Applications to the org's jobs. The RPC enforces the org boundary
 * internally, so cross-org reads are impossible even if a caller passes a
 * foreign org id: the function raises instead of leaking.
 */
export async function listApplicants(
  client: EmployerClient,
  orgId: string,
  jobId?: string
): Promise<EmployerApplicant[]> {
  const { data, error } = await client.rpc("odesseus_get_employer_applicants", {
    p_org_id: orgId,
    p_job_id: jobId ?? null,
  });

  if (error) {
    throw new Error("Could not load applicants: " + error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    applicationId: row.application_id as string,
    jobId: row.employer_job_id as string,
    jobTitle: row.job_title as string,
    jobStatus: row.job_status as string,
    applicationStatus: row.application_status as string,
    submittedAt: (row.submitted_at as string | null) ?? null,
    companyName: row.company_name as string,
    roleTitle: row.role_title as string,
    resumeSnapshot: row.resume_snapshot ?? null,
    jobSnapshot: row.job_snapshot ?? null,
    matchScoreSnapshot: (row.match_score_snapshot as number | null) ?? null,
    verificationEvidence: row.verification_evidence ?? null,
  }));
}

/** One applicant by id, or null when it is not this org's applicant. */
export async function getApplicant(
  client: EmployerClient,
  orgId: string,
  applicationId: string
): Promise<EmployerApplicant | null> {
  const applicants = await listApplicants(client, orgId);
  return applicants.find((a) => a.applicationId === applicationId) ?? null;
}

/** Cached Fit Score row, or null when never computed. */
export async function getFitScore(
  client: EmployerClient,
  orgId: string,
  jobId: string,
  applicationId: string
): Promise<EmployerFitScoreView | null> {
  const { data, error } = await client
    .from("employer_fit_scores")
    .select(
      "id,score,required_matches,preferred_matches,missing_qualifications,missing_skills,location_alignment,blockers,explanation,model_version,version_number,created_at,updated_at"
    )
    .eq("org_id", orgId)
    .eq("job_id", jobId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    score: row.score as number,
    requiredMatches: row.required_matches ?? [],
    preferredMatches: row.preferred_matches ?? [],
    missingQualifications: row.missing_qualifications ?? [],
    missingSkills: row.missing_skills ?? [],
    locationAlignment: row.location_alignment ?? {},
    blockers: row.blockers ?? [],
    explanation: (row.explanation as string) ?? "",
    modelVersion: (row.model_version as string) ?? EMPLOYER_FIT_MODEL_VERSION,
    versionNumber: (row.version_number as number) ?? 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function notifyStrongFit(
  orgId: string,
  input: { jobId: string; jobTitle: string; applicationId: string; score: number }
): Promise<void> {
  await notifyEmployerMembers(
    orgId,
    {
      notification_type: "EMPLOYER_STRONG_FIT",
      title: `Strong fit (${input.score}) for ${input.jobTitle}`,
      message: `An applicant scored ${input.score} against ${input.jobTitle}.`,
      entity_type: "application",
      entity_id: input.applicationId,
      priority: "normal",
    },
    {
      dedupeTemplate: `employer:${orgId}:strong-fit:${input.jobId}:${input.applicationId}:{user}`,
    }
  );
}

/**
 * Compute (or recompute) the Fit Score for one application against one of
 * the org's jobs. Verifies the job belongs to the org and the application
 * belongs to the job before spending model time. Upserts the cached row and
 * bumps the version on recompute. Never throws for notification failures.
 */
export async function computeFitScore(
  service: ServiceClient,
  input: { orgId: string; jobId: string; applicationId: string; refresh?: boolean }
): Promise<{ score: EmployerFitScore; versionNumber: number; cached: boolean }> {
  const [{ data: job }, { data: application }] = await Promise.all([
    service
      .from("employer_jobs")
      .select("id,title,description,location,requirements_text,preferred_text,work_arrangement")
      .eq("id", input.jobId)
      .eq("org_id", input.orgId)
      .maybeSingle(),
    service
      .from("applications")
      .select("id,job_id,resume_snapshot")
      .eq("id", input.applicationId)
      .maybeSingle(),
  ]);

  if (!job) {
    throw new Error("Job not found in this organization.");
  }
  if (!application) {
    throw new Error("Application not found.");
  }

  // The application must belong to this job through the attribution edge:
  // the job's own opportunity row. Anything else is a cross-org fabrication
  // attempt and stops here.
  const { data: opportunity } = await service
    .from("job_opportunities")
    .select("id")
    .eq("id", (application as { job_id: string | null }).job_id ?? "")
    .eq("employer_job_id", input.jobId)
    .maybeSingle();

  if (!opportunity) {
    throw new Error("Application does not belong to this job.");
  }

  if (!input.refresh) {
    const { data: cached } = await service
      .from("employer_fit_scores")
      .select(
        "score,required_matches,preferred_matches,missing_qualifications,missing_skills,location_alignment,blockers,explanation,model_version,version_number"
      )
      .eq("org_id", input.orgId)
      .eq("job_id", input.jobId)
      .eq("application_id", input.applicationId)
      .maybeSingle();

    if (cached) {
      const row = cached as unknown as {
        score: number;
        required_matches: unknown;
        preferred_matches: unknown;
        missing_qualifications: unknown;
        missing_skills: unknown;
        location_alignment: unknown;
        blockers: unknown;
        explanation: string;
        model_version: string;
        version_number: number;
      };
      return {
        score: {
          overallScore: row.score,
          requiredMatches: (row.required_matches as EmployerFitScore["requiredMatches"]) ?? [],
          preferredMatches: (row.preferred_matches as EmployerFitScore["preferredMatches"]) ?? [],
          missingQualifications:
            (row.missing_qualifications as EmployerFitScore["missingQualifications"]) ?? [],
          missingSkills: (row.missing_skills as EmployerFitScore["missingSkills"]) ?? [],
          locationAlignment: (row.location_alignment as EmployerFitScore["locationAlignment"]) ?? {
            aligned: false,
            note: "",
          },
          blockers: (row.blockers as EmployerFitScore["blockers"]) ?? [],
          explanation: row.explanation ?? "",
        },
        versionNumber: row.version_number,
        cached: true,
      };
    }
  }

  const jobRow = job as {
    title: string;
    description: string | null;
    location: string | null;
    requirements_text: string | null;
    preferred_text: string | null;
    work_arrangement: string | null;
  };
  const appRow = application as { resume_snapshot: unknown };

  const score = await generateEmployerFitScore({
    jobTitle: jobRow.title,
    jobDescription: jobRow.description,
    requirementsText: jobRow.requirements_text,
    preferredText: jobRow.preferred_text,
    location: jobRow.location,
    workArrangement: jobRow.work_arrangement,
    resumeSnapshot: appRow.resume_snapshot,
  });

  const { data: existing } = await service
    .from("employer_fit_scores")
    .select("id,version_number")
    .eq("org_id", input.orgId)
    .eq("job_id", input.jobId)
    .eq("application_id", input.applicationId)
    .maybeSingle();

  const versionNumber =
    (((existing as { version_number: number } | null)?.version_number) ?? 0) + 1;

  const payload = {
    org_id: input.orgId,
    job_id: input.jobId,
    application_id: input.applicationId,
    score: score.overallScore,
    required_matches: score.requiredMatches,
    preferred_matches: score.preferredMatches,
    missing_qualifications: score.missingQualifications,
    missing_skills: score.missingSkills,
    location_alignment: score.locationAlignment,
    blockers: score.blockers,
    explanation: score.explanation,
    model_version: EMPLOYER_FIT_MODEL_VERSION,
    version_number: versionNumber,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await service
      .from("employer_fit_scores")
      .update(payload)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error("Could not save the Fit Score: " + error.message);
  } else {
    const { error } = await service.from("employer_fit_scores").insert(payload);
    if (error) throw new Error("Could not save the Fit Score: " + error.message);
  }

  if (score.overallScore >= STRONG_FIT_THRESHOLD) {
    const { data: jobTitle } = await service
      .from("employer_jobs")
      .select("title")
      .eq("id", input.jobId)
      .maybeSingle();
    await notifyStrongFit(input.orgId, {
      jobId: input.jobId,
      jobTitle: (jobTitle as { title: string } | null)?.title ?? "your job",
      applicationId: input.applicationId,
      score: score.overallScore,
    });
  }

  return { score, versionNumber, cached: false };
}

/**
 * Full pipeline history for a job (or the whole org), newest last.
 * Member-scoped RLS applies; the caller client is used directly.
 */
export async function getPipeline(
  client: EmployerClient,
  orgId: string,
  jobId?: string
): Promise<PipelineHistoryEntry[]> {
  let query = client
    .from("employer_pipeline_stages")
    .select("id,stage,changed_by,notes,created_at,application_id,job_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;
  if (error) {
    throw new Error("Could not load the pipeline: " + error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    jobId: row.job_id as string,
    applicationId: row.application_id as string,
    stage: row.stage as PipelineStage,
    changedBy: (row.changed_by as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/** Current stage per application, derived from the latest history row. */
export function currentStages(
  history: PipelineHistoryEntry[]
): Record<string, PipelineStage> {
  const current: Record<string, PipelineStage> = {};
  for (const entry of history) {
    current[entry.applicationId] = entry.stage;
  }
  return current;
}

async function notifyPipelineUpdated(
  orgId: string,
  input: { jobId: string; jobTitle: string; applicationId: string; stage: PipelineStage }
): Promise<void> {
  await notifyEmployerMembers(
    orgId,
    {
      notification_type: "EMPLOYER_PIPELINE_UPDATED",
      title: `Applicant moved to ${input.stage}`,
      message: `An applicant for ${input.jobTitle} moved to ${input.stage}.`,
      entity_type: "application",
      entity_id: input.applicationId,
      priority: "normal",
    },
    {
      dedupeTemplate: `employer:${orgId}:pipeline:${input.applicationId}:${input.stage}:{user}`,
    }
  );
}

/**
 * Append one pipeline transition. The application must belong to the job
 * through the attribution edge; the stage must be in the locked vocabulary.
 * History is insert-only: nothing is overwritten, so the audit trail is the
 * table itself.
 */
export async function transitionPipelineStage(
  service: ServiceClient,
  input: {
    orgId: string;
    jobId: string;
    applicationId: string;
    stage: PipelineStage;
    changedBy: string;
    notes?: string | null;
  }
): Promise<PipelineHistoryEntry> {
  // Verify the edge in two explicit steps: the job belongs to the org, and
  // the application sits on that job's opportunity row. Anything else is a
  // cross-org fabrication attempt and stops here.
  const [{ data: job }, { data: application }] = await Promise.all([
    service
      .from("employer_jobs")
      .select("id")
      .eq("id", input.jobId)
      .eq("org_id", input.orgId)
      .maybeSingle(),
    service
      .from("applications")
      .select("id,job_id")
      .eq("id", input.applicationId)
      .maybeSingle(),
  ]);

  if (!job || !application) {
    throw new Error("Application does not belong to this job.");
  }

  const { data: opportunity } = await service
    .from("job_opportunities")
    .select("id")
    .eq("id", (application as { job_id: string | null }).job_id ?? "")
    .eq("employer_job_id", input.jobId)
    .maybeSingle();

  if (!opportunity) {
    throw new Error("Application does not belong to this job.");
  }

  const { data, error } = await service
    .from("employer_pipeline_stages")
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      application_id: input.applicationId,
      stage: input.stage,
      changed_by: input.changedBy,
      notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
    })
    .select("id,stage,changed_by,notes,created_at")
    .single();

  if (error || !data) {
    throw new Error("Could not record the pipeline stage: " + (error?.message ?? "unknown"));
  }

  const row = data as unknown as {
    id: string;
    stage: PipelineStage;
    changed_by: string | null;
    notes: string | null;
    created_at: string;
  };

  const { data: jobRow } = await service
    .from("employer_jobs")
    .select("title")
    .eq("id", input.jobId)
    .maybeSingle();

  await notifyPipelineUpdated(input.orgId, {
    jobId: input.jobId,
    jobTitle: (jobRow as { title: string } | null)?.title ?? "your job",
    applicationId: input.applicationId,
    stage: input.stage,
  });

  // A move into the interview stage is additionally an interview event for
  // the hiring team, with its own dedupe identity per history row.
  if (input.stage === "interview") {
    await notifyEmployerMembers(
      input.orgId,
      {
        notification_type: "EMPLOYER_INTERVIEW_EVENT",
        title: `Interview scheduled for ${(jobRow as { title: string } | null)?.title ?? "your job"}`,
        message: "An applicant moved into the interview stage.",
        entity_type: "application",
        entity_id: input.applicationId,
        priority: "normal",
      },
      {
        dedupeTemplate: `employer:${input.orgId}:interview-event:${row.id}:{user}`,
      }
    );
  }

  return {
    id: row.id,
    jobId: input.jobId,
    applicationId: input.applicationId,
    stage: row.stage,
    changedBy: row.changed_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}
