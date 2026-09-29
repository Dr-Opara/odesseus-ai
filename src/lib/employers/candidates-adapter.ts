/**
 * Employer candidates / Fit Score adapter (F1). Production uses the real
 * backend:
 * GET `/api/employer/orgs/{orgId}/candidates` (optionally `?jobId=`),
 * GET `/api/employer/orgs/{orgId}/candidates/{applicationId}`,
 * POST `/api/employer/orgs/{orgId}/candidates/{applicationId}/fit-score`.
 *
 * Two rules hold here:
 * 1. Fit Score is backend-authoritative. This adapter only displays a score
 *    the backend produced; it never computes one, and a candidate with no
 *    score renders as "not available" rather than a number.
 * 2. Applicants are addressed by application id. No candidate user id, and no
 *    candidate-private Live/prep/analysis content, is ever read or displayed.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { CANDIDATE_FIXTURES } from "./fixtures/candidates";
import {
  toPipelineStage,
  type CandidateDetail,
  type CandidateListItem,
  type FitScore,
  type PipelineStage,
} from "./types";
import type { EmployerResult } from "./result";

type BackendApplicant = {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  jobStatus?: string | null;
  applicationStatus?: string | null;
  submittedAt?: string | null;
  companyName?: string | null;
  roleTitle?: string | null;
  resumeSnapshot?: unknown;
  jobSnapshot?: unknown;
  matchScoreSnapshot?: number | null;
  verificationEvidence?: unknown;
};

type BackendFitScore = {
  score?: number;
  requiredMatches?: { requirement?: string; matched?: boolean; evidence?: string[] }[] | null;
  preferredMatches?: { preference?: string; matched?: boolean; evidence?: string[] }[] | null;
  missingQualifications?: string[] | null;
  missingSkills?: string[] | null;
  locationAlignment?: { aligned?: boolean; note?: string } | null;
  blockers?: { blocker?: string; detail?: string }[] | null;
  explanation?: string | null;
};

type JobSnapshotLike = {
  location?: string | null;
  company_name?: string | null;
  role_title?: string | null;
};

function readJobSnapshot(value: unknown): JobSnapshotLike | null {
  return value && typeof value === "object" ? (value as JobSnapshotLike) : null;
}

/** Only the text the employer actually wrote; never summarized or invented. */
function readRequirementsText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Record<string, unknown>;
  const text = snapshot.requirements_text ?? snapshot.requirementsText;
  return typeof text === "string" && text.trim() ? text : undefined;
}

function toCandidate(
  applicant: BackendApplicant,
  stage: PipelineStage | null,
  fitScoreOverall?: number
): CandidateListItem {
  const snapshot = readJobSnapshot(applicant.jobSnapshot);
  return {
    id: applicant.applicationId,
    appliedJobId: applicant.jobId,
    appliedJobTitle: applicant.jobTitle,
    // An applicant the backend has never moved sits at the start of the
    // locked funnel; a moved one carries its real current stage.
    stage: stage ?? "APPLIED",
    ...(typeof fitScoreOverall === "number" ? { fitScoreOverall } : {}),
    ...(snapshot?.location ? { location: snapshot.location } : {}),
    ...(applicant.submittedAt ? { appliedAt: applicant.submittedAt } : {}),
  };
}

function toFitScore(row: BackendFitScore): FitScore | undefined {
  if (typeof row?.score !== "number") return undefined;
  const required = row.requiredMatches ?? [];
  const preferred = row.preferredMatches ?? [];
  const evidence = [...required, ...preferred]
    .flatMap((match) => (Array.isArray(match?.evidence) ? match.evidence : []))
    .filter((item): item is string => typeof item === "string" && item.length > 0);

  return {
    overall: row.score,
    requiredMatches: required
      .filter((match) => match?.matched)
      .map((match) => match.requirement ?? "")
      .filter(Boolean),
    preferredMatches: preferred
      .filter((match) => match?.matched)
      .map((match) => match.preference ?? "")
      .filter(Boolean),
    resumeEvidence: Array.from(new Set(evidence)),
    missingQualifications: row.missingQualifications ?? [],
    missingSkills: row.missingSkills ?? [],
    locationAlignment: typeof row.locationAlignment?.aligned === "boolean" ? row.locationAlignment.aligned : undefined,
    blockers: (row.blockers ?? [])
      .map((blocker) =>
        blocker?.detail ? `${blocker.blocker ?? ""} — ${blocker.detail}` : (blocker?.blocker ?? "")
      )
      .filter(Boolean),
    ...(row.explanation ? { explanation: row.explanation } : {}),
  };
}

