import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function mailtoUrl(recipient: string, subject: string, body: string) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(recipient)}?${params.toString()}`;
}

export async function POST(
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

  const service = createServiceClient();

  const { data: draft } = await service
    .from("follow_up_drafts")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Follow-up draft not found." }, { status: 404 });
  }

  if (!draft.recipient_email) {
    return NextResponse.json({ error: "Add the recipient email before sending." }, { status: 400 });
  }

  if (draft.status !== "approved") {
    return NextResponse.json({ error: "Approve the follow-up before sending." }, { status: 409 });
  }

  if (draft.sent_at) {
    return NextResponse.json({ ok: true, sent: true, provider: draft.send_provider });
  }

  // Odesseus never sends mail on the candidate's behalf: it hands back a
  // mailto: link so the candidate sends the approved draft from their own
  // mail client.
  return NextResponse.json({
    ok: true,
    sent: false,
    provider: "mailto",
    mailto: mailtoUrl(draft.recipient_email, draft.subject, draft.body),
  });
}
