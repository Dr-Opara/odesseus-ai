/**
 * Hiring pipeline adapter (F1). Production uses the real backend:
 * GET `/api/employer/orgs/{orgId}/pipeline` (history + current stage per
 * application) and POST `/api/employer/orgs/{orgId}/pipeline` to append one
 * transition.
 *
 * History is insert-only on the backend, so the board is derived from the
 * latest row per applicant rather than from any client-side state. The
 * Pipeline screen applies the move optimistically and rolls back when this
 * call reports a failure — it never assumes success.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { getCandidates } from "./candidates-adapter";
import {
  PIPELINE_STAGES,
  toBackendStage,
  toPipelineStage,
  type CandidateListItem,
  type PipelineStage,
} from "./types";
import type { EmployerResult } from "./result";

export type PipelineBoard = Record<PipelineStage, CandidateListItem[]>;

export type PipelineTransitionInput = {
  jobId: string;
  applicationId: string;
  toStage: PipelineStage;
  notes?: string;
};

function emptyBoard(): PipelineBoard {
  const board = {} as PipelineBoard;
  for (const stage of PIPELINE_STAGES) board[stage] = [];
  return board;
}

export async function getPipelineBoard(
  orgId: string,
  filter?: { jobId?: string }
): Promise<EmployerResult<PipelineBoard>> {
  const candidates = await getCandidates(orgId, filter);
  if (candidates.status !== "ok") return candidates;

  const board = emptyBoard();
  for (const candidate of candidates.data) board[candidate.stage].push(candidate);
  return { status: "ok", data: board, source: candidates.source };
}

export type PipelineTransitionResult = {
  stage: PipelineStage;
  changedAt: string;
};

/**
 * Append one pipeline transition. The backend owns the stage vocabulary and
 * the per-application job edge, so a rejected move surfaces the backend's own
 * message and the caller rolls back.
 */
export async function moveCandidateStage(
  orgId: string,
  input: PipelineTransitionInput
): Promise<EmployerResult<PipelineTransitionResult>> {
  const response = await employerApi<{ entry?: { stage?: string; created_at?: string } }>(
    `/api/employer/orgs/${orgId}/pipeline`,
    {
      method: "POST",
      body: {
        jobId: input.jobId,
        applicationId: input.applicationId,
        stage: toBackendStage(input.toStage),
        ...(input.notes ? { notes: input.notes } : {}),
      },
    }
  );

  const stage = toPipelineStage(response.ok ? response.data?.entry?.stage : null);
  if (response.ok && stage) {
    return {
      status: "ok",
      source: "live",
      data: { stage, changedAt: response.data?.entry?.created_at ?? new Date().toISOString() },
    };
  }
  return {
    status: "unavailable",
    reason: response.ok ? "Odesseus could not record that stage change." : response.reason,
  };
}
