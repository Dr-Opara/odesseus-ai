import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logLiveEvent } from "@/lib/observability/events";

export const runtime = "nodejs";

const acceptSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

/** The database function's result vocabulary, mapped to HTTP status. */
const RESULT_STATUS: Record<string, number> = {
  activated: 200,
  already_active: 200,
  guest_limit_reached: 409,
  inactive: 409,
  expired: 410,
  invalid: 400,
};

/**
 * Redeems a Live Share invitation.
 *
 * Two separate things are being proven here, and the database does both:
 * that the caller is signed in as the invited address, and that this
 * activation does not exceed the owner's places for the year. An invitation
 * on its own never consumed a place; this call is where a place is consumed,
 * and retrying it is answered "already active" rather than taking a second
 * one.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof acceptSchema>;
  try {
    input = acceptSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "This invitation link is not valid." },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("odesseus_accept_live_guest_invite", {
    p_token: input.token,
    p_guest_user_id: userId,
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not activate this invitation." },
      { status: 500 }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        result: string;
        message: string;
        membership_id: string | null;
        period_end: string | null;
        guest_remaining: number;
      }
    | null;

  if (!row) {
    return NextResponse.json(
      { error: "This invitation link is not valid." },
      { status: 400 }
    );
  }

  const status = RESULT_STATUS[row.result] ?? 400;

  if (row.result === "activated" || row.result === "already_active") {
    await logLiveEvent({
      eventName: "live.guest_activated",
      userId,
      properties: {
        membership_id: row.membership_id,
        result: row.result,
        period_end: row.period_end,
      },
    });
  }

  if (row.result === "guest_limit_reached") {
    await logLiveEvent({
      eventName: "live.guest_cap_reached",
      userId,
      properties: {
        membership_id: row.membership_id,
        result: row.result,
        stage: "activation_refused",
      },
    });
  }

  return NextResponse.json(
    {
      result: row.result,
      message: row.message,
      membership_id: row.membership_id,
      period_end: row.period_end,
      guest_remaining: row.guest_remaining,
    },
    { status }
  );
}
