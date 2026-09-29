import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  canGenerateGuestLinks,
  generateGuestLinkToken,
  hashGuestLinkToken,
} from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

/**
 * Mint a no-account Guest Live Access Link.
 *
 * Only an authenticated Share Annual owner with current access may create
 * one. The raw token is returned exactly once, here. Only its SHA-256 hex
 * digest is persisted; the token encodes no user id and no database id,
 * and it is never written to logs or analytics.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  // Link minting is cheap and retry-heavy; the bound only stops scripting.
  const rate = checkRateLimit(`live:guest-links:${userId}`, 20, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many guest links created. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const entitlement = await readLiveEntitlement(userId);
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: "Odesseus could not check Live access." },
      { status: 500 }
    );
  }

  if (!canGenerateGuestLinks(entitlement.row)) {
    return NextResponse.json(
      { error: "Guest Live links are only available on the annual Live Share plan." },
      { status: 403 }
    );
  }

  const token = generateGuestLinkToken();
  const service = createServiceClient();

  const { error } = await service.from("guest_access_records").insert({
    owner_user_id: userId,
    token_sha256: hashGuestLinkToken(token),
    status: "pending",
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not create that guest link." },
      { status: 500 }
    );
  }

  return NextResponse.json({ token });
}
