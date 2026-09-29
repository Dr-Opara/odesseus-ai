/**
 * Employer jobs adapter — real backend reads and writes.
 *
 * This module previously returned development fixtures outside production and
 * refused every mutation. The employer jobs backend exists
 * (`src/lib/employer/service.ts`, exposed through
 * `/api/employer/orgs/[orgId]/jobs/*`), so both halves are wired.
 *
 * What did not change, and must not:
 *
 *  - The organization comes from the caller's membership row
 *    (`resolveEmployerContext`), never from a parameter. A page cannot be
 *    pointed at another company's jobs.
 *  - Writes call the same service functions the API routes call. The rules
 *    are not reimplemented here, so a client cannot invent a policy the
 *    server would reject. Capacity, plan status, and the draft-only edit rule
 *    are the service's, and its reason codes are translated below into the
 *    sentence the employer actually needs to read.
 *  - A rejected write returns `unavailable`. There is no optimistic success:
 *    a job is never shown as published, closed, or featured until the
 *    backend confirmed it.
 *
 * The service takes a plain Supabase client and relies on RLS plus the
 * `org_id` filter for scoping. That is why every call here passes the
 * caller's own session client rather than the service client: a service-role
 * client bypasses RLS, and using one for a user-initiated write would hand
 * the browser's request the database's full privileges. The one place a
 * service client is correct is `featured/checkout`, which is reached over
 * HTTP so the real route (and its admin check) stays the gate.
 */

import { createClient } from "@/lib/supabase/server";
import {
  closeJob,
  createJob,
  deleteJob,
  getEmployerSubscription,
  getJob,
  listJobs,
  publishJob,
  updateJob,
  type UpdateJobInput,
} from "@/lib/employer/service";
import { planForTier } from "@/lib/employer/plans";
import { toFormEmploymentType, toStoredEmploymentType } from "@/lib/employer/service";
import { resolveEmployerContext, isHiringManagerContext } from "./context";
import { parseJobDescription, splitRequirementLines } from "./job-description";
import type { EmployerJob, EmployerJobDetail, EmployerJobStatus, WorkArrangement } from "./types";
import type { EmployerResult } from "./result";

/** The plan names the Figma components render. */
type PlanName = "Starter" | "Growth" | "Business";

/** The backend's stored job statuses, narrowed to the Figma vocabulary. */
function jobStatus(status: string): EmployerJobStatus {
  if (status === "published") return "Published";
  if (status === "closed") return "Closed";
  return "Draft";
}

/** A backend `employer_jobs` row, in the camelCase the service returns. */
type ServiceJob = {
  id: string;
  title: string;
  description?: string | null;
  department?: string | null;
  employmentType?: string | null;
  compensationText?: string | null;
  responsibilitiesText?: string | null;
  location: string | null;
  requirementsText?: string | null;
  preferredText?: string | null;
  workArrangement?: string | null;
  status: string;
  postedAt: string | null;
  createdAt: string | null;
  featured?: { tier: string; isActive: boolean; expiresAt: string | null } | null;
};

/**
 * The work arrangement in the vocabulary the Figma form's options use.
 *
 * The backend stores it lowercase; the form offers "Remote"/"Hybrid"/
 * "On-site". An unrecognised stored value becomes `undefined` rather than
 * being coerced to one of the three, because picking a label the employer did
 * not choose would misstate the job.
 */
function toDisplayArrangement(value: string | null | undefined): WorkArrangement | undefined {
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "onsite" || value === "on-site") return "On-site";
  return undefined;
}

/** Projects a backend job row onto the Figma display type. */
function toDisplayJob(row: ServiceJob): EmployerJob {
  return {
    id: row.id,
    title: row.title,
    location: row.location ?? undefined,
    workArrangement: toDisplayArrangement(row.workArrangement),
    status: jobStatus(row.status),
    createdAt: row.createdAt ?? row.postedAt ?? new Date().toISOString(),
    publishedAt: row.postedAt ?? undefined,
    featured: Boolean(row.featured?.isActive),
    featuredUntil: row.featured?.isActive ? (row.featured.expiresAt ?? undefined) : undefined,
  };
}

