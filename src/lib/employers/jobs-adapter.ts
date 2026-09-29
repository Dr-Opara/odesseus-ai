/**
 * INTEGRATION POINT — employer jobs backend (OpenCode Phase 2P-2S, not yet
 * shipped). No `/api/employers/*` route and no employer job table exist yet
 * (checked against `src/types/database.ts` and the route tree). Reads
 * (`getEmployerJobs`/`getEmployerJob`) fall back to dev fixtures outside
 * production. Mutations (publish/close/feature/create/update) never get a
 * fixture path — they always report `unavailable` until the real backend can
 * confirm the action, per F13-D "do not show action success before backend
 * confirmation."
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { EMPLOYER_JOB_FIXTURES } from "./fixtures/jobs";
import type { EmployerJob, EmployerJobDetail } from "./types";
import type { EmployerResult } from "./result";

export async function getEmployerJobs(): Promise<EmployerResult<EmployerJob[]>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Employer jobs API is not yet available." };
  }
  return { status: "ok", data: EMPLOYER_JOB_FIXTURES, source: "fixture" };
}

export async function getEmployerJob(jobId: string): Promise<EmployerResult<EmployerJobDetail>> {
  if (!isProductionRuntime()) {
    const job = EMPLOYER_JOB_FIXTURES.find((j) => j.id === jobId);
    if (job) return { status: "ok", data: job, source: "fixture" };
  }
  return { status: "unavailable", reason: "Employer job detail API is not yet available." };
}

export type EmployerJobInput = Omit<EmployerJobDetail, "id" | "status" | "createdAt" | "applicantCount" | "featured">;

/** INTEGRATION POINT: replace with a real create-job call once the backend ships. */
export async function createEmployerJob(_input: EmployerJobInput): Promise<EmployerResult<EmployerJob>> {
  return { status: "unavailable", reason: "Posting a job is not yet available." };
}

/** INTEGRATION POINT: replace with a real update call. Preserve backend-returned post-publish edit limits verbatim — never invent a frontend-only rule. */
export async function updateEmployerJob(
  _jobId: string,
  _input: Partial<EmployerJobInput>
): Promise<EmployerResult<EmployerJobDetail>> {
  return { status: "unavailable", reason: "Editing this job is not yet available." };
}

/** INTEGRATION POINT: backend is authoritative on capacity — never enforce the limit client-side. */
export async function publishEmployerJob(_jobId: string): Promise<EmployerResult<EmployerJob>> {
  return { status: "unavailable", reason: "Publishing is not yet available." };
}

export async function closeEmployerJob(_jobId: string): Promise<EmployerResult<EmployerJob>> {
  return { status: "unavailable", reason: "Closing this job is not yet available." };
}

/** INTEGRATION POINT: never mark a job featured until the backend confirms the purchase (F13-O). */
export async function featureEmployerJob(
  _jobId: string,
  _packageId: string
): Promise<EmployerResult<EmployerJob>> {
  return { status: "unavailable", reason: "Featuring this job is not yet available." };
}
