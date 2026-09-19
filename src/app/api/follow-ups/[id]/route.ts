import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  recipientEmail: z.string().email().nullable(),
  recipientName: z.string().trim().max(300).nullable(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
  status: z.enum(["draft", "approved"]).default("draft"),
});

export async function POST(
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

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Check the follow-up draft." }, { status: 400 });
  }

  const { data: draft } = await supabase
    .from("follow_up_drafts")
    .select("id,status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Follow-up draft not found." }, { status: 404 });
  }

  if (draft.status === "sent") {
    return NextResponse.json({ error: "This follow-up has already been sent." }, { status: 409 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("follow_up_drafts")
    .update({
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName,
      subject: input.subject,
      body: input.body,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Odysseus could not save the follow-up." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
