import { createServiceClient } from "@/lib/supabase/service";

export type PartnerPlatform = "instagram" | "facebook" | "tiktok";
export type PartnerApplicationStatus = "submitted" | "under_review" | "approved" | "waitlisted" | "rejected";

export function partnerService() {
  return createServiceClient() as any;
}

export async function isAdmin(userId: string) {
  const service = partnerService();
  const { data } = await service
    .from("admin_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.role) return data.role;

  const allowed = (process.env.ODESSEUS_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.length) return null;

  const { data: authUser } = await service.auth.admin.getUserById(userId);
  const email = authUser?.user?.email?.trim().toLowerCase();
  if (!email || !allowed.includes(email)) return null;

  await service.from("admin_users").upsert({
    user_id: userId,
    role: "admin",
  });

  return "admin";
}

export async function getOrLinkPartner(userId: string, email?: string | null) {
  const service = partnerService();
  const { data: direct } = await service
    .from("partners")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (direct) return direct;
  if (!email) return null;

  const { data: byEmail } = await service
    .from("partners")
    .select("*")
    .ilike("email", email.trim())
    .eq("status", "approved")
    .maybeSingle();

  if (!byEmail || byEmail.user_id) return null;

  const { data: linked } = await service
    .from("partners")
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", byEmail.id)
    .is("user_id", null)
    .select("*")
    .maybeSingle();

  return linked || null;
}

export function makeReferralCode(name: string) {
  const stem = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "PARTNER";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${stem}${suffix}`;
}