/**
 * The four structured fields, preferring the column over the legacy block.
 *
 * Jobs created before the columns existed carry these values inside
 * `description`, and the migration backfilled what it could recognise. A row
 * that still has a null column but a recognisable block is one the backfill
 * did not reach -- a job written by a path other than the employer form -- so
 * the block is read as a fallback rather than the value being dropped.
 *
 * The column always wins. Once an employer edits a job through the form, the
 * columns are authoritative and a stale block must not override them.
 */
export function toStructuredFields(row: ServiceJob) {
  const legacy = parseJobDescription(row.description);
  // The legacy parser already returns responsibilities as display lines, so
  // that branch needs no second split. The column stores them newline-delimited.
  const legacyResponsibilities = legacy.responsibilities?.length
    ? legacy.responsibilities
    : undefined;

  return {
    department: row.department ?? legacy.department,
    employmentType: row.employmentType
      ? toFormEmploymentType(row.employmentType)
      : legacy.employmentType,
    compensationText: row.compensationText ?? legacy.compensationText,
    responsibilities: splitLines(row.responsibilitiesText) ?? legacyResponsibilities,
  };
}

function toDisplayDetail(row: ServiceJob): EmployerJobDetail {
  return {
    ...toDisplayJob(row),
    ...toStructuredFields(row),
    // The free-text body is what remains once the folded blocks are removed,
    // so a job written through the form no longer shows its department and
    // compensation twice.
    description: parseJobDescription(row.description).body,
    requiredQualifications: splitRequirementLines(row.requirementsText),
    preferredQualifications: splitRequirementLines(row.preferredText),
  };
}

/** Splits a stored newline-delimited field into display lines. */
function splitLines(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}

/** Maps the Figma form's work-arrangement vocabulary to the stored one. */
function toWorkArrangement(value: string | undefined): "remote" | "hybrid" | "onsite" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "remote") return "remote";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "onsite" || normalized === "on-site") return "onsite";
  return null;
}

/**
 * The service's refusal codes, in the employer's words.
 *
 * These are not the backend's messages — it returns stable codes so a caller
 * cannot scrape database text. Translating here keeps the vocabulary in one
 * place, and keeps a raw internal string out of the page.
 */
const JOB_REFUSALS = {
  not_found: "That job could not be found.",
  wrong_status: "Only a draft job can be edited or published. Close a published job first.",
  no_credits: "Your plan has no active job posts. Update your plan to publish this job.",
  at_capacity: "Your plan's active job limit is reached. Close a job or upgrade your plan.",
} as const;

type JobRefusal = keyof typeof JOB_REFUSALS;

/** Narrows a service refusal code, treating anything unknown as not-found. */
function refusalOf(value: string): EmployerResult<never> {
  const reason = JOB_REFUSALS[value as JobRefusal] ?? JOB_REFUSALS.not_found;
  return { status: "unavailable", reason };
}

/**
 * The organization's jobs, newest first.
 *
 * `applicantCount` is left undefined on purpose: the backend's job rows carry
 * no applicant count, and the counts that do exist live on the analytics
 * aggregate. The UI renders the job's real status rather than a number
 * invented to fill the field.
 */
export async function getEmployerJobs(): Promise<EmployerResult<EmployerJob[]>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const { items } = await listJobs(supabase, resolved.context.orgId, { limit: 100 });
    return { status: "ok", data: items.map((job) => toDisplayJob(job as ServiceJob)), source: "live" };
  } catch (error) {
    return toFailure("load your jobs", error);
  }
}

export async function getEmployerJob(jobId: string): Promise<EmployerResult<EmployerJobDetail>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const job = await getJob(supabase, resolved.context.orgId, jobId);
    if (!job) return refusalOf("not_found");
    return { status: "ok", data: toDisplayDetail(job as ServiceJob), source: "live" };
  } catch (error) {
    return toFailure("load this job", error);
  }
}

/**
 * The input the Figma Post Job and Edit Job forms collect.
 *
 * `department`, `employmentType`, `compensationText`, and `responsibilities`
 * each have their own column on `employer_jobs`. They used to be folded into
 * the description as a labelled block; see `./job-description` for the legacy
 * format and why the read path still understands it.
 */
export type EmployerJobInput = {
  title: string;
  location?: string;
  workArrangement?: string;
  /** The employer's free-text role summary. Stored as typed, with nothing appended. */
  description?: string;
  department?: string;
  employmentType?: string;
  compensationText?: string;
  /** Requirement prose, one item per line from the Figma textareas. */
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  /** One item per line. */
  responsibilities?: string[];
};

