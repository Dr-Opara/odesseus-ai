import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, adminAuthorizationError } from "@/lib/admin/authorize";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { buildStatusNotice, sendCareerMessage } from "@/lib/careers/email";
import {
  REVIEWABLE_APPLICATION_STATUSES,
  getApplication,
  getOpeningTitle,
  setApplicationStatus,
} from "@/lib/careers/service";

export const runtime = "nodejs";

const updateSchema = z.object({
  // Built from the domain list so a status the service refuses cannot be
  // requested here, and a status it accepts cannot be forgotten here.
  status: z.enum(REVIEWABLE_APPLICATION_STATUSES),
});

/**
 * One application in full, including the applicant's own written answers.
 *
 * Separate from the queue list on purpose: the cover letter, links, and work
 * authorisation are what a reviewer opens a row *for*, and they are not what a
 * queue needs in order to be scrolled.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await requireCapability(request, "careers:read");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  }

  try {
    const application = await getApplication(id);
    if (!application) {
      return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
    }
    return NextResponse.json(application);
  } catch (error) {
    console.error("[ODESSEUS_CAREERS] application read failed", error);
    return NextResponse.json(
      { error: "Could not load that application." },
      { status: 500 }
    );
  }
}

/**
 * Moves one application through the pipeline. Requires `careers:manage`.
 *
 * The actor is passed in rather than resolved inside the database, for the same
 * reason the moderation RPC is: the browser role is not an admin, so Postgres
 * has no way to learn who decided. `reviewed_by` and `reviewed_at` are stamped
 * by the service, never read from the body — a form field named `reviewed_by`
 * is a form field an admin can edit.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const authorization = await requireCapability(request, "careers:manage");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof updateSchema>;
  try {
    input = updateSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "That update is not valid." }, { status: 400 });
  }

  const result = await setApplicationStatus({
    applicationId: id,
    status: input.status,
    reviewerId: authorization.userId,
  });

  if (result.ok) {
    await notifyApplicant({ applicationId: id, status: input.status });
    return NextResponse.json({ ok: true });
  }

  // A rejected or hired application is terminal, and a second decision on it is
  // reported the same way as a missing row: "not found" rather than a success
  // that quietly overwrote the first decision.
  return NextResponse.json(
    { error: "That application could not be updated." },
    { status: result.reason === "not_found" ? 404 : 400 }
  );
}

/**
 * Tells the applicant the decision, once it has actually been recorded.
 *
 * Only the three states a person deserves to hear about: an interview, an offer,
 * or a rejection. `reviewing` is internal queue bookkeeping and sending an email
 * for it would train applicants to ignore our mail.
 *
 * The transition is committed before this runs and the send can never fail the
 * request — a provider outage must not roll back a decision a reviewer already
 * made, and must not tell the admin their update failed. A rejected applicant
 * who never hears is still the worse outcome, so a delivery failure is logged
 * for a human to notice rather than swallowed.
 */
async function notifyApplicant(input: {
  applicationId: string;
  status: "reviewing" | "interview" | "rejected" | "hired";
}) {
  if (input.status === "reviewing") return;

  const application = await getApplication(input.applicationId).catch(() => null);
  if (!application) return;

  const roleTitle = await openingTitle(application.job_opening_id);
  if (!roleTitle) return;

  const result = await sendCareerMessage({
    to: application.email,
    ...buildStatusNotice({
      firstName: application.full_name,
      roleTitle,
      status: input.status,
    }),
  }).catch(() => ({ sent: false as const, reason: "network_error" as const }));

  if (!result.sent) {
    console.error(
      "[ODESSEUS_CAREERS] applicant notice not delivered",
      input.applicationId,
      result.reason
    );
  }
}

/** The role title, or null if the role row has gone. */
async function openingTitle(openingId: string): Promise<string | null> {
  return getOpeningTitle(openingId).catch(() => null);
}
