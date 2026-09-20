import { NextResponse } from "next/server";
import { z } from "zod";
import { partnerService } from "@/lib/partners/service";
import { checkRateLimit, clientIp } from "@/lib/security/rate-limit";

const schema = z.object({
  code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  landingPath: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const limit = checkRateLimit(`referral:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ ok: true });

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid referral." }, { status: 400 });
  }

  const service = partnerService();
  const { data: partner } = await service
    .from("partners")
    .select("id,referral_code,status")
    .eq("referral_code", input.code.toUpperCase())
    .eq("status", "approved")
    .maybeSingle();

  if (!partner) return NextResponse.json({ ok: true });

  const visitorId = crypto.randomUUID();
  await service.from("partner_referrals").insert({
    partner_id: partner.id,
    referral_code: partner.referral_code,
    visitor_id: visitorId,
    landing_path: input.landingPath || "/",
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("odesseus_ref", visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
