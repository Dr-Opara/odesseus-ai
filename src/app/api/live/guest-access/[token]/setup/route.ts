import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  guestSetupSchema,
  guestTokenBucket,
  loadGuestAccess,
} from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

/**
 * Save the guest's own interview setup. Everything stored here belongs to
 * the guest session: it never touches the applicant profile, Resume Hub,
 * applications, wallet, or billing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const rate = checkRateLimit(guestTokenBucket(token, "setup"), 30, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;
  if (record.status !== "pending") {
    return NextResponse.json(
      { error: "Guest setup is locked once the Live session has started." },
      { status: 409 }
    );
  }

  let input: ReturnType<typeof guestSetupSchema.parse>;
  try {
    input = guestSetupSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Enter your name, company, and role to continue." },
      { status: 400 }
    );
  }

  const { error } = await service
    .from("guest_access_records")
    .update({
      guest_name: input.name,
      guest_company: input.company,
      guest_role_title: input.roleTitle,
      guest_job_description: input.jobDescription,
      guest_resume_text: input.resumeText,
      guest_interview_type: input.interviewType,
      guest_round: input.round,
      guest_notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not save your setup." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
