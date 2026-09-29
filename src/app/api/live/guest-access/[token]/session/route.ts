import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import {
  GUEST_SHARE_SOURCE,
  buildGuestLiveContext,
  loadGuestAccess,
} from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

async function guestSessionState(
  service: ReturnType<typeof createServiceClient>,
  record: { live_session_id: string | null; owner_user_id: string }
) {
  if (!record.live_session_id) {
    return { hasSession: false as const };
  }

  const [{ data: session }, { data: transcriptItems }, { data: guidanceItems }] =
    await Promise.all([
      service
        .from("live_interview_sessions")
        .select("id,status,activated_at,ended_at")
        .eq("id", record.live_session_id)
        .eq("user_id", record.owner_user_id)
        .maybeSingle(),
      service
        .from("live_transcript_items")
        .select("id,transcript,is_question,question_text,occurred_at")
        .eq("session_id", record.live_session_id)
        .eq("user_id", record.owner_user_id)
        .order("occurred_at", { ascending: true }),
      service
        .from("live_guidance")
        .select("id,question_text,response_text,structure,verified_evidence,caution,created_at")
        .eq("session_id", record.live_session_id)
        .eq("user_id", record.owner_user_id)
        .order("created_at", { ascending: true }),
    ]);

  if (!session) {
    return { hasSession: false as const };
  }

  return {
    hasSession: true as const,
    sessionId: session.id,
    status: session.status,
    activatedAt: session.activated_at,
    endedAt: session.ended_at,
    transcriptItems: transcriptItems ?? [],
    guidanceItems: guidanceItems ?? [],
  };
}

/**
 * Read the guest's Live session state. Scoped to the single session linked
 * from this guest record; nothing else is reachable through the token.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json(await guestSessionState(service, access.record));
}

/**
 * Start the guest's Live session. Reuses the existing applicant lifecycle
 * verbatim: a guest-marked interview row plus odesseus_create_live_session.
 * Creating a session never spends anything; only activation does, through
 * the owner's existing entitlement. Idempotent: a started link returns its
 * current session instead of minting another.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;

  if (record.live_session_id) {
    return NextResponse.json(await guestSessionState(service, record));
  }

  if (record.status !== "pending") {
    return NextResponse.json(
      { error: "This guest session has already finished." },
      { status: 409 }
    );
  }

  if (!record.guest_name || !record.guest_company || !record.guest_role_title) {
    return NextResponse.json(
      { error: "Finish guest setup before starting the Live session." },
      { status: 400 }
    );
  }

  const { data: interview, error: interviewError } = await service
    .from("interviews")
    .insert({
      user_id: record.owner_user_id,
      application_id: null,
      source: GUEST_SHARE_SOURCE,
      status: "scheduled",
      company: record.guest_company,
      role_title: record.guest_role_title,
      notes: record.guest_notes,
    })
    .select("id,status,interview_type")
    .single();

  if (interviewError || !interview) {
    return NextResponse.json(
      { error: "Odesseus could not start the guest session." },
      { status: 500 }
    );
  }

  const context = buildGuestLiveContext({ record, interview });

  // The jsonb snapshot must hold only JSON-safe values; the round trip both
  // satisfies the RPC's Json parameter and guarantees serializability.
  const contextSnapshot: Json = JSON.parse(JSON.stringify(context));

  const { data, error } = await service.rpc("odesseus_create_live_session", {
    p_user_id: record.owner_user_id,
    p_interview_id: interview.id,
    p_capture_mode: "shared_audio",
    p_context_snapshot: contextSnapshot,
  });

  if (error || !data) {
    return NextResponse.json(
      { error: "Odesseus could not start the guest session." },
      { status: 500 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json(
      { error: "Odesseus could not start the guest session." },
      { status: 500 }
    );
  }

  if (row.status === "payment_required") {
    return NextResponse.json(
      { error: "This guest link is no longer active." },
      { status: 402 }
    );
  }

  const now = new Date().toISOString();
  const { error: linkError } = await service
    .from("guest_access_records")
    .update({
      interview_id: interview.id,
      live_session_id: row.session_id,
      status: "active",
      activated_at: now,
      updated_at: now,
    })
    .eq("id", record.id);

  if (linkError) {
    return NextResponse.json(
      { error: "Odesseus could not start the guest session." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    hasSession: true,
    sessionId: row.session_id,
    status: row.status,
  });
}
