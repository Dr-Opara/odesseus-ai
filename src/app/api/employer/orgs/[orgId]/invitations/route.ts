import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  INVITABLE_ROLES,
  createInvitation,
  getOrgName,
  isPlausibleEmail,
  requireOrgAdmin,
} from "@/lib/employer/service";
import { sendInvitationEmail } from "@/lib/employer/invitation-email";

export const runtime = "nodejs";

// Inviting is a real-world side effect (an email address leaves the platform),
// so it is rate limited per org on top of being origin-checked.
const INVITES_PER_HOUR = 50;

const schema = z.object({
  email: z.string().min(3).max(254),
  // 'owner' is not invitable: ownership lives on the organization row.
  role: z.enum(INVITABLE_ROLES),
});

/**
 * Invites someone to an employer team and emails them the redemption link.
 *
 * The invitation row is written first, then the email is sent. That order is
 * deliberate: the row is the fact, the email is a notification about it. If
 * delivery fails, the invitation still exists and the admin can pass the link on,
 * so the response stays 201 and reports the delivery outcome separately. The
 * reverse order would mean an email referring to an invitation that was then
 * rejected as a duplicate.
 *
 * The token is still returned to the calling admin so a manual copy is always
 * possible, and so a delivery outage is not a dead end. It is never logged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
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

  const { orgId } = await params;
  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address and role." },
      { status: 400 }
    );
  }

  if (!isPlausibleEmail(input.email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
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
      ? NextResponse.json({ error: "That team could not be found." }, { status: 404 })
      : NextResponse.json(
          { error: "Only a team owner or admin can invite people." },
          { status: 403 }
        );
  }

  const rate = checkRateLimit(
    `employer-invite:${orgId}`,
    INVITES_PER_HOUR,
    60 * 60 * 1000
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many invitations sent. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const result = await createInvitation(supabase, {
    orgId,
    invitedBy: userId,
    email: input.email,
    role: input.role,
  });

  if (result.ok) {
    // Naming the team makes the message recognisable; a missing name only costs
    // the recipient some context, so it must not block delivery.
    const orgName = await getOrgName(supabase, orgId);
    const delivery = await sendInvitationEmail({
      to: result.invitation.email,
      orgName: orgName ?? "",
      role: input.role,
      token: result.token,
      expiresAt: new Date(result.invitation.expires_at),
    });

    if (!delivery.sent) {
      // Logged, not thrown: the invitation is real and the admin can still pass
      // the link on. Not logging the address keeps a bounce investigation
      // possible without writing invitee addresses into server logs.
      console.error(
        "[ODESSEUS_EMPLOYER_TEAM] invitation email not delivered",
        orgId,
        delivery.reason
      );
    }

    return NextResponse.json(
      {
        invitation: result.invitation,
        // The redemption secret, for the admin to pass on. Never logged.
        token: result.token,
        // Whether the invitee was actually emailed. The admin still has the
        // token above, so a false here is a degraded delivery, not a failure.
        emailed: delivery.sent,
      },
      { status: 201 }
    );
  }

  switch (result.code) {
    case "invalid":
      return NextResponse.json(
        { error: "Enter a valid email address and role." },
        { status: 400 }
      );
    case "duplicate":
      return NextResponse.json(
        { error: "There is already an open invitation for that address." },
        { status: 409 }
      );
    default:
      console.error(
        "[ODESSEUS_EMPLOYER_TEAM] invitation insert failed",
        orgId,
        input.role
      );
      return NextResponse.json(
        { error: "Could not send that invitation. Please try again." },
        { status: 500 }
      );
  }
}
