import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/notifications/records";

export const runtime = "nodejs";

/** The candidate's unread count (exact head count, not a list). */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const count = await getUnreadNotificationCount(supabase, userId);
    return NextResponse.json(
      { count },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] unread count failed", error);
    return NextResponse.json(
      { error: "Could not load the unread count." },
      { status: 500 }
    );
  }
}