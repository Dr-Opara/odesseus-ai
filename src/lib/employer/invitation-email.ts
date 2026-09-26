/**
 * Employer team invitation email.
 *
 * M5 created invitations but deliberately did not send them: the route returned
 * the token and left delivery to the admin. That is not a usable product — an
 * admin inviting a teammate should not have to copy a link into a mail client
 * themselves, and nothing in the product recorded whether the message went out.
 *
 * This module owns the email. The transport itself is shared
 * (`@/lib/email/send`), so there is still exactly one Resend integration.
 */

import { sendEmail, type EmailResult } from "@/lib/email/send";
import { type InvitableRole } from "@/lib/employer/service";

/**
 * Where the redemption link points.
 *
 * The backend owns the redemption itself (`POST /api/employer/invitations/accept`,
 * which requires the caller's verified email to match the invitation). The page
 * that collects the token and calls that endpoint is frontend-owned, and this
 * constant is the single contract between the two: one path, one query
 * parameter. Changing it here changes every invitation email.
 */
export const INVITATION_REDEEM_PATH = "/employers/team/join";

/** How each invitable role is described to the recipient. */
const ROLE_LABEL: Record<InvitableRole, string> = {
  admin: "team admin",
  recruiter: "recruiter",
  viewer: "viewer",
};

/**
 * The redemption URL for a token.
 *
 * `encodeURIComponent` is applied even though the token is already hex: this
 * value ends up in a URL a mail client will rewrite, and a token that escaped
 * its parameter would silently redeem the wrong thing (or nothing).
 */
export function buildInvitationLink(token: string): string {
  return `${INVITATION_REDEEM_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * Builds the invitation message.
 *
 * The token is included in the body as well as the button. Mail clients rewrite
 * long query strings, and a recipient who cannot follow the link should still be
 * able to join. This is safe because the token is not a bearer credential for
 * anything: the accept RPC additionally requires the caller's verified email to
 * match the invitation, so possession of the token alone grants nothing.
 *
 * Exported for testing so the wording can be asserted without a transport.
 */
/**
 * The exact fields handed to the transport. Named so a test can assert on the
 * wording without a provider.
 */
export type InvitationMessage = {
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

export function buildInvitationMessage(input: {
  to: string;
  orgName: string;
  role: InvitableRole;
  token: string;
  expiresAt: Date;
  /** Injected so the message is deterministic under test. */
  now?: Date;
}): InvitationMessage {
  const now = input.now ?? new Date();
  const days = Math.max(
    1,
    Math.ceil((input.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  );
  const roleLabel = ROLE_LABEL[input.role];
  const orgName = input.orgName.trim() || "an Odesseus employer team";
  const link = buildInvitationLink(input.token);
  // An explicit date, in the one format that cannot be misread as month/day.
  // Quoting two different durations ("expires in 1 day (7 days from now)") is
  // how a recipient ends up thinking they have a week when they have a day.
  const expiresOn = input.expiresAt.toISOString().slice(0, 10);

  return {
    subject: `You're invited to join ${orgName} on Odesseus`,
    heading: "You've been invited to a hiring team.",
    body: [
      `You have been invited to the ${orgName} team on Odesseus as a ${roleLabel}.`,
      "",
      "Accept the invitation:",
      link,
      "",
      `Or sign in at ${(process.env.NEXT_PUBLIC_SITE_URL || "https://odesseus.ai").replace(/\/$/, "")} and enter this code: ${input.token}`,
      "",
      `This invitation expires on ${expiresOn} (${days} day${days === 1 ? "" : "s"} from now) and cannot be renewed.`,
      "",
      "If you were not expecting this, you can ignore this message. Nobody is added to the team until you accept.",
    ].join("\n"),
    ctaLabel: "Join the team",
    ctaHref: link,
  };
}

/**
 * Delivers an invitation.
 *
 * A delivery failure is returned, never thrown: the invitation row already
 * exists, so failing the request would tell the admin nothing was sent when in
 * fact they can still pass the link on manually. The caller reports the
 * outcome and keeps returning the token.
 */
export async function sendInvitationEmail(input: {
  to: string;
  orgName: string;
  role: InvitableRole;
  token: string;
  expiresAt: Date;
  now?: Date;
}): Promise<EmailResult> {
  const message = buildInvitationMessage(input);
  return sendEmail(
    { to: input.to, ...message },
    "[ODESSEUS_EMPLOYER_TEAM]"
  );
}
