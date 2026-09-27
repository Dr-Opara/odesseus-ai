import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { ADMIN_RESPONSE_HEADERS, adminAuthorizationError, requireCapability } from "@/lib/admin/authorize";
import { getAdminAuditTrail } from "@/lib/admin/wallet";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Read the admin audit trail for a candidate. Requires `wallet:read` or
 * `wallet:adjust`, both of which are granted to `admin` and `finance_admin`.
 * The trail is bounded (default 50, max 200) and ordered recent-first.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  // wallet:read is the minimal capability; wallet:adjust also grants it
  const authorization = await requireCapability(request, "wallet:read");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "Invalid candidate ID." }, { status: 400 });
  }

  const rate = checkRateLimit(`admin:audit:trail:${authorization.userId}`, 120, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many audit trail requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(request.url);
  const queryParsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!queryParsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const { limit } = queryParsed.data;

  const trail = await getAdminAuditTrail(createServiceClient(), "candidate", userId, limit);

  return NextResponse.json({ items: trail }, { headers: ADMIN_RESPONSE_HEADERS });
}