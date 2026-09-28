import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markAllNotificationsRead } from "@/lib/notifications/records";

export const runtime = "nodejs";

/** Marks every unread notification of the caller read. */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    await markAllNotificationsRead(supabase, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] mark-all-read failed", error);
    return NextResponse.json(
      { error: "Could not mark notifications read." },
      { status: 500 }
    );
  }
}