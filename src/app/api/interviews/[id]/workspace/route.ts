import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildInterviewContext, InterviewNotFoundError } from "@/lib/interviews/context";
import type { InterviewWorkspaceContext } from "@/lib/interviews/context";
import { createNotificationOnce } from "@/lib/notifications/records";
import { GUEST_SHARE_SOURCE } from "@/lib/interviews/guest-share";

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

    // Guest-share interviews are private to their guest link and never
    // surface in the owner's workspace.
    if (context.interview.source === GUEST_SHARE_SOURCE) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }

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
    // "Not this interview" and "the read broke" are different answers and were
    // being reported the same way: a 500 carrying the raw thrown message, which
    // includes the underlying PostgREST error text. The not-found case is the
    // normal outcome of asking about an interview that belongs to someone else,
    // so it gets a 404 with a message that is safe to show. A genuine failure
    // keeps the 500 but loses the internal text -- the detail goes to the log,
    // where it is useful, instead of to the response, where it is not.
    if (err instanceof InterviewNotFoundError) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }

    console.error("Failed to build interview workspace:", err);
    return NextResponse.json(
      { error: "Could not load this interview." },
      { status: 500 }
    );
  }
}
