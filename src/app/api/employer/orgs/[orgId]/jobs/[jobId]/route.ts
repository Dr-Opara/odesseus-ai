import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  JOB_EMPLOYMENT_TYPES,
  type JobEmploymentType,
} from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * Get a single job by ID.
 *
 * Requires org membership (any role).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; jobId: string }> }
) {
  const { orgId, jobId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  // Check org membership
  const { data: membership } = await supabase
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  const rate = checkRateLimit(`employer:jobs:get:${userId}`, 120, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const { getJob } = await import("@/lib/employer/service");
  const job = await getJob(supabase, orgId, jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Update a job (details or perform action: publish, close, delete).
 *
 * Requires org admin/owner.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; jobId: string }> }
) {
  const { orgId, jobId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const rate = checkRateLimit(`employer:jobs:update:${userId}`, 60, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  // Check admin authorization
  const { requireOrgAdmin } = await import("@/lib/employer/service");
  const authz = await requireOrgAdmin(supabase, orgId, userId);
  if (!authz.ok) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Check if this is an action (publish, close, delete) or a detail update
  const action = (body as Record<string, unknown>)?.action;
  if (typeof action === "string" && ["publish", "close", "delete"].includes(action)) {
    if (action === "publish") {
      const { publishJob } = await import("@/lib/employer/service");
      const result = await publishJob(supabase, orgId, jobId);
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : result.reason === "wrong_status" ? 409 : 402;
        return NextResponse.json(
          {
            error:
              result.reason === "no_credits"
                ? "No job post credits available."
                : result.reason === "at_capacity"
                  ? "Your plan's active job limit is reached. Close a job or upgrade to publish."
                  : "Job cannot be published.",
            reason: result.reason,
          },
          { status }
        );
      }
      return NextResponse.json(result.job);
    }

    if (action === "close") {
      const { closeJob } = await import("@/lib/employer/service");
      const result = await closeJob(supabase, orgId, jobId);
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 409;
        return NextResponse.json({ error: "Job cannot be closed." }, { status });
      }
      return NextResponse.json(result.job);
    }

    if (action === "delete") {
      const { deleteJob } = await import("@/lib/employer/service");
      const result = await deleteJob(supabase, orgId, jobId);
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 409;
        return NextResponse.json({ error: "Job cannot be deleted." }, { status });
      }
      return NextResponse.json({ ok: true });
    }
  }

  // Otherwise, treat as a detail update
  const bodyRecord = body as Record<string, unknown>;
  const title = bodyRecord.title as string | undefined;
  const description = bodyRecord.description as string | undefined;
  const location = bodyRecord.location as string | undefined;
  const requirementsText = bodyRecord.requirementsText as string | null | undefined;
  const preferredText = bodyRecord.preferredText as string | null | undefined;
  const workArrangement = bodyRecord.workArrangement as string | null | undefined;
  // The four structured job-form fields. Each is a nullable column, so an
  // absent key means "leave it alone" and an explicit null means "clear it" --
  // the distinction the updateJob patch type relies on.
  const department = bodyRecord.department as string | null | undefined;
  const employmentType = bodyRecord.employmentType as string | null | undefined;
  const compensationText = bodyRecord.compensationText as string | null | undefined;
  const responsibilitiesText = bodyRecord.responsibilitiesText as string | null | undefined;

  if (title !== undefined && (typeof title !== "string" || title.length < 1 || title.length > 200)) {
    return NextResponse.json({ error: "Title must be at most 200 characters." }, { status: 400 });
  }
  if (description !== undefined && description !== null && typeof description === "string" && description.length > 5000) {
    return NextResponse.json({ error: "Description must be at most 5000 characters." }, { status: 400 });
  }
  if (location !== undefined && location !== null && typeof location === "string" && location.length > 200) {
    return NextResponse.json({ error: "Location must be at most 200 characters." }, { status: 400 });
  }
  if (requirementsText !== undefined && requirementsText !== null && typeof requirementsText === "string" && requirementsText.length > 10000) {
    return NextResponse.json({ error: "Requirements must be at most 10000 characters." }, { status: 400 });
  }
  if (preferredText !== undefined && preferredText !== null && typeof preferredText === "string" && preferredText.length > 10000) {
    return NextResponse.json({ error: "Preferences must be at most 10000 characters." }, { status: 400 });
  }
  if (
    workArrangement !== undefined &&
    workArrangement !== null &&
    !["remote", "hybrid", "onsite"].includes(workArrangement)
  ) {
    return NextResponse.json({ error: "Work arrangement must be remote, hybrid, or onsite." }, { status: 400 });
  }
  // The four structured fields, bounded and vocabulary-checked here so a bad
  // value is a 400 naming the field rather than a check-constraint failure
  // surfacing from the service as a 500.
  if (department !== undefined && department !== null && typeof department === "string" && department.length > 200) {
    return NextResponse.json({ error: "Department must be at most 200 characters." }, { status: 400 });
  }
  if (
    employmentType !== undefined &&
    employmentType !== null &&
    !JOB_EMPLOYMENT_TYPES.includes(employmentType as (typeof JOB_EMPLOYMENT_TYPES)[number])
  ) {
    return NextResponse.json({ error: "That employment type is not recognised." }, { status: 400 });
  }
  if (
    compensationText !== undefined &&
    compensationText !== null &&
    typeof compensationText === "string" &&
    compensationText.length > 200
  ) {
    return NextResponse.json({ error: "Compensation must be at most 200 characters." }, { status: 400 });
  }
  if (
    responsibilitiesText !== undefined &&
    responsibilitiesText !== null &&
    typeof responsibilitiesText === "string" &&
    responsibilitiesText.length > 10000
  ) {
    return NextResponse.json(
      { error: "Responsibilities must be at most 10000 characters." },
      { status: 400 }
    );
  }

  const { updateJob } = await import("@/lib/employer/service");
  const result = await updateJob(supabase, orgId, jobId, {
    title: title?.trim(),
    description: description?.trim() ?? null,
    location: location?.trim() ?? null,
    requirementsText:
      requirementsText === undefined ? undefined : (requirementsText?.trim() || null),
    preferredText:
      preferredText === undefined ? undefined : (preferredText?.trim() || null),
    workArrangement:
      workArrangement === undefined
        ? undefined
        : ((workArrangement as "remote" | "hybrid" | "onsite" | null) ?? null),
    department: department === undefined ? undefined : (department?.trim() || null),
    employmentType:
      employmentType === undefined
        ? undefined
        : ((employmentType as JobEmploymentType | null) ?? null),
    compensationText:
      compensationText === undefined ? undefined : (compensationText?.trim() || null),
    responsibilitiesText:
      responsibilitiesText === undefined ? undefined : (responsibilitiesText?.trim() || null),
  });

  if ("reason" in result) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ error: "Job cannot be updated." }, { status });
  }

  return NextResponse.json(result);
}