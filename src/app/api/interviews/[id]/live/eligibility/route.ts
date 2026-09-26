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

  // Get entitlement
  const { data: entitlement } = await service.rpc("odesseus_get_live_entitlement", {
    p_user_id: userId,
  });

  const e = entitlement?.[0] ?? {
    has_entitlement: false,
    entitlement_type: "none",
    passes_remaining: 0,
    unlimited_until: null,
    fair_use_count: 0,
    fair_use_reset: new Date().toISOString(),
  };

  // Determine eligibility state
  let eligibilityState: "eligible" | "payment_required" | "has_session" | "completed" = "eligible";
  if (existing) {
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "expired") {
      eligibilityState = "completed";
    } else {
      eligibilityState = "has_session";
    }
  } else if (!e.has_entitlement) {
    eligibilityState = "payment_required";
  }

  return NextResponse.json({
    interviewId: id,
    eligibility: eligibilityState,
    entitlement: {
      hasEntitlement: e.has_entitlement,
      type: e.entitlement_type,
      passesRemaining: e.passes_remaining,
      unlimitedUntil: e.unlimited_until,
      fairUseCount: e.fair_use_count,
      fairUseReset: e.fair_use_reset,
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