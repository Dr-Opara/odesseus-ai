import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applicationStatuses } from "@/lib/applications/status";

const schema = z.object({
  status: z.enum(applicationStatuses),
  note: z.string().trim().max(2000).optional().default(""),
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
    return NextResponse.json({ error: "Choose a valid application status." }, { status: 400 });
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id,status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const service = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await service
    .from("applications")
    .update({
      status: input.status,
      last_event_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Odysseus could not update this application." }, { status: 500 });
  }

  if (input.note) {
    await service.from("application_status_events").insert({
      application_id: id,
      user_id: userId,
      event_type: "note",
      from_status: application.status,
      to_status: input.status,
      title: "Note added",
      detail: input.note,
      source: "user",
    });
  }

  return NextResponse.json({ ok: true });
}
