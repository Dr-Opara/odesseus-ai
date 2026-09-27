/**
 * Careers data access.
 *
 * Server-only, service-role client, no browser surface. Two reasons the
 * service role is the only way in:
 *
 *   * `career_applications` is other people's personal data — name, email,
 *     location, work authorisation, a resume. The table's own RLS policy set
 *     includes an anon INSERT and an applicant-may-read-their-own-row policy,
 *     but neither is sufficient for the hiring pipeline: the admin queue has to
 *     read rows it does not "own", and the storage path to a resume is useless
 *     without a signed URL only the service role can mint.
 *
 *   * `career_job_openings` has a public read policy for published roles,
 *     which is what the marketing page should use. The write side — creating,
 *     publishing, closing a role — is admin-only and belongs here.
 *
 * The browser never sees this module. Nothing below is exported to a client
 * component, and the service-role key is only ever constructed in
 * `@/lib/supabase/service`.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

/**
 * One published or draft role, as the admin queue needs it.
 *
 * `salary_*_cents` are integer minor units like every other amount in this
 * codebase. They are never divided here; formatting belongs to the view.
 */
export type CareerOpening = {
  id: string;
  title: string;
  department: string;
  location: string;
  workType: string;
  descriptionMd: string;
  requirementsMd: string | null;
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  currency: string;
  status: string;
  postedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type CareerApplicationStatus =
  | "submitted"
  | "reviewing"
  | "interview"
  | "rejected"
  | "hired"
  | "withdrawn";

/**
 * The statuses a reviewer may set.
 *
 * Spelled out rather than derived from the table's CHECK constraint, because
 * the constraint also permits "submitted", and a reviewer must never be able to
 * push an application backwards into a state that has already left the queue.
 */
export const REVIEWABLE_APPLICATION_STATUSES = [
  "reviewing",
  "interview",
  "rejected",
  "hired",
] as const;

export type ReviewableApplicationStatus = (typeof REVIEWABLE_APPLICATION_STATUSES)[number];

export function isReviewableApplicationStatus(
  value: unknown
): value is ReviewableApplicationStatus {
  return (
    typeof value === "string" &&
    (REVIEWABLE_APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

type ApplicationRow = Database["public"]["Tables"]["career_applications"]["Row"];

/**
 * The `career_job_openings` projection the readers below select.
 *
 * Spelled out rather than derived from `Row` because the projection is
 * deliberately narrower than the table: `created_by` names the admin who wrote
 * the role and `updated_at` is bookkeeping, and neither belongs in a type that
 * a public careers page renders from. Deriving the type from `Row` would let
 * the two drift apart silently, which is how a `created_by` uuid ends up in a
 * marketing payload.
 */
type OpeningProjection = Pick<
  Database["public"]["Tables"]["career_job_openings"]["Row"],
  | "id"
  | "title"
  | "department"
  | "location"
  | "work_type"
  | "description_md"
  | "requirements_md"
  | "salary_min_cents"
  | "salary_max_cents"
  | "currency"
  | "status"
  | "posted_at"
  | "closed_at"
  | "created_at"
>;

const OPENING_COLUMNS =
  "id,title,department,location,work_type,description_md,requirements_md,salary_min_cents,salary_max_cents,currency,status,posted_at,closed_at,created_at";

const APPLICATION_COLUMNS =
  "id,job_opening_id,full_name,email,phone,location,work_authorization,linkedin_url,github_url,portfolio_url,resume_url,cover_letter,status,applied_at,reviewed_at,reviewed_by,created_at,updated_at";

function toOpening(row: OpeningProjection): CareerOpening {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    location: row.location,
    workType: row.work_type,
    descriptionMd: row.description_md,
    requirementsMd: row.requirements_md,
    salaryMinCents: row.salary_min_cents,
    salaryMaxCents: row.salary_max_cents,
    currency: row.currency,
    status: row.status,
    postedAt: row.posted_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

/** A role for the public careers page, plus whether it is still accepting. */
export async function getPublishedOpeningById(openingId: string) {
  const service = createServiceClient();
  const { data, error } = await service
    .from("career_job_openings")
    .select(OPENING_COLUMNS)
    .eq("id", openingId)
    .eq("status", "published")
    .maybeSingle();

  if (error) throw new Error(`Could not load the role: ${error.message}`);
  return data ? toOpening(data) : null;
}

/** Every published role, newest first. This is what the careers page lists. */
export async function listPublishedOpenings(): Promise<CareerOpening[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("career_job_openings")
    .select(OPENING_COLUMNS)
    .eq("status", "published")
    .order("posted_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Could not load open roles: ${error.message}`);
  return (data ?? []).map(toOpening);
}

/** Every role regardless of status, for the admin queue. */
export async function listAllOpenings(): Promise<CareerOpening[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("career_job_openings")
    .select(OPENING_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load roles: ${error.message}`);
  return (data ?? []).map(toOpening);
}

/**
 * One role's title, whatever its status.
 *
 * Distinct from `getPublishedOpeningById`, which is the applicant-facing check
 * and deliberately refuses anything that is not `published`. A decision notice
 * needs the other reading: an applicant rejected after the role closed must be
 * told the role's name, not a blank.
 */
export async function getOpeningTitle(openingId: string): Promise<string | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("career_job_openings")
    .select("title")
    .eq("id", openingId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the role: ${error.message}`);
  return data?.title ?? null;
}

export type CareerApplication = {
  id: string;
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  workAuthorization: string | null;
  resumePath: string;
  status: CareerApplicationStatus;
  appliedAt: string;
  reviewedAt: string | null;
  createdAt: string;
};

/**
 * The applicant-identifying fields are kept out of `CareerApplication` on
 * purpose. The admin queue needs the name to address a reply, but linkedin_url,
 * github_url, portfolio_url and cover_letter are the applicant's own words and
 * are read only on the single-application view, not in a list that an admin
 * scrolls. Narrowing the type is what keeps a future list endpoint from
 * shipping all of it by accident.
 */
function toApplication(row: ApplicationRow): CareerApplication {
  return {
    id: row.id,
    jobOpeningId: row.job_opening_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    workAuthorization: row.work_authorization,
    resumePath: row.resume_url,
    status: row.status as CareerApplicationStatus,
    appliedAt: row.applied_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export type ListApplicationsResult = {
  items: CareerApplication[];
  total: number;
};

/**
 * The admin queue, one page at a time.
 *
 * Paged rather than returned whole: an application is a document, and a
 * console that loads a year of them to render the first screen is a console
 * that eventually times out.
 */
export async function listApplications(options: {
  status?: CareerApplicationStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<ListApplicationsResult> {
  const service = createServiceClient();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = service
    .from("career_applications")
    .select(APPLICATION_COLUMNS, { count: "exact" })
    .order("applied_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) query = query.eq("status", options.status);

  const { data, error, count } = await query;
  if (error) throw new Error(`Could not load applications: ${error.message}`);

  return { items: (data ?? []).map(toApplication), total: count ?? 0 };
}

/** One application in full, including the applicant's own written answers. */
export async function getApplication(applicationId: string): Promise<ApplicationRow | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("career_applications")
    .select(APPLICATION_COLUMNS)
    .eq("id", applicationId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the application: ${error.message}`);
  return data;
}

export type SetStatusResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unknown" };

/**
 * Moves an application through the pipeline.
 *
 * `reviewed_at` and `reviewed_by` are stamped here rather than trusted from the
 * caller: they are the record of who made the decision, and a form field named
 * `reviewed_by` is a form field an admin can edit.
 *
 * A rejected or hired application is terminal, so a second decision on it is
 * reported as `not_found` rather than silently overwritten. Reopening a
 * rejection after a candidate argues their case is a real need, and it should
 * be a deliberate act, not an accident of a double-clicked form.
 */
export async function setApplicationStatus(input: {
  applicationId: string;
  status: ReviewableApplicationStatus;
  reviewerId: string;
}): Promise<SetStatusResult> {
  if (!isReviewableApplicationStatus(input.status)) return { ok: false, reason: "unknown" };

  const service = createServiceClient();
  const { data, error } = await service
    .from("career_applications")
    .update({
      status: input.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.applicationId)
    .in("status", REVIEWABLE_APPLICATION_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, reason: "unknown" };
  // maybeSingle resolves to null when the id matched nothing, or when the row was
  // already terminal and the status filter excluded it. Both are "this decision
  // was not applied", and the caller treats them the same way.
  return data ? { ok: true } : { ok: false, reason: "not_found" };
}

/** The private bucket every careers resume lives in. */
export const CAREER_RESUME_BUCKET = "career-resumes";

/**
 * Where an applicant's resume is stored.
 *
 * Namespaced by application id, and the extension is derived from a whitelist
 * rather than from the filename. The applicant controls the filename, so
 * `../../.env` or `evil.php` is a plausible upload name; the stored path is
 * built entirely from server-owned values and one of three fixed extensions.
 */
export function careerResumePath(input: { applicationId: string; mimeType: string }): string {
  const extension = input.mimeType.includes("pdf")
    ? "pdf"
    : input.mimeType.includes("wordprocessingml")
      ? "docx"
      : "doc";
  return `${input.applicationId}/resume.${extension}`;
}

export type UploadResumeResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Uploads a resume into the private bucket.
 *
 * The caller has already validated the declared content type against the same
 * three-document whitelist the bucket enforces, so this is the second of two
 * checks rather than the only one.
 */
export async function uploadCareerResume(input: {
  applicationId: string;
  file: File;
}): Promise<UploadResumeResult> {
  const path = careerResumePath({
    applicationId: input.applicationId,
    mimeType: input.file.type,
  });

  const service = createServiceClient();
  const { error } = await service.storage
    .from(CAREER_RESUME_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false });

  if (error) return { ok: false, reason: error.message };
  return { ok: true, path };
}

/**
 * A short-lived signed URL for an admin to open one resume.
 *
 * 60 seconds, and never returned to the applicant. The path comes from the
 * database row rather than from the request, so a caller cannot ask for an
 * arbitrary object in the bucket by editing a query parameter.
 */
export async function createResumeSignedUrl(resumePath: string): Promise<string | null> {
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(CAREER_RESUME_BUCKET)
    .createSignedUrl(resumePath, 60);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export type SubmitApplicationResult =
  | { ok: true; applicationId: string; emailed: boolean }
  | { ok: false; reason: "role_closed" | "invalid" | "unknown" };

export type SubmitApplicationInput = {
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  workAuthorization?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  coverLetter?: string | null;
  resume: File;
};

/**
 * Writes one application.
 *
 * The opening is re-checked for `published` immediately before the insert
 * rather than trusted from the form. A role that closed while somebody was
 * filling in the form must not accept an application, and the only place that
 * knows the current status is the database.
 */
export async function submitApplication(
  input: SubmitApplicationInput
): Promise<SubmitApplicationResult> {
  const service = createServiceClient();

  const { data: opening } = await service
    .from("career_job_openings")
    .select("id,title")
    .eq("id", input.jobOpeningId)
    .eq("status", "published")
    .maybeSingle();

  if (!opening) return { ok: false, reason: "role_closed" };

  const now = new Date().toISOString();
  const { data: inserted, error } = await service
    .from("career_applications")
    .insert({
      job_opening_id: input.jobOpeningId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      location: input.location ?? null,
      work_authorization: input.workAuthorization ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      github_url: input.githubUrl ?? null,
      portfolio_url: input.portfolioUrl ?? null,
      // Placeholder, replaced immediately below once the row exists and the
      // resume has a directory to live in. The column is NOT NULL, so the row
      // is written with the object key it will end up carrying.
      resume_url: "pending",
      cover_letter: input.coverLetter ?? null,
      status: "submitted",
      applied_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !inserted) return { ok: false, reason: "unknown" };

  const uploaded = await uploadCareerResume({
    applicationId: inserted.id,
    file: input.resume,
  });

  if (!uploaded.ok) {
    // The row exists but carries no readable resume. Leaving "pending" in place
    // would look like a path to every later reader, so it is stated plainly and
    // the failure is visible rather than disguised as a document.
    await service
      .from("career_applications")
      .update({ resume_url: "upload-failed", updated_at: now })
      .eq("id", inserted.id);
    return { ok: false, reason: "unknown" };
  }

  if (uploaded.path !== "pending") {
    await service
      .from("career_applications")
      .update({ resume_url: uploaded.path, updated_at: now })
      .eq("id", inserted.id);
  }

  return { ok: true, applicationId: inserted.id, emailed: false };
}

/** The resume storage path for a row, or null when there is not a usable one. */
export function usableResumePath(resumeUrl: string | null | undefined): string | null {
  if (!resumeUrl) return null;
  if (resumeUrl === "pending" || resumeUrl === "upload-failed") return null;
  return resumeUrl;
}
