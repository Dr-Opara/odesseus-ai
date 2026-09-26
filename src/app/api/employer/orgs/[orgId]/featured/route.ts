import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { OrgAccessError, getOrgFeaturedView } from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * The featured-listings screen in one payload: what the org has already paid
 * for, which of its own postings can be boosted, and what each tier costs.
 *
 * Any org member may read this, the same as the team view. The tier prices are
 * returned from the billing catalog rather than left to the client, so the page
 * cannot advertise an amount the checkout would not charge.
 *
 * Reads run on the caller's own session client. `featured_listings` grants
 * SELECT to members only, so a non-member gets an empty read and is answered
 * with 404 rather than an empty list that would confirm the org exists.
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
    const featured = await getOrgFeaturedView(supabase, orgId, userId);
    return NextResponse.json(
      { featured },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof OrgAccessError) {
      return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
    }
    console.error("[ODESSEUS_EMPLOYER_FEATURED] featured read failed", error);
    return NextResponse.json(
      { error: "Could not load your featured listings." },
      { status: 500 }
    );
  }
}
