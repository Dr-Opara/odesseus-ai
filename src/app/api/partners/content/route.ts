import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrLinkPartner, partnerService } from "@/lib/partners/service";
import { isTrustedOrigin } from "@/lib/security/origin-check";

const schema = z.object({
  campaignId: z.string().uuid().nullable().optional(),
  platform: z.enum(["instagram", "facebook", "tiktok"]),
  contentUrl: z.string().url().max(500),
  postedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(1200).nullable().optional(),
});

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : null;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Check the content details." }, { status: 400 });
  }

  const partner = await getOrLinkPartner(userId, email);
  if (!partner || partner.status !== "approved") {
    return NextResponse.json({ error: "Approved partner access is required." }, { status: 403 });
  }

  const service = partnerService();
  if (input.campaignId) {
    const { data: member } = await service
      .from("partner_campaign_members")
      .select("id")
      .eq("partner_id", partner.id)
      .eq("campaign_id", input.campaignId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: "This campaign is not assigned to you." }, { status: 403 });
  }

  const { error } = await service.from("partner_content").insert({
    partner_id: partner.id,
    campaign_id: input.campaignId || null,
    platform: input.platform,
    content_url: input.contentUrl,
    posted_at: input.postedAt || null,
    notes: input.notes || null,
  });

  if (error) return NextResponse.json({ error: "Could not submit content." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
