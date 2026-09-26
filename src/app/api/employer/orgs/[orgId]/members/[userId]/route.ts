import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import {
  getOrgRole,
  requireOrgAdmin,
  type OrgAuthorization,
} from "@/lib/employer/service";
import { syncSeatsAfterMemberChange } from "@/lib/employer/seat-sync";

export const runtime = "nodejs";

/**
 * Removes someone from an employer team, and resizes the paid seat
 * subscription to match.
 *
 * Two authorization questions are answered separately on purpose:
 *
 *   * May the caller do this at all? A member may always remove themselves
 *     (leaving a team is not a privileged act), and an owner or admin may remove
 *     anybody else. That check runs on the caller's own session client.
 *   * May this particular person be removed? The organization owner never can:
 *     ownership lives on employer_organizations.owner_user_id, and deleting the
 *     membership row would leave an org whose owner is no longer on the team and
 *     whose admin checks (`is_org_admin_or_owner`) still answer true — an account
 *     nobody could administer.
 *
 * The delete itself needs the service role. `authenticated` holds SELECT only on
 * employer_members by design, so a client cannot remove a teammate directly; the
 * authorization above is the only way in.
 *
 * Ordering: the membership row is deleted FIRST, so the seat sync recomputes
 * the requirement from a roster that already excludes the removed member. The
 * reverse order would resize Stripe against a stale roster and then fail to
 * converge.
 *
 * A failed seat sync does not fail the removal. The member is gone and seat
 * capacity is already correct -- it is derived live from the roster -- so the
 * removal succeeded. The billing adjustment is recorded as failed with a
 * released claim, and a retry can pick it up. Folding a Stripe outage into the
 * response would leave the caller believing a successful removal did not happen
 * and inviting a repeat attempt against a membership row that is already gone.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const callerId = auth?.claims?.sub;

  if (!callerId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { orgId, userId: targetUserId } = await params;
  if (
    !z.string().uuid().safeParse(orgId).success ||
    !z.string().uuid().safeParse(targetUserId).success
  ) {
    return NextResponse.json({ error: "That teammate could not be found." }, { status: 404 });
  }

  const removingSelf = callerId === targetUserId;

  let authorization: OrgAuthorization;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, callerId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_TEAM] authorization failed", error);
    return NextResponse.json(
      { error: "Could not check your team permissions." },
      { status: 500 }
    );
  }

  if (!authorization.ok && !removingSelf) {
    // A non-member gets 404 so the endpoint cannot confirm that an org exists.
    // A member who simply lacks admin rights gets an honest 403: they are
    // already on the team, so there is nothing left to conceal.
    if (authorization.reason === "not_a_member") {
      return NextResponse.json({ error: "That teammate could not be found." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Only a team owner or admin can remove someone." },
      { status: 403 }
    );
  }

  let targetRole: Awaited<ReturnType<typeof getOrgRole>>;
  try {
    targetRole = await getOrgRole(supabase, orgId, targetUserId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_TEAM] target lookup failed", error);
    return NextResponse.json(
      { error: "Could not check that team member." },
      { status: 500 }
    );
  }

  if (targetRole === null) {
    return NextResponse.json({ error: "That teammate could not be found." }, { status: 404 });
  }

  if (targetRole === "owner") {
    return NextResponse.json(
      { error: "The team owner cannot be removed. Transfer ownership first." },
      { status: 409 }
    );
  }

  const service = createServiceClient();
  const { error } = await service
    .from("employer_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", targetUserId);

  if (error) {
    console.error(
      "[ODESSEUS_EMPLOYER_TEAM] member removal failed",
      orgId,
      targetUserId
    );
    return NextResponse.json(
      { error: "Could not remove that teammate." },
      { status: 500 }
    );
  }

  // The membership row is gone, so the roster already reflects the change.
  // Resize the paid seat subscription to stop billing for the removed seat.
  const sync = await syncSeatsAfterMemberChange(service, {
    orgId,
    removedUserId: targetUserId,
  });
  if (sync.outcome === "failed") {
    // The removal itself succeeded; only the billing adjustment did not.
    console.error(
      "[ODESSEUS_EMPLOYER_SEATS] seat sync failed after member removal",
      orgId,
      sync.detail
    );
  }

  return NextResponse.json({ removed: targetUserId, seatSync: sync.outcome });
}
