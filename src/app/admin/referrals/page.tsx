import { createServiceClient } from "@/lib/supabase/service";
import { partnerService } from "@/lib/partners/service";

export const metadata = { title: "Referrals — Odesseus Admin" };

export default async function AdminReferralsPage() {
  const service = createServiceClient();
  const partners = partnerService();

  const [{ data: referrals }, { data: partnerRows }, { data: conversions }, { data: authUsers }] = await Promise.all([
    partners
      .from("partner_referrals")
      .select("id,partner_id,referral_code,visitor_id,landing_path,signup_user_id,signup_at,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    partners.from("partners").select("id,full_name,email"),
    partners.from("partner_conversions").select("id,user_id,partner_id,amount_cents,commission_cents,status,created_at"),
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const partnerById = new Map(((partnerRows || []) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p]));
  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));
  const conversionByUser = new Map(
    ((conversions || []) as { user_id: string; amount_cents: number; commission_cents: number; status: string }[]).map((c) => [c.user_id, c])
  );

  const rows = ((referrals || []) as {
    id: string;
    partner_id: string;
    referral_code: string;
    landing_path: string | null;
    signup_user_id: string | null;
    signup_at: string | null;
    created_at: string;
  }[]).map((referral) => {
    const partner = partnerById.get(referral.partner_id);
    const conversion = referral.signup_user_id ? conversionByUser.get(referral.signup_user_id) : undefined;
    let conversionState = "Click only";
    if (referral.signup_user_id) conversionState = conversion ? conversion.status : "Signed up, no purchase yet";
    return {
      id: referral.id,
      referralCode: referral.referral_code,
      referrerName: partner?.full_name || "Unknown partner",
      referredEmail: referral.signup_user_id ? emailById.get(referral.signup_user_id) || referral.signup_user_id : null,
      landingPath: referral.landing_path,
      conversionState,
      amountCents: conversion?.amount_cents,
      createdAt: referral.created_at,
    };
  });

  const signupCount = rows.filter((r) => r.referredEmail).length;
  const qualifiedCount = rows.filter((r) => r.conversionState === "qualified").length;

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Referrals</div>
          <h1>Partner referral funnel</h1>
          <p className="muted">
            {rows.length} clicks · {signupCount} signups · {qualifiedCount} qualified conversions.
          </p>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
        Odesseus only tracks referrals through the partner/affiliate program. There is no separate
        candidate-to-candidate referral backend yet.
      </p>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1fr 1.4fr 1fr 1fr .9fr" }}>
          <span>Code</span><span>Referred user</span><span>Referrer</span><span>Landing path</span><span>State</span>
        </div>
        {rows.map((row) => (
          <div className="admin-row" key={row.id} style={{ ["--admin-row-cols" as string]: "1fr 1.4fr 1fr 1fr .9fr" }}>
            <span><strong>{row.referralCode}</strong></span>
            <span>{row.referredEmail || <span className="muted">Not signed up</span>}</span>
            <span>{row.referrerName}</span>
            <span>{row.landingPath || "—"}</span>
            <span className={row.conversionState === "qualified" ? "readiness-status good" : "badge"}>
              {row.conversionState}
            </span>
          </div>
        ))}
        {!rows.length ? <div className="admin-empty">No referral clicks recorded yet.</div> : null}
      </div>
    </main>
  );
}
