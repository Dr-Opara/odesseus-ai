import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  INVITABLE_ROLES,
  createInvitation,
  isPlausibleEmail,
  requireOrgAdmin,
} from "@/lib/employer/service";

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
 * Invites someone to an employer team.
 *
 * Returns the invitation plus its token so the calling admin can pass the link
 * on. Delivery is deliberately not implemented here: outbound email is an
 * integration concern with its own authorization and provider plumbing, and
 * quietly assuming a mail transport exists would be inventing infrastructure.
 * The token is only a redemption secret — the accept path additionally requires
 * the recipient's verified email to match.
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
    return NextResponse.json(
      {
        invitation: result.invitation,
        // The redemption secret, for the admin to pass on. Never logged.
        token: result.token,
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
