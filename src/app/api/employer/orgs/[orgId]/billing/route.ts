import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgRole } from "@/lib/employer/service";
import { getEmployerBilling } from "@/lib/employer/analytics";

export const runtime = "nodejs";

/**
 * The org's current billing posture: plan, subscription status and period,
 * active-job capacity, recruiter seats, and active featured listings.
 * Money movement stays in Stripe checkout + webhook sync; this is read-only.
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
    const billing = await getEmployerBilling(supabase, orgId, userId);
    return NextResponse.json({ billing });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("could not be found")) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_DASHBOARD] billing failed", message);
    return NextResponse.json({ error: "Could not load billing." }, { status: 500 });
  }
}
