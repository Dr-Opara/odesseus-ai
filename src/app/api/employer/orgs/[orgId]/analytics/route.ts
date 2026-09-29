import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgRole } from "@/lib/employer/service";
import { getEmployerAnalytics } from "@/lib/employer/analytics";

export const runtime = "nodejs";

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

/**
 * Employer analytics over real hiring data: applications by job and over
 * time, pipeline distribution, strong-fit counts, job states, featured
 * performance, hiring outcomes, and team usage.
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
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the analytics window." }, { status: 400 });
  }

  try {
    const analytics = await getEmployerAnalytics(
      supabase,
      createServiceClient(),
      orgId,
      userId,
      parsed.data.days
    );
    return NextResponse.json({ analytics });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("could not be found")) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_DASHBOARD] analytics failed", message);
    return NextResponse.json({ error: "Could not load analytics." }, { status: 500 });
  }
}
