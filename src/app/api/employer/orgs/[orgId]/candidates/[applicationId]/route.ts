import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgRole } from "@/lib/employer/service";
import { getApplicant } from "@/lib/employer/hiring";

export const runtime = "nodejs";

/**
 * One applicant by id. Member-scoped: an id from another org resolves to
 * null here and answers 404, never leaking across the org boundary.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; applicationId: string }> }
) {
  const { orgId, applicationId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (
    !z.string().uuid().safeParse(orgId).success ||
    !z.string().uuid().safeParse(applicationId).success
  ) {
    return NextResponse.json({ error: "That applicant could not be found." }, { status: 404 });
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

  try {
    const applicant = await getApplicant(supabase, orgId, applicationId);
    if (!applicant) {
      return NextResponse.json({ error: "That applicant could not be found." }, { status: 404 });
    }
    return NextResponse.json({ applicant });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_HIRING] applicant read failed", message);
    return NextResponse.json({ error: "Could not load the applicant." }, { status: 500 });
  }
}
