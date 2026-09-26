import { createServiceClient } from "@/lib/supabase/service";
import { resolveAdminRole } from "@/lib/admin/authorize";
import type { AdminRole } from "@/lib/admin/capabilities";

export type PartnerPlatform = "instagram" | "facebook" | "tiktok";
export type PartnerApplicationStatus = "submitted" | "under_review" | "approved" | "waitlisted" | "rejected";

export function partnerService() {
  return createServiceClient() as any;
}

/**
 * The admin role for a user, or null.
 *
 * Delegates to the shared resolver so the `ODESSEUS_ADMIN_EMAILS` bootstrap and
 * the unknown-role handling exist once. The partner program is not a
 * capability-gated surface -- it is entirely `admin`-scoped -- so these call
 * sites keep using the role directly. Anything that is not partner-related
 * should call `requireCapability` with the capability it needs instead of
 * branching on this value.
 */
export async function isAdmin(userId: string): Promise<AdminRole | null> {
  return resolveAdminRole(userId);
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
