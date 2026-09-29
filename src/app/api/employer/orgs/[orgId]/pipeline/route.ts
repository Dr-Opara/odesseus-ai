import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgRole } from "@/lib/employer/service";
import {
  PIPELINE_STAGES,
  currentStages,
  getPipeline,
  isHiringManager,
  isPipelineStage,
  transitionPipelineStage,
} from "@/lib/employer/hiring";

export const runtime = "nodejs";

const transitionSchema = z.object({
  jobId: z.string().uuid(),
  applicationId: z.string().uuid(),
  stage: z.enum(PIPELINE_STAGES as unknown as [string, ...string[]]),
  notes: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Read pipeline history for the org (optionally one job). Any member may
 * read; the current stage per application is derived from the latest row.
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
    const history = await getPipeline(supabase, orgId, jobId ?? undefined);
    return NextResponse.json({ history, current: currentStages(history) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_HIRING] pipeline read failed", message);
    return NextResponse.json({ error: "Could not load the pipeline." }, { status: 500 });
  }
}

/**
 * Append one pipeline transition. Owner/admin/recruiter only; viewers read.
 * History is insert-only, so every transition is preserved and nothing is
 * silently overwritten. Cross-org application ids resolve to 404.
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

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof transitionSchema>;
  try {
    input = transitionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Choose a valid pipeline stage." }, { status: 400 });
  }

  if (!isPipelineStage(input.stage)) {
    return NextResponse.json({ error: "Choose a valid pipeline stage." }, { status: 400 });
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
      { error: "Only hiring managers can move applicants." },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  try {
    const entry = await transitionPipelineStage(service, {
      orgId,
      jobId: input.jobId,
      applicationId: input.applicationId,
      stage: input.stage,
      changedBy: userId,
      notes: input.notes,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not belong")) {
      return NextResponse.json({ error: "That applicant could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_HIRING] pipeline transition failed", message);
    return NextResponse.json({ error: "Could not move this applicant." }, { status: 500 });
  }
}
