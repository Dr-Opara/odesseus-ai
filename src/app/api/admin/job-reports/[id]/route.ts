import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { adminAuthorizationError, requireCapability } from "@/lib/admin/authorize";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import {
  JOB_REPORT_DETAILS_MAX,
  JOB_REPORT_MODERATION_STATUSES,
  setJobReportStatus,
} from "@/lib/reports/service";

export const runtime = "nodejs";

const moderationSchema = z.object({
  status: z.enum(JOB_REPORT_MODERATION_STATUSES),
  note: z.string().max(JOB_REPORT_DETAILS_MAX).nullish(),
});

/**
 * Moves one report through the moderation queue. Admin-only; the transition
 * itself runs through the service-role-only `odesseus_update_job_report_status`
 * RPC, which re-validates the status and the report's existence so a
 * malformed call can never silently alter a report.
 *
 * The RPC also writes the audit row, in the same transaction as the transition,
 * so the moderation log cannot claim a change that rolled back. The actor is
 * passed in rather than resolved inside the database: the browser role is not
 * an admin, so the database has no way to learn who is.
 *
 * Requires `job_reports:moderate`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const authorization = await requireCapability(request, "job_reports:moderate");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "That report could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof moderationSchema>;
  try {
    input = moderationSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "That moderation update is not valid." }, { status: 400 });
  }

  const result = await setJobReportStatus(createServiceClient(), {
    reportId: id,
    status: input.status,
    note: input.note ? input.note.trim() || null : null,
    actor: {
      userId: authorization.userId,
      role: authorization.role,
      email: authorization.userEmail,
    },
  });

  if (result.ok) {
    return NextResponse.json({ ok: true });
  }

  // The RPC raises for a missing report or an unknown status; both are
  // client-correctable, so 400 rather than 500.
  return NextResponse.json(
    { error: result.error ?? "Could not update that report." },
    { status: 400 }
  );
}
