import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildLiveContext } from "@/lib/live/context";

const schema = z.object({
  captureMode: z.enum(["microphone", "shared_audio", "mixed"]).default("shared_audio"),
  consent: z.literal(true),
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
    return NextResponse.json(
      { error: "Audio consent is required to start Odysseus Live." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const [{ data: interview }, { data: credits }, { data: existing }] = await Promise.all([
    service
      .from("interviews")
      .select("id,application_id,status,live_pass_status")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("credit_balances")
      .select("interview_passes")
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("live_interview_sessions")
      .select("*")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  if (existing?.status === "ended") {
    return NextResponse.json(
      { error: "This interview Live session has already ended." },
      { status: 409 }
    );
  }

  if (!existing && (credits?.interview_passes ?? 0) < 1) {
    return NextResponse.json(
      { error: "You need one interview pass to start Odysseus Live." },
      { status: 402 }
    );
  }

  const context = existing?.context_snapshot && Object.keys(existing.context_snapshot).length
    ? existing.context_snapshot
    : await buildLiveContext(userId, id);

  const now = new Date().toISOString();

  if (existing) {
    await service
      .from("live_interview_sessions")
      .update({
        capture_mode: input.captureMode,
        consented_at: existing.consented_at || now,
        context_snapshot: context,
        error_message: null,
        updated_at: now,
      })
      .eq("id", existing.id);

    return NextResponse.json({
      sessionId: existing.id,
      status: existing.status,
      alreadyCharged: existing.status === "active",
    });
  }

  const { data: created, error } = await service
    .from("live_interview_sessions")
    .insert({
      interview_id: id,
      application_id: interview.application_id,
      user_id: userId,
      status: "prepared",
      capture_mode: input.captureMode,
      transcription_model: "gpt-live-transcribe",
      guidance_model:
        process.env.ODYSSEUS_LIVE_GUIDANCE_MODEL ||
        process.env.ODYSSEUS_MATCH_MODEL ||
        "gpt-5.6-luna",
      consented_at: now,
      context_snapshot: context,
    })
    .select("id,status")
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: "Odysseus could not prepare the Live session." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId: created.id,
    status: created.status,
    alreadyCharged: false,
  });
}
