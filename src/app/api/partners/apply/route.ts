import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, checkRateLimit } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { partnerService } from "@/lib/partners/service";
import { sendPartnerEmail } from "@/lib/partners/email";

export const runtime = "nodejs";

const socialSchema = z.object({
  platform: z.enum(["instagram","facebook","tiktok"]),
  handle: z.string().trim().min(1).max(100),
  profileUrl: z.string().url().max(500),
  followerCount: z.number().int().min(0).max(1_000_000_000),
  averageReach: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  audienceCountry: z.string().trim().max(120).nullable().optional(),
});

const applicationSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(255),
  country: z.string().trim().min(2).max(120),
  cityState: z.string().trim().max(160).nullable().optional(),
  primaryNiche: z.enum(["career_jobs","technology","ai","education","business","lifestyle","other"]),
  audienceDescription: z.string().trim().min(20).max(2500),
  motivation: z.string().trim().min(20).max(2500),
  sampleLinks: z.array(z.string().url().max(500)).min(1).max(3),
  previousBrandExperience: z.string().trim().max(1500).nullable().optional(),
  expectedRate: z.string().trim().max(120).nullable().optional(),
  preferredPartnerships: z.array(z.enum(["affiliate","creator","brand_ambassador","sponsored_campaign","open_to_all"])).min(1).max(5),
  socials: z.array(socialSchema).min(1).max(3),
  acceptedTerms: z.literal(true),
});

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const limit = checkRateLimit(`partner-apply:${clientIp(request)}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many applications from this network. Please try again later." }, { status: 429 });
  }

  let input: z.infer<typeof applicationSchema>;
  try {
    input = applicationSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Please review the form and try again." }, { status: 400 });
  }

  const service = partnerService();
  const { data: existing } = await service
    .from("partner_applications")
    .select("id,status")
    .ilike("email", input.email)
    .in("status", ["submitted","under_review","approved","waitlisted"])
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "An active partner application already exists for this email." }, { status: 409 });
  }

  const { data: application, error } = await service
    .from("partner_applications")
    .insert({
      full_name: input.fullName,
      email: input.email.toLowerCase(),
      country: input.country,
      city_state: input.cityState || null,
      primary_niche: input.primaryNiche,
      audience_description: input.audienceDescription,
      motivation: input.motivation,
      sample_links: input.sampleLinks,
      previous_brand_experience: input.previousBrandExperience || null,
      expected_rate: input.expectedRate || null,
      preferred_partnerships: input.preferredPartnerships,
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !application) {
    console.error("[ODYSSEUS_PARTNERS] application insert failed", error);
    return NextResponse.json({ error: "We could not submit your application." }, { status: 500 });
  }

  const { error: socialError } = await service
    .from("partner_social_accounts")
    .insert(input.socials.map((social) => ({
      application_id: application.id,
      platform: social.platform,
      handle: social.handle,
      profile_url: social.profileUrl,
      follower_count: social.followerCount,
      average_reach: social.averageReach ?? null,
      audience_country: social.audienceCountry || null,
    })));

  if (socialError) {
    await service.from("partner_applications").delete().eq("id", application.id);
    console.error("[ODYSSEUS_PARTNERS] social insert failed", socialError);
    return NextResponse.json({ error: "We could not submit your application." }, { status: 500 });
  }

  await sendPartnerEmail({
    to: input.email.toLowerCase(),
    subject: "We received your Odysseus Partner application",
    heading: "Application received.",
    body: "Thanks for applying to the Odysseus Partner Program. Our team will review your profile and contact you if there’s a fit.",
    ctaLabel: "View the Partner Program",
    ctaHref: "/partners",
  });

  return NextResponse.json({ ok: true, applicationId: application.id });
}
