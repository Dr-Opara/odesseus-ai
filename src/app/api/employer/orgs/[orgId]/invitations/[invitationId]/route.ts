import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { requireOrgAdmin, revokeInvitation } from "@/lib/employer/service";

export const runtime = "nodejs";

/**
 * Withdraws an outstanding team invitation.
 *
 * Only pending rows move. An already-accepted invitation is left alone: it is
 * the record that somebody joined, and rewriting it would erase the audit trail.
 * A request naming another org's invitation, or one that is no longer pending,
 * simply matches nothing and reports `revoked: false` rather than 404 — the
 * caller's intent is satisfied either way and the response leaks nothing.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string; invitationId: string }> }
) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { orgId, invitationId } = await params;
  if (
    !z.string().uuid().safeParse(orgId).success ||
    !z.string().uuid().safeParse(invitationId).success
  ) {
    return NextResponse.json({ error: "That invitation could not be found." }, { status: 404 });
  }

  let authorization: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    authorization = await requireOrgAdmin(supabase, orgId, userId);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_TEAM] authorization failed", error);
    return NextResponse.json(
      { error: "Could not check your team permissions." },
      { status: 500 }
    );
  }

  if (!authorization.ok) {
    return authorization.reason === "not_a_member"
      ? NextResponse.json({ error: "That invitation could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can withdraw invitations." },
          { status: 403 }
        );
  }

  try {
    const result = await revokeInvitation(supabase, orgId, invitationId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ODESSEUS_EMPLOYER_TEAM] invitation revoke failed", error);
    return NextResponse.json(
      { error: "Could not withdraw that invitation." },
      { status: 500 }
    );
  }
}
