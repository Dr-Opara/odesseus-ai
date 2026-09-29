/**
 * Employer jobs adapter (F1). Production uses the real backend:
 * GET/POST `/api/employer/orgs/{orgId}/jobs`,
 * GET/PATCH `/api/employer/orgs/{orgId}/jobs/{jobId}` (with
 * `{ action: "publish" | "close" | "delete" }` for lifecycle changes).
 *
 * Capacity errors (`no_credits`, `at_capacity`, `wrong_status`) come back from
 * the backend and are surfaced verbatim — the frontend never enforces or
 * invents a plan limit, and never reports a publish/close/delete success the
 * backend did not confirm.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { EMPLOYER_JOB_FIXTURES } from "./fixtures/jobs";
import {
  toEmployerJobStatus,
  toWorkArrangement,
  toEmployerPlanArrangement,
  type EmployerJob,
  type EmployerJobDetail,
  type EmployerJobInput,
  type FeaturedJobPackageId,
} from "./types";
import type { EmployerResult } from "./result";

/** Raw backend job row. */
type BackendJob = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  requirements_text?: string | null;
  preferred_text?: string | null;
  work_arrangement?: string | null;
  status?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  featured?: { isActive?: boolean; expiresAt?: string | null } | null;
};

type JobListPayload = { items?: BackendJob[]; total?: number };

function toJob(row: BackendJob): EmployerJobDetail {
  return {
    id: row.id,
    title: row.title,
    status: toEmployerJobStatus(row.status),
    // The backend owns featured state; absent data is "not featured", never a
    // guess, and a listing is only ever shown as featured when a live
    // featured-listing row says so.
    featured: Boolean(row.featured?.isActive),
    ...(row.featured?.expiresAt ? { featuredUntil: row.featured.expiresAt } : {}),
    ...(row.location ? { location: row.location } : {}),
    ...(toWorkArrangement(row.work_arrangement)
      ? { workArrangement: toWorkArrangement(row.work_arrangement)! }
      : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.requirements_text ? { requiredQualificationsText: row.requirements_text } : {}),
    ...(row.preferred_text ? { preferredQualificationsText: row.preferred_text } : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.posted_at ? { publishedAt: row.posted_at } : {}),
  };
}

function unavailable(reason: string): EmployerResult<never> {
  return { status: "unavailable", reason };
}

export async function getEmployerJobs(orgId: string): Promise<EmployerResult<EmployerJob[]>> {
  const response = await employerApi<JobListPayload>(`/api/employer/orgs/${orgId}/jobs?limit=100`);
  if (response.ok) {
    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    return { status: "ok", data: items.map(toJob), source: "live" };
  }
  if (isProductionRuntime()) return unavailable(response.reason);
  return { status: "ok", data: EMPLOYER_JOB_FIXTURES, source: "fixture" };
}

export async function getEmployerJob(
  orgId: string,
  jobId: string
): Promise<EmployerResult<EmployerJobDetail>> {
  const response = await employerApi<BackendJob>(
    `/api/employer/orgs/${orgId}/jobs/${encodeURIComponent(jobId)}`
  );
  if (response.ok && response.data?.id) {
    return { status: "ok", data: toJob(response.data), source: "live" };
  }
  if (!isProductionRuntime()) {
    const job = EMPLOYER_JOB_FIXTURES.find((j) => j.id === jobId);
    if (job) return { status: "ok", data: job, source: "fixture" };
  }
  return unavailable(response.ok ? "That job could not be found." : response.reason);
}

/** Create a draft. Publishing is a separate, backend-gated action. */
export async function createEmployerJob(
  orgId: string,
  input: EmployerJobInput
): Promise<EmployerResult<EmployerJobDetail>> {
  const response = await employerApi<BackendJob>(`/api/employer/orgs/${orgId}/jobs`, {
    method: "POST",
    body: {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.requiredQualificationsText
        ? { requirementsText: input.requiredQualificationsText }
        : {}),
      ...(input.preferredQualificationsText
        ? { preferredText: input.preferredQualificationsText }
        : {}),
      ...(toEmployerPlanArrangement(input.workArrangement)
        ? { workArrangement: toEmployerPlanArrangement(input.workArrangement) }
        : {}),
    },
  });
  if (response.ok && response.data?.id) {
    return { status: "ok", data: toJob(response.data), source: "live" };
  }
  return unavailable(response.ok ? "Odesseus could not create that job." : response.reason);
}