/** Joins the form's requirement fields into the backend's prose column. */
function requirementsText(input: Partial<EmployerJobInput>): string | null {
  const parts: string[] = [];
  if (input.requiredQualifications?.length) parts.push(input.requiredQualifications.join("\n"));
  if (input.preferredQualifications?.length) parts.push(input.preferredQualifications.join("\n"));
  return parts.join("\n\n").trim() || null;
}

/** The four structured fields, mapped onto the columns that now hold them. */
function structuredFields(input: Partial<EmployerJobInput>) {
  return {
    department: input.department?.trim() || null,
    employmentType: toStoredEmploymentType(input.employmentType),
    compensationText: input.compensationText?.trim() || null,
    responsibilitiesText: (input.responsibilities ?? []).join("\n").trim() || null,
  };
}

/**
 * Creates a draft job.
 *
 * Publishing is a separate, explicit step: creating never publishes, so the
 * employer sees the draft before it consumes any of their plan's job posts.
 */
export async function createEmployerJob(
  input: EmployerJobInput
): Promise<EmployerResult<EmployerJob>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can post a job." };
  }

  const title = input.title?.trim();
  if (!title) return { status: "unavailable", reason: "Enter a job title." };

  try {
    const supabase = await createClient();
    const job = await createJob(supabase, resolved.context.orgId, {
      title,
      description: input.description?.trim() || null,
      location: input.location?.trim() || null,
      requirementsText: requirementsText(input),
      preferredText: null,
      workArrangement: toWorkArrangement(input.workArrangement),
      ...structuredFields(input),
    });
    return { status: "ok", data: toDisplayJob(job as ServiceJob), source: "live" };
  } catch (error) {
    return toFailure("post this job", error);
  }
}

/**
 * Edits a job.
 *
 * The service refuses edits to anything but a draft. That limit is passed
 * through as-is: reimplementing it client-side would be a second policy that
 * could disagree with the server's.
 */
export async function updateEmployerJob(
  jobId: string,
  input: Partial<EmployerJobInput>
): Promise<EmployerResult<EmployerJobDetail>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can edit a job." };
  }

  const patch: UpdateJobInput = {};

  // Each of the four is its own column now, so a compensation-only save cannot
  // blank the body the employer did not touch: the fields are independent and
  // only the ones the caller actually sent are written.
  //
  // Requirements are the one exception. `requirements_text` holds both the
  // required and the preferred lists as a single prose column, so changing
  // either means rebuilding it from the current stored value merged with the
  // edit.
  const touchesRequirements =
    input.requiredQualifications !== undefined || input.preferredQualifications !== undefined;

  if (touchesRequirements) {
    const current = (await getJob(await createClient(), resolved.context.orgId, jobId)) as ServiceJob | null;
    if (!current) return refusalOf("not_found");

    patch.requirementsText = requirementsText({
      requiredQualifications:
        input.requiredQualifications ?? splitRequirementLines(current.requirementsText) ?? [],
      preferredQualifications:
        input.preferredQualifications ?? splitRequirementLines(current.preferredText) ?? [],
    });
  }

  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.location !== undefined) patch.location = input.location.trim() || null;
  if (input.workArrangement !== undefined) {
    patch.workArrangement = toWorkArrangement(input.workArrangement);
  }
  if (input.description !== undefined) patch.description = input.description.trim() || null;
  if (input.department !== undefined) patch.department = input.department.trim() || null;
  if (input.employmentType !== undefined) {
    patch.employmentType = toStoredEmploymentType(input.employmentType);
  }
  if (input.compensationText !== undefined) {
    patch.compensationText = input.compensationText.trim() || null;
  }
  if (input.responsibilities !== undefined) {
    patch.responsibilitiesText = input.responsibilities.join("\n").trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return { status: "unavailable", reason: "There is nothing to save." };
  }

  try {
    const supabase = await createClient();
    const job = await updateJob(supabase, resolved.context.orgId, jobId, patch);
    if ("reason" in job) return refusalOf(job.reason);
    return { status: "ok", data: toDisplayDetail(job as ServiceJob), source: "live" };
  } catch (error) {
    return toFailure("save this job", error);
  }
}

