import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin } from "@/lib/partners/service";
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
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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

  if (!(await isAdmin(userId))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

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

  const result = await setJobReportStatus(
    createServiceClient(),
    id,
    input.status,
    input.note ? input.note.trim() || null : null
  );

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
