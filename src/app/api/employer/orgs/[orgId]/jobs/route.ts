import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createJob, listJobs } from "@/lib/employer/service";
import { requireOrgAdmin } from "@/lib/employer/service";

export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
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

  let input: {
    title: string;
    description?: string | null;
    location?: string | null;
    requirementsText?: string | null;
    preferredText?: string | null;
    workArrangement?: string | null;
  };
  try {
    input = JSON.parse(await request.text()) as {
      title: string;
      description?: string | null;
      location?: string | null;
      requirementsText?: string | null;
      preferredText?: string | null;
      workArrangement?: string | null;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { title, description, location, requirementsText, preferredText, workArrangement } = input;

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

  const job = await createJob(supabase, orgId, {
    title: title.trim(),
    description: description?.trim() ?? null,
    location: location?.trim() ?? null,
    requirementsText: requirementsText?.trim() || null,
    preferredText: preferredText?.trim() || null,
    workArrangement: (workArrangement as "remote" | "hybrid" | "onsite" | null) ?? null,
  });

  return NextResponse.json(job, { status: 201 });
}