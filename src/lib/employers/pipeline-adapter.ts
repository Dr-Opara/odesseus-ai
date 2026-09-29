/**
 * INTEGRATION POINT — hiring pipeline backend (OpenCode Phase 2P-2S, not yet
 * shipped). `getPipelineBoard` groups the same candidate data
 * `candidates-adapter.ts` reads by the locked `PIPELINE_STAGES`. Backend
 * remains authoritative on stage transitions (F13-K); `moveCandidateStage`
 * always reports `unavailable` until it exists, so the Pipeline screen's
 * optimistic-update UI (built in Checkpoint 5) has a real failure path to
 * roll back against rather than assuming success.
 */
import { getCandidates } from "./candidates-adapter";
import { PIPELINE_STAGES, type CandidateListItem, type PipelineStage } from "./types";
import type { EmployerResult } from "./result";

export type PipelineBoard = Record<PipelineStage, CandidateListItem[]>;

export async function getPipelineBoard(filter?: { jobId?: string }): Promise<EmployerResult<PipelineBoard>> {
  const candidates = await getCandidates(filter);
  if (candidates.status !== "ok") return candidates;

  const board = {} as PipelineBoard;
  for (const stage of PIPELINE_STAGES) board[stage] = [];
  for (const candidate of candidates.data) {
    board[candidate.stage].push(candidate);
  }
  return { status: "ok", data: board, source: candidates.source };
}

/** INTEGRATION POINT: replace with a real stage-transition call once the backend ships. */
export async function moveCandidateStage(
  _candidateId: string,
  _toStage: PipelineStage
): Promise<EmployerResult<CandidateListItem>> {
  return { status: "unavailable", reason: "Moving candidates between stages is not yet available." };
}
