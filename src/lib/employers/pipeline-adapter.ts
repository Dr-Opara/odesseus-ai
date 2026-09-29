/**
 * Hiring pipeline adapter — real backend reads and transitions.
 *
 * The board is derived from the same two sources the backend's pipeline
 * endpoint uses: the organization's applicants (`listApplicants`) and the
 * append-only `employer_pipeline_stages` history (`getPipeline`). An
 * applicant with no history row is in `APPLIED`, which is what the backend's
 * own `currentStages` implies rather than a client-side invention.
 *
 * Transitions go over HTTP to `POST /api/employer/orgs/[orgId]/pipeline` so
 * the route's hiring-manager check stays the gate. That route appends to the
 * history table through a service client after verifying the application
 * belongs to the job through the attribution edge — a browser cannot skip that
 * check, so this adapter never writes a stage itself.
 *
 * The optimistic UI in `CandidateStageActions` rolls back on any failure. That
 * is safe precisely because a failure here is a real refusal, never a silent
 * success: nothing is reported as moved until the backend confirmed it.
 */

import { createClient } from "@/lib/supabase/server";
import { getPipeline, listApplicants } from "@/lib/employer/hiring";
import { resolveEmployerContext, isHiringManagerContext } from "./context";
import { DEFAULT_STAGE, isStoredStage, toProductStage } from "./stages";
import { PIPELINE_STAGES, type CandidateListItem, type PipelineStage } from "./types";
import type { EmployerResult } from "./result";

export type PipelineBoard = Record<PipelineStage, CandidateListItem[]>;

/** Reasons the pipeline route returns, in the employer's words. */
const TRANSITION_REFUSALS: Record<string, string> = {
  not_a_member: "That team could not be found.",
  forbidden: "Only hiring managers can move applicants.",
  not_found: "That applicant could not be found.",
  invalid_stage: "Choose a valid pipeline stage.",
};

/**
 * The pipeline board, grouped by the locked stage set.
 *
 * Every stage key is always present, including empty ones, so the screen
 * renders the full pipeline rather than collapsing stages with no applicants.
 */
export async function getPipelineBoard(filter?: {
  jobId?: string;
}): Promise<EmployerResult<PipelineBoard>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const orgId = resolved.context.orgId;

    const [applicants, history] = await Promise.all([
      listApplicants(supabase, orgId, filter?.jobId),
      getPipeline(supabase, orgId, filter?.jobId),
    ]);

    // The history is append-only and ordered ascending, so the last row per
    // application is its current stage.
    const current: Record<string, PipelineStage> = {};
    for (const entry of history) {
      current[entry.applicationId] = toProductStage(entry.stage);
    }

    const board = Object.fromEntries(
      PIPELINE_STAGES.map((stage) => [stage, [] as CandidateListItem[]])
    ) as PipelineBoard;

    for (const raw of applicants) {
      const applicant = raw as {
        applicationId: string;
        jobId: string;
        jobTitle: string;
        submittedAt: string | null;
        roleTitle: string;
      };
      const stage = current[applicant.applicationId] ?? DEFAULT_STAGE;
      board[stage].push({
        id: applicant.applicationId,
        name: applicant.roleTitle?.trim() || "Applicant",
        appliedJobId: applicant.jobId,
        appliedJobTitle: applicant.jobTitle,
        stage,
        appliedAt: applicant.submittedAt ?? new Date(0).toISOString(),
      });
    }

    return { status: "ok", data: board, source: "live" };
  } catch (error) {
    return toFailure("load your pipeline", error);
  }
}

/**
 * Moves one applicant to a stage.
 *
 * The returned item is the applicant's new stage as the backend recorded it,
 * not the stage that was requested — the backend owns the transition.
 */
export async function moveCandidateStage(
  applicationId: string,
  toStage: PipelineStage,
  options?: { jobId?: string; notes?: string }
): Promise<EmployerResult<CandidateListItem>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: TRANSITION_REFUSALS.forbidden };
  }

  // The route requires the job id: it verifies the application belongs to that
  // job through the attribution edge before recording anything.
  if (!options?.jobId) {
    return { status: "unavailable", reason: "The job for this applicant could not be resolved." };
  }

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: options.jobId,
        applicationId,
        stage: toStage,
        notes: options.notes ?? null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      entry?: { stage?: string };
      error?: string;
    };

    if (!response.ok) {
      return {
        status: "unavailable",
        reason: payload.error ?? "Could not move this applicant.",
      };
    }

    // Trust the recorded stage, not the requested one.
    const stage: PipelineStage = isStoredStage(payload.entry?.stage)
      ? toProductStage(payload.entry.stage as never)
      : toStage;

    return {
      status: "ok",
      source: "live",
      data: {
        id: applicationId,
        name: "Applicant",
        appliedJobId: options.jobId,
        appliedJobTitle: "",
        stage,
        appliedAt: new Date(0).toISOString(),
      },
    };
  } catch (error) {
    return toFailure("move this applicant", error);
  }
}

function toFailure(subject: string, error: unknown): EmployerResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ODESSEUS_EMPLOYER_PIPELINE] ${subject} failed`, message);
  return { status: "unavailable", reason: `Odesseus could not ${subject} right now.` };
}

export { TRANSITION_REFUSALS };
