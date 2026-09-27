import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logLiveEvent } from "@/lib/observability/events";
import { LIVE_SHARE_GUEST_LIMIT } from "@/lib/billing/catalog";

export const runtime = "nodejs";

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

/** How long a guest link stays usable, absent an explicit request. */
const DEFAULT_INVITE_DAYS = 14;

type MembershipRow = {
  id: string;
  plan_type: string;
  status: string;
  current_period_end: string | null;
  guest_limit: number;
  guest_count: number;
};

/**
 * The caller's own Live Share membership, or null.
 *
 * Scoped with eq("user_id", userId) so a member can never address somebody
 * else's membership by passing an id.
 */
async function requireOwnShareMembership(userId: string): Promise<
  { membership: MembershipRow; service: ReturnType<typeof createServiceClient> } | { error: NextResponse }
> {
  const service = createServiceClient();

  const { data, error } = await service
    .from("live_memberships")
    .select("id,plan_type,status,current_period_end,guest_limit,guest_count")
    .eq("user_id", userId)
    .eq("plan_type", "share_annual")
    .maybeSingle();

  if (error) {
    return {
      error: NextResponse.json(
        { error: "Odesseus could not load your Live Share membership." },
        { status: 500 }
      ),
    };
  }

  const membership = data as MembershipRow | null;
  if (!membership) {
    return {
      error: NextResponse.json(
        { error: "Live Share is only available on the annual Live Share plan." },
        { status: 403 }
      ),
    };
  }

  if (
    !["active", "trialing", "canceled"].includes(membership.status) ||
    !membership.current_period_end ||
    new Date(membership.current_period_end) <= new Date()
  ) {
    return {
      error: NextResponse.json(
        { error: "Your Live Share membership is not active." },
        { status: 403 }
      ),
    };
  }

  return { membership, service };
}

/**
 * Owner view of the guest list: how many places are used and which
 * invitations are still outstanding.
 *
 * Returns counts and invitation state only. It never returns a guest's resume,
 * interview, transcript or any other private workspace content, and it is
 * scoped to the caller's own membership.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const resolved = await requireOwnShareMembership(userId);
  if ("error" in resolved) return resolved.error;
  const { membership, service } = resolved;

  const { data: invites, error } = await service
    .from("live_guest_invites")
    .select("id,status,invited_at,activated_at,expires_at")
    .eq("membership_id", membership.id)
    .order("invited_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not load your guests." },
      { status: 500 }
    );
  }

  const rows = (invites ?? []) as Array<{
    id: string;
    status: string;
    invited_at: string;
    activated_at: string | null;
    expires_at: string;
  }>;

  const activated = rows.filter((r) => r.status === "activated").length;
  const pending = rows.filter((r) => r.status === "pending").length;

  return NextResponse.json({
    membership_id: membership.id,
    plan_type: membership.plan_type,
    status: membership.status,
    period_end: membership.current_period_end,
    // The database column is authoritative and the table's own CHECK keeps it
    // within guest_limit; the catalog constant is the display mirror.
    guest_limit: membership.guest_limit,
    activated_guest_count: membership.guest_count,
    pending_invite_count: pending,
    guest_places_remaining: Math.max(membership.guest_limit - membership.guest_count, 0),
    max_guests_per_year: LIVE_SHARE_GUEST_LIMIT,
    // Email addresses are intentionally omitted. The owner invited them, but
    // this response is the surface a client renders and forwards around.
    invites: rows.map((r) => ({
      id: r.id,
      status: r.status,
      invited_at: r.invited_at,
      activated_at: r.activated_at,
      expires_at: r.expires_at,
    })),
  });
}

/**
 * Invites someone to share this Live membership.
 *
 * An invitation consumes nothing: the guest cap is applied on activation, so
 * an owner may keep spare invitations outstanding and revoke them. This route
 * refuses to even issue one when no places remain, purely so the caller gets a
 * clear message instead of an invitation that could never be redeemed — the
 * real cap is still the database trigger.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof inviteSchema>;
  try {
    input = inviteSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address for your guest." },
      { status: 400 }
    );
  }

  const resolved = await requireOwnShareMembership(userId);
  if ("error" in resolved) return resolved.error;
  const { membership, service } = resolved;

  if (membership.guest_count >= membership.guest_limit) {
    await logLiveEvent({
      eventName: "live.guest_cap_reached",
      userId,
      properties: {
        membership_id: membership.id,
        guest_limit: membership.guest_limit,
        activated_guest_count: membership.guest_count,
        stage: "invite_refused",
      },
    });
    return NextResponse.json(
      {
        error: `You have used all ${membership.guest_limit} guest places for this membership year.`,
        guest_limit: membership.guest_limit,
        activated_guest_count: membership.guest_count,
      },
      { status: 409 }
    );
  }

  // The token is generated here with node:crypto and handed to the database as
  // a hash only. It is returned exactly once, here, and never persisted in
  // clear text or written to a log.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + (input.expiresInDays ?? DEFAULT_INVITE_DAYS) * 86_400_000
  ).toISOString();

  const { data, error } = await service.rpc("odesseus_create_live_guest_invite", {
    p_membership_id: membership.id,
    p_owner_user_id: userId,
    p_guest_email: input.email,
    p_invite_token: token,
    p_expires_at: expiresAt,
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not create that invitation." },
      { status: 400 }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { invite_id: string; status: string; expires_at: string }
    | null;

  await logLiveEvent({
    eventName: "live.guest_invite_created",
    userId,
    properties: {
      membership_id: membership.id,
      invite_id: row?.invite_id ?? null,
      expires_at: row?.expires_at ?? null,
    },
  });

  return NextResponse.json({
    invite_id: row?.invite_id ?? null,
    status: row?.status ?? "pending",
    expires_at: row?.expires_at ?? null,
    // Only this response ever carries the usable link.
    invite_token: token,
  });
}

/** Revokes an invitation that has not been activated yet. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let inviteId: string | null = null;
  try {
    const body = z.object({ inviteId: z.string().uuid() }).parse(await request.json());
    inviteId = body.inviteId;
  } catch {
    return NextResponse.json({ error: "Choose an invitation to revoke." }, { status: 400 });
  }

  const resolved = await requireOwnShareMembership(userId);
  if ("error" in resolved) return resolved.error;
  const { membership, service } = resolved;

  const { data, error } = await service.rpc("odesseus_revoke_live_guest_invite", {
    p_membership_id: membership.id,
    p_owner_user_id: userId,
    p_invite_id: inviteId,
  });

  if (error) {
    // The RPC refuses to revoke an activated guest, and that refusal is the
    // guarantee that a consumed place cannot be handed to somebody else.
    return NextResponse.json(
      { error: error.message || "That invitation could not be revoked." },
      { status: 409 }
    );
  }

  if (!data) {
    return NextResponse.json({ error: "That invitation could not be found." }, { status: 404 });
  }

  await logLiveEvent({
    eventName: "live.guest_invite_revoked",
    userId,
    properties: { membership_id: membership.id, invite_id: inviteId },
  });

  return NextResponse.json({ revoked: true });
}
