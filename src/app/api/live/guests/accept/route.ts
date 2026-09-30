import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logLiveEvent } from "@/lib/observability/events";

export const runtime = "nodejs";

const acceptSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

/**
 * The database function's result vocabulary, mapped to HTTP status.
 *
 * `guest_limit_reached` is absent, and its absence is the point. The function
 * can no longer return it -- the trigger that raised 'guest limit reached' has
 * been dropped along with the quota -- and leaving a mapping for a result
 * nothing produces would invite a caller to keep handling a limit the product
 * does not sell. A retired refusal should not have a status code waiting for
 * it here.
 */
const RESULT_STATUS: Record<string, number> = {
  activated: 200,
  already_active: 200,
  inactive: 409,
  expired: 410,
  invalid: 400,
};

/**
 * Redeems a Live Share invitation.
 *
 * The database proves the one thing worth proving here: that the caller is
 * signed in as the invited address. It used to prove a second thing -- that the
 * activation did not exceed the owner's places for the year -- and an
 * activation was where a place was consumed. Neither is true of the current
 * model: Live Share has no guest cap, no slot consumption, and no concurrency
 * accounting, so there is nothing to exceed and nothing to consume.
 *
 * Retrying is still answered "already active" rather than activating twice,
 * which is a property of the invitation being single-use rather than of any
 * quota.
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

  return NextResponse.json(
    {
      result: row.result,
      message: row.message,
      membership_id: row.membership_id,
      period_end: row.period_end,
    },
    { status }
  );
}
