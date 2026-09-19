"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, makeReferralCode, partnerService } from "@/lib/partners/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  const role = await isAdmin(userId);
  if (!role) redirect("/dashboard");
  return { userId, role };
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function reviewPartnerApplication(formData: FormData) {
  const { userId } = await requireAdmin();
  const applicationId = text(formData, "application_id");
  const status = text(formData, "status");
  if (!applicationId || !["under_review","approved","waitlisted","rejected"].includes(status)) return;

  const service = partnerService();
  const notes = text(formData, "internal_notes") || null;
  const partnershipType = text(formData, "partnership_type") || null;
  const commissionRaw = text(formData, "commission_percent");
  const commissionBps = commissionRaw ? Math.round(Number(commissionRaw) * 100) : null;

  if (commissionBps !== null && (!Number.isFinite(commissionBps) || commissionBps < 0 || commissionBps > 10000)) return;

  const { data: application } = await service
    .from("partner_applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (!application) return;

  await service.from("partner_applications").update({
    status,
    internal_notes: notes,
    proposed_commission_bps: commissionBps,
    approved_partnership_type: partnershipType,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", applicationId);

  if (status === "approved") {
    let partner = (
      await service.from("partners").select("*").eq("application_id", applicationId).maybeSingle()
    ).data;

    if (!partner) {
      for (let attempt = 0; attempt < 5 && !partner; attempt += 1) {
        const { data, error } = await service.from("partners").insert({
          application_id: applicationId,
          email: application.email.toLowerCase(),
          full_name: application.full_name,
          status: "approved",
          partnership_type: partnershipType || "affiliate",
          referral_code: makeReferralCode(application.full_name),
          commission_bps: commissionBps,
        }).select("*").maybeSingle();

        if (!error) partner = data;
        else if (error.code !== "23505") throw error;
      }
    }

    if (partner) {
      await service.from("partner_social_accounts")
        .update({ partner_id: partner.id })
        .eq("application_id", applicationId)
        .is("partner_id", null);
    }
  }

  revalidatePath("/admin/partners");
  revalidatePath("/admin/partners/" + applicationId);
}

export async function assignPartnerCampaign(formData: FormData) {
  await requireAdmin();
  const partnerId = text(formData, "partner_id");
  const campaignId = text(formData, "campaign_id");
  if (!partnerId || !campaignId) return;

  const service = partnerService();
  await service.from("partner_campaign_members").upsert(
    { partner_id: partnerId, campaign_id: campaignId, status: "assigned" },
    { onConflict: "campaign_id,partner_id" }
  );
  revalidatePath("/admin/partners");
}

export async function recordPartnerPayout(formData: FormData) {
  const { userId } = await requireAdmin();
  const partnerId = text(formData, "partner_id");
  const amount = Math.round(Number(text(formData, "amount")) * 100);
  if (!partnerId || !Number.isFinite(amount) || amount <= 0) return;

  const service = partnerService();
  await service.from("partner_payouts").insert({
    partner_id: partnerId,
    amount_cents: amount,
    method: text(formData, "method") || null,
    reference: text(formData, "reference") || null,
    notes: text(formData, "notes") || null,
    paid_at: new Date().toISOString(),
    recorded_by: userId,
  });

  const { data: earnings } = await service.from("partner_earnings")
    .select("id,amount_cents")
    .eq("partner_id", partnerId)
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  let remaining = amount;
  for (const earning of earnings || []) {
    if (remaining < earning.amount_cents) break;
    await service.from("partner_earnings")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", earning.id);
    remaining -= earning.amount_cents;
  }

  revalidatePath("/admin/partners");
}
