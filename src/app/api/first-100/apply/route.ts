import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, checkRateLimit } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { createServiceClient } from "@/lib/supabase/service";

const applicationSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(255),
  current_role: z.string().trim().min(2).max(160),
  target_role: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(160),
  profile_url: z.string().url().max(500).nullable().optional(),
  motivation: z.string().trim().min(50).max(3000),
  source: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const limit = checkRateLimit(`first100-apply:${clientIp(request)}`, 3, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many applications from this network. Please try again later." }, { status: 429 });
  }

  let input: z.infer<typeof applicationSchema>;
  try {
    input = applicationSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Please review the form and try again." }, { status: 400 });
  }

  const service = createServiceClient() as any;

  // Check for existing application
  const { data: existing } = await service
    .from("first_100_applications")
    .select("id,status")
    .ilike("email", input.email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "An application already exists for this email." }, { status: 409 });
  }

  const { data: application, error } = await service
    .from("first_100_applications")
    .insert({
      full_name: input.full_name,
      email: input.email.toLowerCase(),
      current_role: input.current_role,
      target_role: input.target_role,
      location: input.location,
      profile_url: input.profile_url || null,
      motivation: input.motivation,
      source: input.source || null,
    })
    .select("id")
    .single();

  if (error || !application) {
    console.error("[FIRST_100] application insert failed", error);
    return NextResponse.json({ error: "We could not submit your application." }, { status: 500 });
  }

  // Track analytics
  try {
    const { trackEventServer } = await import("@/lib/analytics/tracking");
    await trackEventServer({
      event: "first_100_signup",
      properties: {
        application_id: application.id,
        current_role: input.current_role,
        target_role: input.target_role,
        location: input.location,
      },
      anonymousId: application.id,
    });
  } catch {
    // Analytics failure should not block the response
  }

  return NextResponse.json({ ok: true, applicationId: application.id });
}