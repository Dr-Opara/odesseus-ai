import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildInterviewContext } from "@/lib/interviews/context";
import type { InterviewWorkspaceContext } from "@/lib/interviews/context";
import { createNotificationOnce } from "@/lib/notifications/records";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const context: InterviewWorkspaceContext = await buildInterviewContext(userId, id);

    // Fire INTERVIEW_PREP_READY notification once per readiness version.
    // createNotificationOnce dedupes on (recipient_user_id, dedupe_key).
    const service = createServiceClient();
    try {
      await createNotificationOnce(service, {
        recipient_user_id: userId,
        recipient_type: "candidate",
        notification_type: "INTERVIEW_PREP_READY",
        title: "Interview preparation ready",
        message: "Your interview preparation is now available.",
        entity_type: "interview",
        entity_id: id,
        dedupe_key: `interview:${id}:prep_ready:v${context.readiness.version ?? 0}`,
        priority: "normal",
      });
    } catch (notifyError) {
      console.error("Failed to record interview prep notification:", notifyError);
    }

    return NextResponse.json(context);
  } catch (err) {
    console.error("Failed to build interview workspace:", err);
    const message =
      err instanceof Error ? err.message : "Failed to build interview workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
