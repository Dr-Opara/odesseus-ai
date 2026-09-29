import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { parseResume } from "@/lib/ai/resume";
import type { Json } from "@/types/database";
import {
  GUEST_RESUME_PREFIX,
  guestTokenBucket,
  loadGuestAccess,
} from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_RESUME_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Guest resume upload. Server-mediated: the guest has no account, so the
 * service role stores the file under a guest-scoped storage path that no
 * authenticated RLS policy can read (first segment is never a user id, and
 * the row owner is null). The file never enters the applicant's Resume Hub
 * (public.resumes) and never becomes applicant data.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const rate = checkRateLimit(guestTokenBucket(token, "resume"), 10, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again later." },
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

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("resume");
    if (entry instanceof File) file = entry;
  } catch {
    file = null;
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Attach your resume file." }, { status: 400 });
  }

  if (file.size > MAX_RESUME_BYTES) {
    return NextResponse.json(
      { error: "That resume is larger than 10 MB." },
      { status: 400 }
    );
  }

  const mimeType = file.type || "application/pdf";
  if (!ALLOWED_RESUME_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "Upload a PDF or DOCX resume." },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "resume";
  const storagePath = `${GUEST_RESUME_PREFIX}/${record.id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await service.storage
    .from("resumes")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: "Odesseus could not store your resume." },
      { status: 500 }
    );
  }

  let profile: NonNullable<Json> | null = null;
  try {
    profile = (await parseResume({ bytes, mimeType, fileName: file.name })) as NonNullable<Json>;
  } catch (parseError) {
    console.error("[ODESSEUS_GUEST] resume parse failed", parseError);
  }

  const { error: saveError } = await service
    .from("guest_access_records")
    .update({
      guest_resume_storage_path: storagePath,
      ...(profile ? { guest_resume_profile: profile } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);

  if (saveError) {
    return NextResponse.json(
      { error: "Odesseus could not save your resume." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, parsed: profile !== null });
}
