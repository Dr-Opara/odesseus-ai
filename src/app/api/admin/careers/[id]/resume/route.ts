import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, adminAuthorizationError } from "@/lib/admin/authorize";
import { createResumeSignedUrl, getApplication, usableResumePath } from "@/lib/careers/service";

export const runtime = "nodejs";

/**
 * Mints a short-lived signed URL for one applicant's resume.
 *
 * Requires `careers:read`, and the path is read from the database row rather
 * than taken from the request: a caller cannot ask the bucket for an arbitrary
 * object by editing a query parameter or a path segment, because the only input
 * that reaches storage is what the server itself stored.
 *
 * 60 seconds, minted by the service role. The bucket is private and carries no
 * storage policy, so this route is the only way in — which is also why an
 * applicant's own upload is never handed back to them: they already have the
 * file.
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

  const application = await getApplication(id).catch(() => null);
  const path = usableResumePath(application?.resume_url);

  if (!application || !path) {
    // No application and no readable resume give the same answer, so a caller
    // cannot use this to learn which application ids exist.
    return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  }

  const signedUrl = await createResumeSignedUrl(path).catch(() => null);
  if (!signedUrl) {
    console.error("[ODESSEUS_CAREERS] resume signing failed for application", id);
    return NextResponse.json({ error: "Could not open that resume." }, { status: 500 });
  }

  return NextResponse.json(
    { url: signedUrl, expiresInSeconds: 60 },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
