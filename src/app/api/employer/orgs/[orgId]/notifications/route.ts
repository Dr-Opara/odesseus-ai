import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/lib/notifications/records";
import { NOTIFICATION_TYPES } from "@/lib/notifications/catalog";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().min(1).optional(),
  unread: z.union([z.literal("true"), z.literal("false")]).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

/** The org's notification feed for this member (org-scoped, RLS-enforced). */
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

  const { data: membership } = await supabase
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  try {
    const { items, nextCursor } = await listNotifications(supabase, userId, {
      limit: parsed.data.limit,
      before: parsed.data.before,
      unreadOnly: parsed.data.unread === "true",
      type: parsed.data.type,
      organizationId: orgId,
    });
    return NextResponse.json(
      { items, nextCursor },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer list failed", error);
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
}