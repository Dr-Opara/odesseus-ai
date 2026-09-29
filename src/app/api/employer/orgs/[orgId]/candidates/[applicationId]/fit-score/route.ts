import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgRole } from "@/lib/employer/service";
import { computeFitScore, getFitScore, isHiringManager } from "@/lib/employer/hiring";

export const runtime = "nodejs";

const schema = z.object({
  jobId: z.string().uuid(),
  refresh: z.boolean().default(false),
});

/**
 * Read or compute the evidence-backed Fit Score for one application.
 *
 * GET-equivalent read path is folded in: without refresh:true a cached row
 * is returned and no model time is spent. Computing requires a hiring-manager
 * role (owner/admin/recruiter); viewers read only via the applicants surface.
 */
export async function POST(
  request: Request,
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

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Choose the job to score against." }, { status: 400 });
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
  if (!isHiringManager(role)) {
    return NextResponse.json(
      { error: "Only hiring managers can score applicants." },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  try {
    if (!input.refresh) {
      const cached = await getFitScore(supabase, orgId, input.jobId, applicationId);
      if (cached) {
        return NextResponse.json({ fitScore: cached, cached: true });
      }
    }

    const { score, versionNumber } = await computeFitScore(service, {
      orgId,
      jobId: input.jobId,
      applicationId,
      refresh: input.refresh,
    });

    const persisted = await getFitScore(service, orgId, input.jobId, applicationId);
    return NextResponse.json({
      fitScore: persisted ?? { ...score, versionNumber },
      cached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not belong") || message.includes("not found")) {
      return NextResponse.json({ error: "That applicant could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_HIRING] fit score failed", message);
    return NextResponse.json({ error: "Could not score this applicant." }, { status: 500 });
  }
}
