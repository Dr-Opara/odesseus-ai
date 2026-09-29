/**
 * INTEGRATION POINT — employer candidates/Fit Score backend (OpenCode Phase
 * 2P-2S, not yet shipped). OpenCode owns Fit Score calculation (F13-I) —
 * this adapter only ever displays a backend-provided score, and the dev
 * fixture exists purely as illustrative display data, gated the same as
 * every other read here. Never compute a score from these functions.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { CANDIDATE_FIXTURES } from "./fixtures/candidates";
import type { CandidateDetail, CandidateListItem, PipelineStage } from "./types";
import type { EmployerResult } from "./result";

export async function getCandidates(filter?: {
  jobId?: string;
  stage?: PipelineStage;
}): Promise<EmployerResult<CandidateListItem[]>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Candidates API is not yet available." };
  }
  let data: CandidateListItem[] = CANDIDATE_FIXTURES;
  if (filter?.jobId) data = data.filter((c) => c.appliedJobId === filter.jobId);
  if (filter?.stage) data = data.filter((c) => c.stage === filter.stage);
  return { status: "ok", data, source: "fixture" };
}

export async function getCandidateDetail(candidateId: string): Promise<EmployerResult<CandidateDetail>> {
  if (!isProductionRuntime()) {
    const candidate = CANDIDATE_FIXTURES.find((c) => c.id === candidateId);
    if (candidate) return { status: "ok", data: candidate, source: "fixture" };
  }
  return { status: "unavailable", reason: "Candidate detail API is not yet available." };
}