/**
 * Update a draft. The backend limits edits to drafts and returns 409
 * otherwise; that limit is presented exactly as the backend states it, never
 * as a frontend-only rule.
 */
export async function updateEmployerJob(
  orgId: string,
  jobId: string,
  input: Partial<EmployerJobInput>
): Promise<EmployerResult<EmployerJobDetail>> {
  const response = await employerApi<BackendJob>(
    `/api/employer/orgs/${orgId}/jobs/${encodeURIComponent(jobId)}`,
    {
      method: "PATCH",
      body: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.requiredQualificationsText !== undefined
          ? { requirementsText: input.requiredQualificationsText }
          : {}),
        ...(input.preferredQualificationsText !== undefined
          ? { preferredText: input.preferredQualificationsText }
          : {}),
        ...(input.workArrangement !== undefined
          ? { workArrangement: toEmployerPlanArrangement(input.workArrangement) ?? null }
          : {}),
      },
    }
  );
  if (response.ok && response.data?.id) {
    return { status: "ok", data: toJob(response.data), source: "live" };
  }
  return unavailable(response.ok ? "Odesseus could not save that job." : response.reason);
}

async function jobAction(
  orgId: string,
  jobId: string,
  action: "publish" | "close" | "delete",
  fallbackReason: string
): Promise<EmployerResult<EmployerJobDetail | null>> {
  const response = await employerApi<BackendJob | { ok?: boolean }>(
    `/api/employer/orgs/${orgId}/jobs/${encodeURIComponent(jobId)}`,
    { method: "PATCH", body: { action } }
  );
  if (response.ok) {
    const row = response.data as BackendJob;
    return { status: "ok", data: row?.id ? toJob(row) : null, source: "live" };
  }
  return unavailable(response.reason || fallbackReason);
}

/** Publish. The backend decides whether capacity or credits allow it. */
export async function publishEmployerJob(
  orgId: string,
  jobId: string
): Promise<EmployerResult<EmployerJobDetail>> {
  const result = await jobAction(orgId, jobId, "publish", "Publishing is not yet available.");
  if (result.status === "unavailable") return result;
  if (!result.data) return unavailable("Odesseus could not publish that job.");
  return { status: "ok", data: result.data, source: result.source };
}

/** Close a live posting. */
export async function closeEmployerJob(
  orgId: string,
  jobId: string
): Promise<EmployerResult<EmployerJobDetail>> {
  const result = await jobAction(orgId, jobId, "close", "Closing is not yet available.");
  if (result.status === "unavailable") return result;
  if (!result.data) return unavailable("Odesseus could not close that job.");
  return { status: "ok", data: result.data, source: result.source };
}

/** Delete a draft. A published or closed posting is refused by the backend. */
export async function deleteEmployerJobDraft(
  orgId: string,
  jobId: string
): Promise<EmployerResult<null>> {
  const result = await jobAction(orgId, jobId, "delete", "Deleting a draft is not yet available.");
  return result.status === "ok" ? { status: "ok", data: null, source: "live" } : result;
}

/**
 * Start a featured-listing checkout. A job is never marked featured here: the
 * boost only begins once Stripe confirms payment and the backend creates the
 * listing, which the featured view then reflects.
 */
export async function featureEmployerJob(
  orgId: string,
  jobId: string,
  tier: FeaturedJobPackageId
): Promise<EmployerResult<{ checkoutUrl: string }>> {
  const response = await employerApi<{ url?: string }>(
    `/api/employer/orgs/${orgId}/featured/checkout`,
    { method: "POST", body: { jobId, tier } }
  );
  if (response.ok && response.data?.url) {
    return { status: "ok", data: { checkoutUrl: response.data.url }, source: "live" };
  }
  return unavailable(response.ok ? "Checkout could not start." : response.reason);
}
