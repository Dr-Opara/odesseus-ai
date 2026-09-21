"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, makeReferralCode, partnerService } from "@/lib/partners/service";
import { sendPartnerEmail } from "@/lib/partners/email";

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

  let approvedPartner: any = null;

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
      approvedPartner = partner;
      await service.from("partner_social_accounts")
        .update({ partner_id: partner.id })
        .eq("application_id", applicationId)
        .is("partner_id", null);
    }
  }

  if (status === "approved") {
    await sendPartnerEmail({
      to: application.email,
      subject: "Welcome to the Odesseus Partner Program",
      heading: "You’re approved.",
      body: approvedPartner
        ? "Your Odesseus Partner application has been approved. Your referral code is " + approvedPartner.referral_code + ". Sign in with this email to access your Partner Dashboard."
        : "Your Odesseus Partner application has been approved. Sign in with this email to access your Partner Dashboard.",
      ctaLabel: "Open Partner Dashboard",
      ctaHref: "/partners/dashboard",
    });
  } else if (status === "waitlisted") {
    await sendPartnerEmail({
      to: application.email,
      subject: "Odesseus Partner Program update",
      heading: "You’re on our partner waitlist.",
      body: "Thanks for applying. We’d like to keep your profile on our waitlist while we plan upcoming creator campaigns.",
      ctaLabel: "View the Partner Program",
      ctaHref: "/partners",
    });
  } else if (status === "rejected") {
    await sendPartnerEmail({
      to: application.email,
      subject: "Odesseus Partner Program update",
      heading: "Thank you for applying.",
      body: "We’ve completed our review and won’t be moving forward with this Partner Program application at this time. We appreciate your interest in Odesseus.",
      ctaLabel: "Visit Odesseus",
      ctaHref: "/",
    });
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

  const [{ data: partner }, { data: campaign }] = await Promise.all([
    service.from("partners").select("email,full_name").eq("id", partnerId).maybeSingle(),
    service.from("partner_campaigns").select("title").eq("id", campaignId).maybeSingle(),
  ]);

  if (partner?.email && campaign?.title) {
    await sendPartnerEmail({
      to: partner.email,
      subject: "New Odesseus partner campaign",
      heading: "You have a new campaign.",
      body: "You’ve been assigned to “" + campaign.title + "”. Open your Partner Dashboard to review the brief and requirements.",
      ctaLabel: "View campaign",
      ctaHref: "/partners/dashboard",
    });
  }

  revalidatePath("/admin/partners");
}

export async function recordPartnerPayout(formData: FormData) {
  const { userId } = await requireAdmin();
  const partnerId = text(formData, "partner_id");
  const amount = Math.round(Number(text(formData, "amount")) * 100);
  if (!partnerId || !Number.isFinite(amount) || amount <= 0) return;

  const service = partnerService();
  const { data: payoutPartner } = await service
    .from("partners")
    .select("email,full_name")
    .eq("id", partnerId)
    .maybeSingle();

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

  if (payoutPartner?.email) {
    await sendPartnerEmail({
      to: payoutPartner.email,
      subject: "Odesseus partner payout recorded",
      heading: "Your payout was recorded.",
      body: "A partner payout of $" + (amount / 100).toFixed(2) + " has been recorded. You can review your payout history in your Partner Dashboard.",
      ctaLabel: "View payout history",
      ctaHref: "/partners/dashboard",
    });
  }

  revalidatePath("/admin/partners");
}


export async function createPartnerCampaign(formData: FormData) {
  const { userId } = await requireAdmin();
  const title = text(formData, "title");
  const description = text(formData, "description");
  if (!title || !description) return;

  const platforms = formData.getAll("platform").map(String).filter((value) =>
    ["instagram", "facebook", "tiktok"].includes(value)
  );

  const service = partnerService();
  await service.from("partner_campaigns").insert({
    title,
    description,
    brief: text(formData, "brief") || null,
    platforms,
    requirements: text(formData, "requirements") || null,
    reward_terms: text(formData, "reward_terms") || null,
    status: "active",
    created_by: userId,
  });

  revalidatePath("/admin/partners");
}

export async function reviewPartnerContent(formData: FormData) {
  const { userId } = await requireAdmin();
  const contentId = text(formData, "content_id");
  const status = text(formData, "status");
  if (!contentId || !["approved", "changes_requested", "rejected"].includes(status)) return;

  const service = partnerService();
  const { data: contentItem } = await service
    .from("partner_content")
    .select("platform,content_url,partners(email,full_name)")
    .eq("id", contentId)
    .maybeSingle();

  await service.from("partner_content").update({
    status,
    admin_notes: text(formData, "admin_notes") || null,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", contentId);

  const contentPartner = contentItem?.partners;
  if (contentPartner?.email) {
    const approved = status === "approved";
    const changes = status === "changes_requested";
    await sendPartnerEmail({
      to: contentPartner.email,
      subject: approved
        ? "Your Odesseus partner content was approved"
        : changes
          ? "Changes requested on your Odesseus partner content"
          : "Odesseus partner content review update",
      heading: approved
        ? "Content approved."
        : changes
          ? "We need a few changes."
          : "Content review complete.",
      body: approved
        ? "Your " + contentItem.platform + " content has been approved. Thanks for helping introduce Odesseus to your audience."
        : changes
          ? "Our team reviewed your " + contentItem.platform + " content and requested changes. Open your Partner Dashboard for the latest status."
          : "Our team reviewed your submitted content and won’t be using it for this campaign.",
      ctaLabel: "Open Partner Dashboard",
      ctaHref: "/partners/dashboard",
    });
  }

  revalidatePath("/admin/partners");
}

export async function reviewPartnerEarning(formData: FormData) {
  await requireAdmin();
  const earningId = text(formData, "earning_id");
  const status = text(formData, "status");
  if (!earningId || !["approved", "reversed"].includes(status)) return;

  const service = partnerService();
  await service.from("partner_earnings").update({
    status,
    updated_at: new Date().toISOString(),
  }).eq("id", earningId).neq("status", "paid");

  revalidatePath("/admin/partners");
}
