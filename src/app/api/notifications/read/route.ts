import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsRead } from "@/lib/notifications/records";

export const runtime = "nodejs";

// Non-empty list of the caller's notification ids. Unknown ids are ignored by
// the recipient-scoped update — a caller can never mark another user's row.
const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

/** Marks the given notifications read (read_at only; RLS + column grant back it up). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "At least one notification id is required." },
      { status: 400 }
    );
  }

  try {
    await markNotificationsRead(supabase, userId, parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] mark-read failed", error);
    return NextResponse.json(
      { error: "Could not mark notifications read." },
      { status: 500 }
    );
  }
}