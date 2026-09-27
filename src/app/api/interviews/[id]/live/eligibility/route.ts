import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Check Live eligibility for an interview.
 * Returns the entitlement status and whether a session can be created.
 */
export async function GET(
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

  // Verify interview exists and belongs to user
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

  // Check for existing session
  const { data: existing } = await service
    .from("live_interview_sessions")
    .select("id,status,activated_at,ended_at")
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  // One authoritative access decision. This RPC is service-role only and is
  // the same function behind /api/live/entitlement, so an interview screen can
  // never disagree with billing about whether a session may start.
  const { data: entitlement } = await service.rpc("odesseus_get_live_entitlement", {
    p_user_id: userId,
  });

  // Cast rather than trust the generated RPC type: a Postgres OUT-parameter
  // function's composite return does not codegen as a usable row shape, the
  // same reason /api/live/entitlement and the guest routes all cast this
  // call explicitly.
  const e = (Array.isArray(entitlement) ? entitlement[0] : entitlement) as
    | {
        has_entitlement: boolean;
        entitlement_type: string;
        passes_remaining: number;
        unlimited_until: string | null;
        is_owner: boolean;
        is_guest: boolean;
        membership_id: string | null;
        guest_limit: number;
        activated_guest_count: number;
        plan: string | null;
      }
    | undefined;

  // Determine eligibility state
  let eligibilityState: "eligible" | "payment_required" | "has_session" | "completed" = "eligible";
  if (existing) {
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "expired") {
      eligibilityState = "completed";
    } else {
      eligibilityState = "has_session";
    }
  } else if (!e?.has_entitlement) {
    eligibilityState = "payment_required";
  }

  return NextResponse.json({
    interviewId: id,
    eligibility: eligibilityState,
    entitlement: {
      hasEntitlement: e?.has_entitlement ?? false,
      source: e?.entitlement_type ?? "none",
      plan: e?.plan ?? null,
      // Uniformly meaningful across every entitlement kind, including the
      // legacy annual window: the headroom left in the current fair-use
      // window, or the unspent passes when a discrete pass was bought.
      passesRemaining: e?.passes_remaining ?? 0,
      unlimitedUntil: e?.unlimited_until ?? null,
      isOwner: e?.is_owner ?? false,
      isGuest: e?.is_guest ?? false,
      membershipId: e?.membership_id ?? null,
      guestLimit: e?.guest_limit ?? 0,
      activatedGuestCount: e?.activated_guest_count ?? 0,
    },
    existingSession: existing
      ? {
          id: existing.id,
          status: existing.status,
          activatedAt: existing.activated_at,
          endedAt: existing.ended_at,
        }
      : null,
    interviewStatus: interview.status,
    livePassStatus: interview.live_pass_status,
  });
}