import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const url = new URL(request.url);
  const { limit } = querySchema.parse(Object.fromEntries(url.searchParams));

  // Verify interview ownership
  const service = createServiceClient();
  const { data: interview } = await service
    .from("interviews")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  // Get the session for this interview
  const { data: session } = await service
    .from("live_interview_sessions")
    .select("id")
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ items: [] });
  }

  // Get audit trail
  const { data: trail } = await service.rpc("odesseus_admin_audit_trail", {
    p_subject_type: "live_session",
    p_subject_id: session.id,
    p_limit: limit,
  });

  return NextResponse.json({
    sessionId: session.id,
    items: (trail ?? []).map((row: any) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      details: row.details,
      createdAt: row.created_at,
    })),
  });
}