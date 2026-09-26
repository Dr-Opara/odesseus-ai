import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { OrgAccessError, getOrgTeamView } from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * The org team screen in one payload: seat arithmetic, the roster, and the
 * outstanding invitations.
 *
 * Any org member may read this, not only admins — a recruiter needs to see how
 * many seats are left. Invitations are admin-scoped, and RLS already returns
 * nothing for anyone else, so a non-admin simply gets an empty list rather than
 * an error. Employer data is never read with the service role here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { orgId } = await params;
  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  try {
    const team = await getOrgTeamView(supabase, orgId, userId);
    return NextResponse.json({ team }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof OrgAccessError) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_TEAM] team read failed", error);
    return NextResponse.json(
      { error: "Could not load your team." },
      { status: 500 }
    );
  }
}
