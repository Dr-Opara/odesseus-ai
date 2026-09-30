import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgRole } from "@/lib/employer/service";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  website: z.string().trim().max(500).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  companySize: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
});

function toPublic(row: {
  id: string;
  name: string;
  owner_user_id: string;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  description: string | null;
  created_at: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    website: row.website,
    industry: row.industry,
    companySize: row.company_size,
    description: row.description,
    createdAt: row.created_at,
  };
}

/**
 * Read the caller's organization including the company profile.
 * Any org member (or the owner) may read; outsiders get 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  let role: Awaited<ReturnType<typeof getOrgRole>>;
  try {
    role = await getOrgRole(supabase, orgId, userId);
  } catch {
    return NextResponse.json({ error: "Could not load your team." }, { status: 500 });
  }

  if (role === null) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  const { data: org, error } = await supabase
    .from("employer_organizations")
    .select("id,name,owner_user_id,website,industry,company_size,description,created_at")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !org) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  return NextResponse.json({ org: toPublic(org), yourRole: role });
}

/**
 * Update the company profile. Owner-only: the org update policy grants
 * writes to the owning user, so an admin attempting this gets 403 rather
 * than a raw RLS error.
 */
export async function PATCH(
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

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof patchSchema>;
  try {
    input = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Check the company details." }, { status: 400 });
  }

  let role: Awaited<ReturnType<typeof getOrgRole>>;
  try {
    role = await getOrgRole(supabase, orgId, userId);
  } catch {
    return NextResponse.json({ error: "Could not check your team permissions." }, { status: 500 });
  }

  if (role === null) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }
  if (role !== "owner") {
    return NextResponse.json(
      { error: "Only the team owner can edit the company profile." },
      { status: 403 }
    );
  }

  const updates: {
    name?: string;
    website?: string | null;
    industry?: string | null;
    company_size?: string | null;
    description?: string | null;
  } = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.website !== undefined) updates.website = input.website || null;
  if (input.industry !== undefined) updates.industry = input.industry || null;
  if (input.companySize !== undefined) updates.company_size = input.companySize || null;
  if (input.description !== undefined) updates.description = input.description || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // The write runs with a service client, obtained only after the owner check
  // above has passed on the session client. `authenticated` is SELECT-only on
  // `employer_organizations`, so this update could not use the session client
  // even for the correct owner. The `.eq("id", orgId)` below is the same org the
  // check ran against, so a cross-org write stays impossible.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { data: org, error } = await createServiceClient()
    .from("employer_organizations")
    .update(updates)
    .eq("id", orgId)
    .eq("owner_user_id", userId)
    .select("id,name,owner_user_id,website,industry,company_size,description,created_at")
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "Could not save the company profile." }, { status: 500 });
  }

  return NextResponse.json({ org: toPublic(org) });
}
