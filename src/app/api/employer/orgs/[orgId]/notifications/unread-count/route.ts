import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/notifications/records";

export const runtime = "nodejs";

/** The member's unread count within this org (exact head count). */
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

  // A malformed org id is refused here rather than reaching the database,
  // where it surfaces as a 500 from an unhandled query error. Same answer as
  // a well-formed id that names nothing, which is what it is.

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  try {
    const count = await getUnreadNotificationCount(supabase, userId, { organizationId: orgId });
    return NextResponse.json(
      { count },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer unread count failed", error);
    return NextResponse.json(
      { error: "Could not load the unread count." },
      { status: 500 }
    );
  }
}