import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsRead } from "@/lib/notifications/records";

export const runtime = "nodejs";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

/** Marks the member's given org notifications read. */
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

  const { data: membership } = await supabase
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "At least one notification id is required." },
      { status: 400 }
    );
  }

  try {
    // recipient+org scoping is enforced inside the service/RPC via the
    // recipient_user_id filter and RLS; the ids are only in-bounds selectors.
    await markNotificationsRead(supabase, userId, parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer mark-read failed", error);
    return NextResponse.json(
      { error: "Could not mark notifications read." },
      { status: 500 }
    );
  }
}