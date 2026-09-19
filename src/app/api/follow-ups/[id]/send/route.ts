import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendFollowUp } from "@/lib/follow-up/send";

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

  const { data: accounts } = await service
    .from("integration_accounts")
    .select("provider,status")
    .eq("user_id", userId)
    .eq("service_type", "email")
    .eq("status", "connected");

  const providers = (accounts || []).map((item) => item.provider);
  const canGoogle =
    providers.includes("google") &&
    Boolean(process.env.VERCEL_CONNECT_GOOGLE_SEND_CONNECTOR);
  const canMicrosoft =
    providers.includes("microsoft") &&
    Boolean(process.env.VERCEL_CONNECT_MICROSOFT_SEND_CONNECTOR);

  const provider = canGoogle
    ? "google"
    : canMicrosoft
      ? "microsoft"
      : null;

  if (!provider) {
    return NextResponse.json({
      ok: true,
      sent: false,
      provider: "mailto",
      mailto: mailtoUrl(
        draft.recipient_email,
        draft.subject,
        draft.body
      ),
    });
  }

  try {
    await sendFollowUp({
      userId,
      provider,
      recipient: draft.recipient_email,
      subject: draft.subject,
      body: draft.body,
    });

    await service
      .from("follow_up_drafts")
      .update({
        status: "sent",
        send_provider: provider,
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json({ ok: true, sent: true, provider });
  } catch (error) {
    console.error("Odysseus follow-up send failed:", error);
    const message = "Odysseus could not send this follow-up.";

    await service
      .from("follow_up_drafts")
      .update({
        status: "approved",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json(
      {
        error: message,
        fallback: mailtoUrl(
          draft.recipient_email,
          draft.subject,
          draft.body
        ),
      },
      { status: 502 }
    );
  }
}
