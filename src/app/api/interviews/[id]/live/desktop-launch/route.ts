import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildLiveContext } from "@/lib/live/context";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";
import { isLiveSessionTerminal } from "@/lib/live/session-status";
import {
  createDesktopOpaqueToken,
  DESKTOP_LAUNCH_TTL_MS,
  hashDesktopToken,
} from "@/lib/live/desktop-auth";

export const runtime = "nodejs";

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

  const { data: interview } = await service
    .from("interviews")
    .select("id,application_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview?.application_id) {
    return NextResponse.json({ error: "Interview context is incomplete." }, { status: 404 });
  }

  const entitlement = await readLiveEntitlement(userId);
  if (!entitlement.ok) {
    return NextResponse.json({ error: "Odesseus could not check Live access." }, { status: 500 });
  }
  if (!entitlement.row.has_access) {
    return NextResponse.json(
      { error: "You need Live access or one interview pass to start Odesseus Live." },
      { status: 402 }
    );
  }

  const { data: existing } = await service
    .from("live_interview_sessions")
    .select("id,status,context_snapshot")
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

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

  const { data: prepared, error: prepareError } = await service.rpc(
    "odesseus_create_live_session",
    {
      p_user_id: userId,
      p_interview_id: id,
      p_capture_mode: "shared_audio",
      p_context_snapshot: context,
    }
  );

  if (prepareError || !prepared) {
    return NextResponse.json(
      { error: "Odesseus could not prepare the Live desktop session." },
      { status: 500 }
    );
  }

  const row = Array.isArray(prepared) ? prepared[0] : prepared;
  if (!row?.session_id || row.status === "payment_required") {
    return NextResponse.json(
      { error: "You need Live access or one interview pass to start Odesseus Live." },
      { status: 402 }
    );
  }

  const rawTicket = createDesktopOpaqueToken();
  const now = Date.now();
  const launchExpiresAt = new Date(now + DESKTOP_LAUNCH_TTL_MS).toISOString();

  // Revoke older unredeemed launch attempts for this same interview/session.
  await service
    .from("live_desktop_sessions")
    .update({ revoked_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
    .eq("user_id", userId)
    .eq("interview_id", id)
    .is("launch_used_at", null)
    .is("revoked_at", null);

  const { error: insertError } = await service
    .from("live_desktop_sessions")
    .insert({
      user_id: userId,
      interview_id: id,
      live_session_id: row.session_id,
      launch_token_hash: hashDesktopToken(rawTicket),
      launch_expires_at: launchExpiresAt,
    });

  if (insertError) {
    console.error("[ODESSEUS_LIVE_DESKTOP] could not mint launch ticket:", insertError);
    return NextResponse.json(
      { error: "Odesseus could not prepare the Windows companion." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    launchUrl: `odesseus://live?ticket=${encodeURIComponent(rawTicket)}`,
    expiresAt: launchExpiresAt,
  });
}
