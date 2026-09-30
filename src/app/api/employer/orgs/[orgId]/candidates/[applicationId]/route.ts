import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgRole } from "@/lib/employer/service";
import { getApplicant, listApplicantIdentities } from "@/lib/employer/hiring";

export const runtime = "nodejs";

/**
 * One applicant by id. Member-scoped: an id from another org resolves to
 * null here and answers 404, never leaking across the org boundary.
 *
 * The applicant's display name and contact address come from the identity
 * accessor, which is a separate, narrower read that proves the membership ->
 * org -> job -> application chain itself and returns no user id. A missing
 * identity row is not an error: the applicant is still returned, with the
 * identity fields absent, because "this applicant has no name on file" and
 * "this applicant does not exist" are different answers.
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

    // Scoped to this org, then narrowed to this one application. The accessor
    // raises for a foreign org, which the role check above already refused, so
    // reaching here means the caller's own application.
    const identities = await listApplicantIdentities(supabase, orgId);
    const identity = identities.find((row) => row.applicationId === applicationId);

    // Projected, not spread -- same reason as the list endpoint, and here the
    // omission matters less because a recruiter is entitled to the submitted
    // resume for an applicant on their own job. What they are not entitled to
    // is anything keyed to the candidate rather than to this application, and
    // the projection contains no user id, so there is nothing here to pivot on.
    // `jobSnapshot` is retained: the detail surface renders the job the
    // application was made against.
    return NextResponse.json({
      applicant: {
        applicationId: applicant.applicationId,
        jobId: applicant.jobId,
        jobTitle: applicant.jobTitle,
        jobStatus: applicant.jobStatus,
        applicationStatus: applicant.applicationStatus,
        submittedAt: applicant.submittedAt,
        companyName: applicant.companyName,
        roleTitle: applicant.roleTitle,
        matchScoreSnapshot: applicant.matchScoreSnapshot,
        jobSnapshot: applicant.jobSnapshot,
        candidateName: identity?.candidateName ?? null,
        candidateEmail: identity?.candidateEmail ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_HIRING] applicant read failed", message);
    return NextResponse.json({ error: "Could not load the applicant." }, { status: 500 });
  }
}
