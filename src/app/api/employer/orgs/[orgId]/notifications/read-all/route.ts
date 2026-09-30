import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { markAllNotificationsRead } from "@/lib/notifications/records";

export const runtime = "nodejs";

/** Marks all of the member's unread rows in this org read. */
export async function POST(
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
    await markAllNotificationsRead(supabase, userId, { organizationId: orgId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer mark-all-read failed", error);
    return NextResponse.json(
      { error: "Could not mark notifications read." },
      { status: 500 }
    );
  }
}