/**
 * Publishes a job.
 *
 * Capacity is the service's decision, checked against the organization's real
 * plan allowance and the live count of published jobs, then re-asserted by the
 * `claim_job_post_credit` trigger under concurrency. This adapter never
 * counts locally and never assumes success.
 */
export async function publishEmployerJob(jobId: string): Promise<EmployerResult<EmployerJob>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can publish a job." };
  }

  try {
    const supabase = await createClient();
    const result = await publishJob(supabase, resolved.context.orgId, jobId);
    if (!result.ok) return refusalOf(result.reason);
    return { status: "ok", data: toDisplayJob(result.job as ServiceJob), source: "live" };
  } catch (error) {
    return toFailure("publish this job", error);
  }
}

export async function closeEmployerJob(jobId: string): Promise<EmployerResult<EmployerJob>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can close a job." };
  }

  try {
    const supabase = await createClient();
    const result = await closeJob(supabase, resolved.context.orgId, jobId);
    if (!result.ok) return refusalOf(result.reason);
    return { status: "ok", data: toDisplayJob(result.job as ServiceJob), source: "live" };
  } catch (error) {
    return toFailure("close this job", error);
  }
}

/** Deletes a draft. A published job must be closed first; that is the service's rule. */
export async function deleteEmployerJob(jobId: string): Promise<EmployerResult<null>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can delete a draft." };
  }

  try {
    const supabase = await createClient();
    const result = await deleteJob(supabase, resolved.context.orgId, jobId);
    if (!result.ok) return refusalOf(result.reason);
    return { status: "ok", data: null, source: "live" };
  } catch (error) {
    return toFailure("delete this draft", error);
  }
}

/**
 * Starts a featured-listing checkout.
 *
 * This is a Stripe purchase and deliberately does not mark the job featured:
 * visibility only begins once the webhook confirms payment and the backend
 * activates the listing. The caller is sent to the returned checkout URL.
 */
export async function featureEmployerJob(
  jobId: string,
  tier: string
): Promise<EmployerResult<{ url: string; tier: string; days: number }>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;
  if (!isHiringManagerContext(resolved.context)) {
    return { status: "unavailable", reason: "Only hiring managers can feature a job." };
  }

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}/featured/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, tier }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      tier?: string;
      days?: number;
      error?: string;
    };
    if (!response.ok || !payload.url) {
      return { status: "unavailable", reason: payload.error ?? "Could not start checkout." };
    }
    return {
      status: "ok",
      data: { url: payload.url, tier: payload.tier ?? tier, days: payload.days ?? 0 },
      source: "live",
    };
  } catch (error) {
    return toFailure("start the featured checkout", error);
  }
}

/**
 * The plan's active-job capacity, for the capacity badge.
 *
 * The limit is read from the stored subscription and mapped through the
 * approved plan table, so it is the number the server will enforce rather than
 * a copy. An unrecognised tier yields a `null` limit, which the badge renders
 * as unknown instead of borrowing another plan's number.
 */
export async function getEmployerCapacity(): Promise<
  EmployerResult<{ activeJobCount: number; planLimit: number | null; planId: PlanName | null }>
> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const [subscription, jobs] = await Promise.all([
      getEmployerSubscription(supabase, resolved.context.orgId),
      listJobs(supabase, resolved.context.orgId, { limit: 100 }),
    ]);

    const plan = planForTier(subscription?.tier);

    return {
      status: "ok",
      source: "live",
      data: {
        activeJobCount: jobs.items.filter((job) => job.status === "published").length,
        planLimit: plan ? plan.jobPostsIncluded : null,
        planId: (plan?.name as PlanName | undefined) ?? null,
      },
    };
  } catch (error) {
    return toFailure("load your plan capacity", error);
  }
}

/**
 * Turns a service-layer throw into the honest failure state.
 *
 * The message is not shown to the employer: these throws carry database text,
 * and the page should say what happened rather than print a query. The
 * refusal codes above are the ones written for people.
 */
function toFailure(subject: string, error: unknown): EmployerResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ODESSEUS_EMPLOYER_JOBS] ${subject} failed`, message);
  return { status: "unavailable", reason: `Odesseus could not ${subject} right now.` };
}
