import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgRole } from "@/lib/employer/service";
import { listApplicantIdentities, listApplicants } from "@/lib/employer/hiring";

export const runtime = "nodejs";

/**
 * List the organization's applicants across its jobs (or one job).
 * Any org member may read; outsiders get 404. Payloads are application
 * data for the org's own jobs only — never candidate-private Live, mock,
 * prep, or analysis content, and never candidate user ids.
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

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
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

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (jobId !== null && !z.string().uuid().safeParse(jobId).success) {
    return NextResponse.json({ error: "That job could not be found." }, { status: 404 });
  }

  try {
    // Two reads, deliberately: the applicant payloads and the applicant
    // identities are separate accessors, each proving the membership -> org ->
    // job -> application chain itself, and neither returning a user id. Joining
    // them here on the application id keeps each surface independently
    // auditable -- widening the payload reader must not be the way to add a
    // name to it.
    const [applicants, identities] = await Promise.all([
      listApplicants(supabase, orgId, jobId ?? undefined),
      listApplicantIdentities(supabase, orgId, jobId ?? undefined),
    ]);

    const byApplication = new Map(identities.map((row) => [row.applicationId, row]));

    return NextResponse.json({
      applicants: applicants.map((applicant) => {
        const identity = byApplication.get(applicant.applicationId);
        return {
          ...applicant,
          candidateName: identity?.candidateName ?? null,
          candidateEmail: identity?.candidateEmail ?? null,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Not permitted")) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_HIRING] applicant list failed", message);
    return NextResponse.json({ error: "Could not load applicants." }, { status: 500 });
  }
}
