import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildLiveContext } from "@/lib/live/context";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";
import { isLiveSessionTerminal } from "@/lib/live/session-status";

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
      { error: "Audio consent is required to start Odesseus Live." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: interview } = await service
    .from("interviews")
    .select("id,application_id,status,live_pass_status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  // Applicant Live setup requires linked application context (job snapshot,
  // submitted resume). Manual interviews without one cannot use this path.
  if (!interview.application_id) {
    return NextResponse.json({ error: "Interview context is incomplete." }, { status: 404 });
  }

  // The single authoritative access decision. Fail closed: a check that could
  // not be performed must not mint a session the caller cannot activate.
  // Never re-derive access from credit_balances here.
  const entitlement = await readLiveEntitlement(userId);
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: "Odesseus could not check Live access." },
      { status: 500 }
    );
  }

  const { data: existing } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot,consented_at")
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  // A finished session cannot be restarted from prepare. A fresh interview is
  // the path to another session.
  if (existing && isLiveSessionTerminal(existing.status)) {
    return NextResponse.json(
      { error: "This interview Live session has already ended." },
      { status: 409 }
    );
  }

  const context =
    existing?.context_snapshot && Object.keys(existing.context_snapshot).length
      ? existing.context_snapshot
      : await buildLiveContext(userId, id);

  // Session creation itself is delegated to the authoritative RPC, which
  // re-checks entitlement internally and returns the existing session when
  // one is already present. Creating a session never spends anything;
  // only activation does.
  const { data, error } = await service.rpc("odesseus_create_live_session", {
    p_user_id: userId,
    p_interview_id: id,
    p_capture_mode: input.captureMode,
    p_context_snapshot: context,
  });

  if (error || !data) {
    const msg = error?.message?.toLowerCase() || "";
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Odesseus could not prepare the Live session." },
      { status: 500 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json(
      { error: "Odesseus could not prepare the Live session." },
      { status: 500 }
    );
  }

  if (row.status === "payment_required") {
    return NextResponse.json(
      { error: "You need one interview pass to start Odesseus Live." },
      { status: 402 }
    );
  }

  return NextResponse.json({
    sessionId: row.session_id,
    status: row.status,
    alreadyCharged: existing?.status === "active",
  });
}
