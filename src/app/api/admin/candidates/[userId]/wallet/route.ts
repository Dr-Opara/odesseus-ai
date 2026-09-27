import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { ADMIN_RESPONSE_HEADERS, adminAuthorizationError, requireCapability } from "@/lib/admin/authorize";
import { adjustWallet } from "@/lib/admin/wallet";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const adjustmentSchema = z.object({
  amountCents: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, "Amount must be non-zero"),
  reference: z.string().min(1).max(100),
  reason: z.string().min(1).max(500),
});

/**
 * Adjust a candidate's wallet balance. Requires `wallet:adjust`, which is
 * granted to `admin` and `finance_admin` only. A `marketing_admin` is refused
 * both at the route level (capability check) and at the database layer
 * (the RPC re-checks the role).
 *
 * The adjustment goes through the same `apply_credit_transaction` trigger that
 * handles top-ups and Apply debits, so the balance and the ledger move together
 * and the single choke point is never bypassed. Idempotency is via the
 * caller-supplied `reference` (ON CONFLICT DO NOTHING), so a retried request
 * with the same reference moves no money and returns `applied = false`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authorization = await requireCapability(request, "wallet:adjust");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "Invalid candidate ID." }, { status: 400 });
  }

  const rate = checkRateLimit(`admin:wallet:adjust:${authorization.userId}`, 60, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many wallet adjustments. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = adjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((e) => e.message).join(", ") },
      { status: 400 }
    );
  }

  const { amountCents, reference, reason } = parsed.data;

  const result = await adjustWallet(createServiceClient(), {
    userId,
    amountCents,
    reference,
    reason,
    actor: {
      userId: authorization.userId,
      role: authorization.role,
      email: authorization.userEmail,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    { balanceCentsAfter: result.balanceCentsAfter, applied: result.applied },
    { headers: ADMIN_RESPONSE_HEADERS }
  );
}