function unavailable(reason: string): EmployerResult<never> {
  return { status: "unavailable", reason };
}

type StageLookup = (applicationId: string) => PipelineStage | null;

/** Current stage per application, read from the org's pipeline history. */
async function loadStageLookup(orgId: string, jobId?: string): Promise<StageLookup> {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const response = await employerApi<{ current?: Record<string, string> }>(
    `/api/employer/orgs/${orgId}/pipeline${query}`
  );
  const current = response.ok ? response.data?.current ?? {} : {};
  return (applicationId) => toPipelineStage(current[applicationId]);
}

export async function getCandidates(
  orgId: string,
  filter?: { jobId?: string; stage?: PipelineStage }
): Promise<EmployerResult<CandidateListItem[]>> {
  const [applicantsResponse, stageFor] = await Promise.all([
    employerApi<{ applicants?: BackendApplicant[] }>(
      `/api/employer/orgs/${orgId}/candidates${filter?.jobId ? `?jobId=${encodeURIComponent(filter.jobId)}` : ""}`
    ),
    loadStageLookup(orgId, filter?.jobId),
  ]);

  if (applicantsResponse.ok) {
    const applicants = Array.isArray(applicantsResponse.data?.applicants)
      ? applicantsResponse.data.applicants
      : [];
    const data = applicants
      .map((applicant) => toCandidate(applicant, stageFor(applicant.applicationId)))
      .filter((candidate) => (filter?.stage ? candidate.stage === filter.stage : true));
    return { status: "ok", data, source: "live" };
  }

  if (isProductionRuntime()) return unavailable(applicantsResponse.reason);

  let data: CandidateListItem[] = CANDIDATE_FIXTURES;
  if (filter?.jobId) data = data.filter((c) => c.appliedJobId === filter.jobId);
  if (filter?.stage) data = data.filter((c) => c.stage === filter.stage);
  return { status: "ok", data, source: "fixture" };
}

export async function getCandidateDetail(
  orgId: string,
  candidateId: string
): Promise<EmployerResult<CandidateDetail>> {
  const [applicantResponse, stageFor] = await Promise.all([
    employerApi<{ applicant?: BackendApplicant }>(
      `/api/employer/orgs/${orgId}/candidates/${encodeURIComponent(candidateId)}`
    ),
    loadStageLookup(orgId),
  ]);

  if (applicantResponse.ok && applicantResponse.data?.applicant) {
    const applicant = applicantResponse.data.applicant;
    const stage = stageFor(applicant.applicationId);
    const base = toCandidate(applicant, stage);
    const fitScoreResponse = await employerApi<{ fitScore?: BackendFitScore }>(
      `/api/employer/orgs/${orgId}/candidates/${encodeURIComponent(candidateId)}/fit-score`,
      { method: "POST", body: { jobId: applicant.jobId } }
    );
    const fitScore = fitScoreResponse.ok ? toFitScore(fitScoreResponse.data?.fitScore ?? {}) : undefined;

    return {
      status: "ok",
      source: "live",
      data: {
        ...base,
        ...(fitScore ? { fitScore, fitScoreOverall: fitScore.overall } : {}),
        ...(readRequirementsText(applicant.jobSnapshot)
          ? { requiredQualificationsText: readRequirementsText(applicant.jobSnapshot) }
          : {}),
      },
    };
  }

  if (!isProductionRuntime()) {
    const candidate = CANDIDATE_FIXTURES.find((c) => c.id === candidateId);
    if (candidate) return { status: "ok", data: candidate, source: "fixture" };
  }
  return unavailable(applicantResponse.ok ? "That applicant could not be found." : applicantResponse.reason);
}
