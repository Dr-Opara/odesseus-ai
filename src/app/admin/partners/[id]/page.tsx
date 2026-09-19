import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, partnerService } from "@/lib/partners/service";
import { assignPartnerCampaign, recordPartnerPayout, reviewPartnerApplication } from "../actions";

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  if (!(await isAdmin(userId))) redirect("/dashboard");

  const service = partnerService();
  const [{ data: application }, { data: campaigns }] = await Promise.all([
    service.from("partner_applications").select("*,partner_social_accounts(*)").eq("id", id).maybeSingle(),
    service.from("partner_campaigns").select("id,title,status").in("status", ["draft", "active"]).order("created_at", { ascending: false }),
  ]);

  if (!application) notFound();

  const { data: partner } = await service.from("partners").select("*").eq("application_id", id).maybeSingle();
  const { data: earnings } = partner
    ? await service.from("partner_earnings").select("amount_cents,status").eq("partner_id", partner.id)
    : { data: [] as any[] };

  const approvedEarnings = (earnings || [])
    .filter((earning: any) => earning.status === "approved")
    .reduce((sum: number, earning: any) => sum + earning.amount_cents, 0);

  return (
    <main className="shell admin-partner-detail">
      <Link href="/admin/partners" className="muted">← Partner applications</Link>

      <div className="admin-partner-detail-heading">
        <div>
          <div className="badge">{application.status.replace("_", " ")}</div>
          <h1>{application.full_name}</h1>
          <p className="muted">
            {application.email} · {application.country}
            {application.city_state ? " · " + application.city_state : ""}
          </p>
        </div>
        {partner ? (
          <div className="card admin-partner-code">
            <span className="muted">Referral code</span>
            <strong>{partner.referral_code}</strong>
          </div>
        ) : null}
      </div>

      <div className="admin-partner-detail-grid">
        <section className="card partner-form-section">
          <h2>Application</h2>
          <p><strong>Niche:</strong> {application.primary_niche.replace("_", " ")}</p>
          <p><strong>Audience:</strong> {application.audience_description}</p>
          <p><strong>Why Odysseus:</strong> {application.motivation}</p>
          <p><strong>Preferred:</strong> {(application.preferred_partnerships || []).join(", ")}</p>
          <p><strong>Expected rate:</strong> {application.expected_rate || "Not provided"}</p>
          <div className="partner-social-admin-list">
            {(application.partner_social_accounts || []).map((social: any) => (
              <a key={social.id} href={social.profile_url} target="_blank" rel="noreferrer">
                <strong>{social.platform}</strong> · {social.handle} · {(social.follower_count || 0).toLocaleString()} followers
              </a>
            ))}
          </div>
          <div className="partner-samples">
            {(application.sample_links || []).map((link: string) => (
              <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>
            ))}
          </div>
        </section>

        <section className="card partner-form-section">
          <h2>Review</h2>
          <form action={reviewPartnerApplication}>
            <input type="hidden" name="application_id" value={application.id} />
            <label>
              Partnership type
              <select className="input" name="partnership_type" defaultValue={application.approved_partnership_type || "affiliate"}>
                <option value="affiliate">Affiliate</option>
                <option value="creator">Creator</option>
                <option value="brand_ambassador">Brand Ambassador</option>
                <option value="sponsored_campaign">Sponsored Campaign</option>
              </select>
            </label>
            <label>
              Commission % <span className="muted">(configurable)</span>
              <input
                className="input"
                name="commission_percent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={application.proposed_commission_bps != null ? application.proposed_commission_bps / 100 : ""}
              />
            </label>
            <label>
              Internal notes
              <textarea className="input" rows={4} name="internal_notes" defaultValue={application.internal_notes || ""} />
            </label>
            <div className="admin-review-actions">
              <button className="btn btn-secondary" name="status" value="under_review">Under review</button>
              <button className="btn btn-primary" name="status" value="approved">Approve</button>
              <button className="btn btn-secondary" name="status" value="waitlisted">Waitlist</button>
              <button className="btn btn-secondary" name="status" value="rejected">Reject</button>
            </div>
          </form>
        </section>
      </div>

      {partner ? (
        <div className="admin-partner-detail-grid">
          <section className="card partner-form-section">
            <h2>Campaign assignment</h2>
            <form action={assignPartnerCampaign}>
              <input type="hidden" name="partner_id" value={partner.id} />
              <select className="input" name="campaign_id" required defaultValue="">
                <option value="" disabled>Select campaign</option>
                {(campaigns || []).map((campaign: any) => (
                  <option value={campaign.id} key={campaign.id}>{campaign.title} ({campaign.status})</option>
                ))}
              </select>
              <button className="btn btn-primary" style={{ marginTop: 12 }}>Assign campaign</button>
            </form>
          </section>

          <section className="card partner-form-section">
            <h2>Record manual payout</h2>
            <p className="muted">Approved unpaid earnings: ${(approvedEarnings / 100).toFixed(2)}</p>
            <form action={recordPartnerPayout}>
              <input type="hidden" name="partner_id" value={partner.id} />
              <input className="input" name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required />
              <input className="input" name="method" placeholder="Method, e.g. ACH" />
              <input className="input" name="reference" placeholder="Payment reference" />
              <button className="btn btn-primary" style={{ marginTop: 12 }}>Record payout</button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
