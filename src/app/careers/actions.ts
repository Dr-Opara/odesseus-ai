"use server";

/**
 * Career application submission.
 *
 * Unauthenticated by design: somebody deciding whether to apply to Odesseus is,
 * by definition, not an Odesseus user yet, and a job application behind a login
 * wall is a smaller hiring pipeline. The cost of that choice is that this is the
 * only unauthenticated write in the product that stores personal data, so it is
 * the one that carries the most defences:
 *
 *   * origin-checked against `NEXT_PUBLIC_SITE_URL`, on top of Next.js's own
 *     Server Action origin protection, so a cross-site POST cannot fill a
 *     recruiter's queue,
 *   * rate limited per forwarded address, so it cannot be used to spam a
 *     recruiter or to write unbounded rows,
 *   * validated with a schema rather than field-by-field, so a field that is not
 *     in the schema cannot be written,
 *   * the role is re-read as `published` server-side at insert time, so a form
 *     filled in before a role closed cannot still land,
 *   * the stored resume path is built from server-owned values, so the
 *     applicant's filename is never a path,
 *   * the receipt email never claims a decision, a timeline, or a relationship
 *     between applying and buying anything.
 */

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sendCareerMessage, buildApplicationReceipt } from "@/lib/careers/email";
import { submitApplication, getPublishedOpeningById } from "@/lib/careers/service";

export type CareerApplicationFormState =
  | { status: "idle" }
  | { status: "success"; applicationId: string; emailed: boolean }
  | { status: "error"; error: string; fieldErrors?: Record<string, string> };

/**
 * The same three document types the private bucket allows. Checked here as well
 * as by storage, because a rejected upload leaves an application row with no
 * readable resume, and it is better to never write the row at all.
 */
const RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Six applications an hour from one address. A person applies to one or two. */
const APPLICATIONS_PER_HOUR = 6;

/**
 * Normalises a FormData field that may simply not be there.
 *
 * `FormData.get` returns `null` for an absent field, `""` for one the applicant
 * cleared, and the string otherwise. A `z.string().optional()` rejects `null`,
 * so an un-submitted optional field would fail validation and an applicant
 * would be told to check fields they never filled in. All three states mean the
 * same thing here: not provided.
 */
const notProvided = (value: unknown) =>
  value === null || value === undefined || value === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(notProvided, z.string().trim().max(max).optional());

const optionalUrl = z.preprocess(
  notProvided,
  z
    .string()
    .trim()
    .max(300)
    .refine(
      (value) => /^https?:\/\/[^\s]+$/i.test(value),
      "Enter a full link starting with https://"
    )
    .optional()
);

const optionalLongText = (max: number) =>
  z.preprocess(notProvided, z.string().trim().max(max).optional());

const schema = z.object({
  jobOpeningId: z.string().uuid("That role could not be found."),
  fullName: z.string().trim().min(2, "Tell us your name.").max(120),
  email: z.string().trim().email("That email address does not look right.").max(254),
  phone: optionalText(40),
  location: optionalText(120),
  workAuthorization: optionalText(200),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  coverLetter: optionalLongText(5000),
  resume: z.any(),
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Validates the file without trusting the browser's type.
 *
 * `File.type` is client-supplied. It is checked because a mismatch is a cheap
 * signal, but the bucket's own `allowed_mime_types` is what actually enforces
 * this, so a spoofed header fails at upload rather than being stored.
 */
function resumeProblem(file: unknown): string | null {
  if (!(file instanceof File)) return "Attach your resume.";
  if (file.size === 0) return "That resume file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "That resume is larger than 5 MB.";
  if (!(RESUME_TYPES as readonly string[]).includes(file.type)) {
    return "Attach a PDF or Word document.";
  }
  return null;
}

async function requestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip") || "unknown";
}

/**
 * Second origin check, on the real header.
 *
 * `isTrustedOrigin` from `@/lib/security/origin-check` takes a `Request`, and a
 * server action has none. Rather than fabricate one from a hidden form field —
 * which would make the check only as trustworthy as a value the client chose —
 * this compares the actual `origin` header against the configured site URL.
 *
 * Absent header means the same thing it means in `isTrustedOrigin`: nothing to
 * compare, so not a cross-site POST, and this is a supplement to SameSite
 * cookies and Next.js's built-in check rather than the only defence.
 */
async function originRejected(): Promise<boolean> {
  const origin = (await headers()).get("origin");
  if (!origin) return false;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return true;

  try {
    return new URL(origin).origin !== new URL(siteUrl).origin;
  } catch {
    return true;
  }
}

export async function submitCareerApplication(
  _prev: CareerApplicationFormState,
  formData: FormData
): Promise<CareerApplicationFormState> {
  if (await originRejected()) {
    return { status: "error", error: "Invalid request origin." };
  }

  const rate = checkRateLimit(
    `careers:apply:${await requestIp()}`,
    APPLICATIONS_PER_HOUR,
    3_600_000
  );
  if (!rate.allowed) {
    const minutes = Math.max(1, Math.ceil(rate.retryAfterMs / 60_000));
    return {
      status: "error",
      error: `You have sent several applications recently. Try again in about ${
        minutes === 1 ? "a minute" : `${minutes} minutes`
      }.`,
    };
  }

  const parsed = schema.safeParse({
    jobOpeningId: formData.get("jobOpeningId"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    location: formData.get("location"),
    workAuthorization: formData.get("workAuthorization"),
    linkedinUrl: formData.get("linkedinUrl"),
    githubUrl: formData.get("githubUrl"),
    portfolioUrl: formData.get("portfolioUrl"),
    coverLetter: formData.get("coverLetter"),
    resume: formData.get("resume"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const resumeProblemMessage = resumeProblem(parsed.data.resume);
  if (resumeProblemMessage) {
    return {
      status: "error",
      error: resumeProblemMessage,
      fieldErrors: { resume: resumeProblemMessage },
    };
  }

  const opening = await getPublishedOpeningById(parsed.data.jobOpeningId).catch(() => null);
  if (!opening) {
    // The same answer is given for a role that never existed, so this cannot be
    // used to enumerate the hiring pipeline.
    return { status: "error", error: "That role is no longer accepting applications." };
  }

  const result = await submitApplication({
    jobOpeningId: parsed.data.jobOpeningId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    location: parsed.data.location ?? null,
    workAuthorization: parsed.data.workAuthorization ?? null,
    linkedinUrl: parsed.data.linkedinUrl ?? null,
    githubUrl: parsed.data.githubUrl ?? null,
    portfolioUrl: parsed.data.portfolioUrl ?? null,
    coverLetter: parsed.data.coverLetter ?? null,
    resume: parsed.data.resume as File,
  });

  if (!result.ok) {
    return {
      status: "error",
      error:
        result.reason === "role_closed"
          ? "That role is no longer accepting applications."
          : "We could not save your application. Please try again.",
    };
  }

  // The row exists. A receipt that fails to send is a delivery problem, not a
  // submission problem, and telling an applicant their application did not go
  // through would be a lie — so it is reported separately and never blocks.
  const receipt = await sendCareerMessage({
    to: parsed.data.email,
    ...buildApplicationReceipt({ fullName: parsed.data.fullName, roleTitle: opening.title }),
  }).catch(() => ({ sent: false as const, reason: "provider_error" as const }));

  revalidatePath("/admin/careers");

  return {
    status: "success",
    applicationId: result.applicationId,
    emailed: receipt.sent,
  };
}
