import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";

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
  // the same function behind /api/live/entitlement, read through the same
  // shared reader, so an interview screen can never disagree with billing about
  // whether a session may start.
  //
  // A failed check fails closed to "payment required" rather than erroring the
  // whole screen. That is the right trade for this surface: the interview page
  // is the one place a candidate is trying to use the product, and turning a
  // transient database error into a dead page is worse than showing them the
  // paywall. The activation call is the thing that must not be waved through,
  // and it does its own check.
  const { row: e } = await readLiveEntitlement(userId);

  // Determine eligibility state
  let eligibilityState: "eligible" | "payment_required" | "has_session" | "completed" = "eligible";
  if (existing) {
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "expired") {
      eligibilityState = "completed";
    } else {
      eligibilityState = "has_session";
    }
  } else if (!e.has_access) {
    eligibilityState = "payment_required";
  }

  return NextResponse.json({
    interviewId: id,
    eligibility: eligibilityState,
    entitlement: {
      hasEntitlement: e.has_access,
      source: e.source,
      plan: e.plan,
      // Uniformly meaningful across every entitlement kind, including the
      // legacy annual window: the headroom left in the current fair-use
      // window, or the unspent passes when a discrete pass was bought.
      passesRemaining: e.sessions_remaining,
      unlimitedUntil: e.period_end,
      isOwner: e.is_owner,
      isGuest: e.is_guest,
      membershipId: e.membership_id,
      guestLimit: e.guest_limit,
      activatedGuestCount: e.activated_guest_count,
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