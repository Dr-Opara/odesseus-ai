import { NextResponse } from "next/server";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  action: z.enum(["continue", "submit", "cancel"]),
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
    return NextResponse.json({ error: "Invalid command." }, { status: 400 });
  }

  const { data: run } = await supabase
    .from("application_runs")
    .select("id,status,resume_token")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ error: "Application run not found." }, { status: 404 });
  }

  if (!run.resume_token) {
    return NextResponse.json(
      { error: "Odysseus is still working. Try again when the run is waiting for you." },
      { status: 409 }
    );
  }

  if (input.action === "submit" && run.status !== "ready_to_submit") {
    return NextResponse.json({ error: "The application is not ready to submit yet." }, { status: 409 });
  }

  await resumeHook(run.resume_token, { action: input.action });
  return NextResponse.json({ ok: true });
}
