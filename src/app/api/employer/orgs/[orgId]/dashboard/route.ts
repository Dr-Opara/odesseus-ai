import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgRole } from "@/lib/employer/service";
import { getEmployerDashboard } from "@/lib/employer/analytics";

export const runtime = "nodejs";

/**
 * The complete employer dashboard read: org, plan, capacity, seats, jobs,
 * applicants, pipeline, fit counts, and featured — one response, every
 * number from a real store, gaps reported as notices instead of invented
 * metrics.
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
    return NextResponse.json({ error: "Could not check your team permissions." }, { status: 500 });
  }

  if (role === null) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  try {
    const dashboard = await getEmployerDashboard(
      supabase,
      createServiceClient(),
      orgId,
      userId
    );
    return NextResponse.json({ dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("could not be found")) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_DASHBOARD] dashboard failed", message);
    return NextResponse.json({ error: "Could not load the dashboard." }, { status: 500 });
  }
}
