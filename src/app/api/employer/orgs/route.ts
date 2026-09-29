import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

// Onboarding is retry-heavy by nature (double submits, back-button
// re-posts), so the allowance is generous; the RPC itself converges retries
// onto one org, and this limit only stops scripting.
const PROVISION_PER_HOUR = 10;

const schema = z.object({
  companyName: z.string().trim().min(1).max(200),
});

/**
 * Provision the caller's employer organization (idempotent).
 *
 * This is the missing onboarding step: signup creates only the auth user,
 * and this route closes the loop by ensuring exactly one organization plus
 * owner membership through odesseus_ensure_employer_organization. Retries
 * and concurrent calls converge on the same org rather than duplicating it.
 *
 * Only employer accounts may provision. A candidate account landing here is
 * rejected so it can never gain employer access by accident.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof schema>;
  let metadataCompanyName: string | null = null;
  try {
    const { data: account } = await supabase.auth.getUser();
    const metadata = (account?.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (metadata.account_type !== "employer") {
      return NextResponse.json(
        { error: "Employer signup is required to set up a team." },
        { status: 403 }
      );
    }
    if (typeof metadata.company_name === "string" && metadata.company_name.trim()) {
      metadataCompanyName = metadata.company_name.trim();
    }
  } catch {
    return NextResponse.json(
      { error: "Odesseus could not check your account." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    // Fall back to the company name captured at signup when the caller does
    // not send one; the value is the user's own auth metadata, not input
    // that invents an organization.
    input = schema.parse({
      companyName:
        typeof raw.companyName === "string" && raw.companyName.trim()
          ? raw.companyName
          : metadataCompanyName,
    });
  } catch {
    return NextResponse.json(
      { error: "Enter your company name to set up your team." },
      { status: 400 }
    );
  }

  const rate = checkRateLimit(`employer:orgs:provision:${userId}`, PROVISION_PER_HOUR, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many setup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
    );
  }

  const service = createServiceClient();

  const { data, error } = await service.rpc("odesseus_ensure_employer_organization", {
    p_user_id: userId,
    p_company_name: input.companyName,
  });

  if (error || !data) {
    return NextResponse.json(
      { error: "Odesseus could not set up your team." },
      { status: 500 }
    );
  }

  const org = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    org: {
      id: org.id,
      name: org.name,
      ownerUserId: org.owner_user_id,
      createdAt: org.created_at,
    },
  });
}
