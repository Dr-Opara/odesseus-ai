import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_RESPONSE_HEADERS,
  adminAuthorizationError,
  requireCapability,
} from "@/lib/admin/authorize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  listApplications,
  listAllOpenings,
  type CareerApplicationStatus,
} from "@/lib/careers/service";

export const runtime = "nodejs";

// Built from the domain module rather than re-listed here, so this filter can
// never drift from the statuses the pipeline actually stores.
const statusFilter = z.enum([
  "submitted",
  "reviewing",
  "interview",
  "rejected",
  "hired",
  "withdrawn",
]);

/**
 * The careers queue. Admin-only, service-role backed.
 *
 * `career_applications` is applicant personal data, so this is the deliberate
 * exception to the applicant-scoped RLS policy on the table: an admin reading
 * somebody else's job application is the entire point of the pipeline. Requires
 * `careers:read`, so a finance admin is refused — settling a billing dispute is
 * not a reason to see who applied to a job.
 *
 * The list projection is the narrowed `CareerApplication` shape, not the table
 * row. An applicant never sees their own row through this route, and nothing
 * they wrote beyond the fields a reviewer triages on is shipped in a list an
 * admin scrolls.
 */
export async function GET(request: Request) {
  const authorization = await requireCapability(request, "careers:read");
  if (!authorization.ok) return adminAuthorizationError(authorization);

  const rate = checkRateLimit(`careers-queue:admin:${authorization.userId}`, 120, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many queue requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return NextResponse.json({ error: "Invalid pagination." }, { status: 400 });
  }

  let status: CareerApplicationStatus | undefined;
  if (rawStatus !== null) {
    const parsed = statusFilter.safeParse(rawStatus);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    status = parsed.data;
  }

  try {
    const [page, openings] = await Promise.all([
      listApplications({ status, limit, offset }),
      listAllOpenings(),
    ]);
    return NextResponse.json({ ...page, openings }, { headers: ADMIN_RESPONSE_HEADERS });
  } catch (error) {
    console.error("[ODESSEUS_CAREERS] queue read failed", error);
    return NextResponse.json(
      { error: "Could not load the careers queue." },
      { status: 500 }
    );
  }
}
