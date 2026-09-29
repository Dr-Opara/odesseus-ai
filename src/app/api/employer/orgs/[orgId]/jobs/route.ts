import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createJob, listJobs } from "@/lib/employer/service";
import { requireOrgAdmin } from "@/lib/employer/service";
import {
  JOB_EMPLOYMENT_TYPES,
  type CreateJobInput,
  type JobEmploymentType,
} from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * The body shape accepted by POST.
 *
 * Kept as a permissive declaration rather than the strict `zod` schema above,
 * which describes a narrower create. Every field is bounded and the two
 * vocabularies are checked explicitly in the handler, so a request that would
 * be refused gets a 400 naming the field instead of a database constraint
 * error surfacing as a 500.
 */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  department: z.string().max(200).optional().nullable(),
  employmentType: z.string().max(40).optional().nullable(),
  compensationText: z.string().max(200).optional().nullable(),
  responsibilitiesText: z.string().max(10000).optional().nullable(),
  requirementsText: z.string().max(10000).optional().nullable(),
  preferredText: z.string().max(10000).optional().nullable(),
  workArrangement: z.string().max(20).optional().nullable(),
});

/**
 * List all jobs for the organization.
 *
 * Requires org membership (any role). Returns paginated results.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
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

  const rate = checkRateLimit(`employer:jobs:list:${userId}`, 120, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "25", 10), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  const { items, total } = await listJobs(supabase, orgId, { limit, offset });

  return NextResponse.json(
    { items, total, limit, offset },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

/**
 * Create a new job posting.
 *
 * Requires org admin/owner. The job starts as a draft.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const rate = checkRateLimit(`employer:jobs:create:${userId}`, 30, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  // Check admin authorization
  const authz = await requireOrgAdmin(supabase, orgId, userId);
  if (!authz.ok) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  // The body type is the service's own `CreateJobInput`, imported rather than
  // restated. It was previously written out twice -- once as a declaration and
  // once as a cast -- which is how a field reaches the service but not the
  // route's validation, or the reverse, and the mismatch only shows up as a
  // rejected or dropped value at write time.
  let input: CreateJobInput;
  try {
    input = JSON.parse(await request.text()) as CreateJobInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const {
    title,
    description,
    location,
    requirementsText,
    preferredText,
    workArrangement,
    department,
    employmentType,
    compensationText,
    responsibilitiesText,
  } = input;

  if (!title || title.trim().length === 0 || title.length > 200) {
    return NextResponse.json({ error: "Title is required and must be at most 200 characters." }, { status: 400 });
  }
  if (description !== undefined && description !== null && description.length > 5000) {
    return NextResponse.json({ error: "Description must be at most 5000 characters." }, { status: 400 });
  }
  if (location !== undefined && location !== null && location.length > 200) {
    return NextResponse.json({ error: "Location must be at most 200 characters." }, { status: 400 });
  }
  if (requirementsText !== undefined && requirementsText !== null && requirementsText.length > 10000) {
    return NextResponse.json({ error: "Requirements must be at most 10000 characters." }, { status: 400 });
  }
  if (preferredText !== undefined && preferredText !== null && preferredText.length > 10000) {
    return NextResponse.json({ error: "Preferences must be at most 10000 characters." }, { status: 400 });
  }
  if (
    workArrangement !== undefined &&
    workArrangement !== null &&
    !["remote", "hybrid", "onsite"].includes(workArrangement)
  ) {
    return NextResponse.json({ error: "Work arrangement must be remote, hybrid, or onsite." }, { status: 400 });
  }

  // The four structured job-form fields, checked here rather than left to fail
  // as a check-constraint violation inside the service. Employment type is
  // validated against the database's own vocabulary so the form and the column
  // can never disagree about what is storable.
  if (department !== undefined && department !== null && department.length > 200) {
    return NextResponse.json({ error: "Department must be at most 200 characters." }, { status: 400 });
  }
  if (
    employmentType !== undefined &&
    employmentType !== null &&
    !(JOB_EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)
  ) {
    return NextResponse.json({ error: "That employment type is not recognised." }, { status: 400 });
  }
  if (
    compensationText !== undefined &&
    compensationText !== null &&
    compensationText.length > 200
  ) {
    return NextResponse.json({ error: "Compensation must be at most 200 characters." }, { status: 400 });
  }
  if (
    responsibilitiesText !== undefined &&
    responsibilitiesText !== null &&
    responsibilitiesText.length > 10000
  ) {
    return NextResponse.json(
      { error: "Responsibilities must be at most 10000 characters." },
      { status: 400 }
    );
  }

  const job = await createJob(supabase, orgId, {
    title: title.trim(),
    description: description?.trim() ?? null,
    location: location?.trim() ?? null,
    requirementsText: requirementsText?.trim() || null,
    preferredText: preferredText?.trim() || null,
    workArrangement: (workArrangement as "remote" | "hybrid" | "onsite" | null) ?? null,
    department: department?.trim() || null,
    employmentType: (employmentType as JobEmploymentType | null) ?? null,
    compensationText: compensationText?.trim() || null,
    responsibilitiesText: responsibilitiesText?.trim() || null,
  });

  return NextResponse.json(job, { status: 201 });
}