import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncGoogleForUser } from "@/lib/integrations/google-sync";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json(
      { error: "Please sign in again." },
      { status: 401 }
    );
  }

  const limit = checkRateLimit(
    `google-sync:user:${userId}`,
    12,
    60 * 60 * 1000
  );

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Google was synced recently. Please wait a few minutes." },
      { status: 429 }
    );
  }

  try {
    const result = await syncGoogleForUser(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ODESSEUS_GOOGLE_SYNC] manual sync failed", error);
    return NextResponse.json(
      {
        error:
          "Odesseus could not sync Google. Reconnect the account if access was revoked.",
      },
      { status: 500 }
    );
  }
}
