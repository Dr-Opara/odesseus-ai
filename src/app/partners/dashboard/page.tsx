import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrLinkPartner, partnerService } from "@/lib/partners/service";
import PartnerContentForm from "@/components/partner-content-form";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default async function PartnerDashboardPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : null;
  if (!userId) redirect("/login");

  const partner = await getOrLinkPartner(userId, email);
  if (!partner) redirect("/partners?partner=not-approved");

  const service = partnerService();
  const [
    { count: clicks },
    { count: signups },
    { count: conversions },
    { data: earnings },
    { data: payouts },
    { data: members },
    { data: content },
  ] = await Promise.all([
    service.from("partner_referrals").select("*", { count: "exact", head: true }).eq("partner_id", partner.id),
    service.from("partner_referrals").select("*", { count: "exact", head: true }).eq("partner_id", partner.id).not("signup_user_id", "is", null),
    service.from("partner_conversions").select("*", { count: "exact", head: true }).eq("partner_id", partner.id).eq("status", "qualified"),
    service.from("partner_earnings").select("amount_cents,status").eq("partner_id", partner.id),
    service.from("partner_payouts").select("amount_cents,paid_at,method,reference").eq("partner_id", partner.id).order("paid_at", { ascending: false }).limit(10),
    service.from("partner_campaign_members").select("status,partner_campaigns(id,title,description,brief,platforms,requirements,reward_terms,status,ends_at)").eq("partner_id", partner.id).order("assigned_at", { ascending: false }),
    service.from("partner_content").select("id,platform,content_url,status,created_at,partner_campaigns(title)").eq("partner_id", partner.id).order("created_at", { ascending: false }).limit(10),
  ]);

  const pending = (earnings || [])
    .filter((earning: any) => ["pending", "approved"].includes(earning.status))
    .reduce((sum: number, earning: any) => sum + earning.amount_cents, 0);
  const paid = (earnings || [])
    .filter((earning: any) => earning.status === "paid")
    .reduce((sum: number, earning: any) => sum + earning.amount_cents, 0);
  const campaigns = (members || []).map((member: any) => member.partner_campaigns).filter(Boolean);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://odesseus.ai";
  const referralUrl = siteUrl + "/?ref=" + partner.referral_code;

  return (
    <main className="shell partner-dashboard-shell">
      <div className="partner-dashboard-heading">
        <div>
          <div className="badge">Approved Partner</div>
          <h1>Welcome, {partner.full_name.split(" ")[0]}.</h1>
          <p className="muted">Share Odesseus, participate in campaigns, and track what your referrals generate.</p>
        </div>
        <div className="card partner-referral-card">
          <span className="muted">Your referral code</span>
          <strong>{partner.referral_code}</strong>
          <code>{referralUrl}</code>
        </div>
      </div>

      <div className="dashboard-stat-grid">
        <div className="card dashboard-stat"><span className="muted">Clicks</span><strong>{clicks || 0}</strong></div>
        <div className="card dashboard-stat"><span className="muted">Signups</span><strong>{signups || 0}</strong></div>
        <div className="card dashboard-stat"><span className="muted">Paid conversions</span><strong>{conversions || 0}</strong></div>
        <div className="card dashboard-stat"><span className="muted">Pending earnings</span><strong>{money(pending)}</strong></div>
        <div className="card dashboard-stat"><span className="muted">Paid earnings</span><strong>{money(paid)}</strong></div>
      </div>

      <div className="partner-dashboard-grid">
        <section className="card partner-form-section">
          <h2>Campaigns</h2>
          {campaigns.length ? campaigns.map((campaign: any) => (
            <article className="partner-campaign-item" key={campaign.id}>
              <strong>{campaign.title}</strong>
              <p className="muted">{campaign.description}</p>
              {campaign.reward_terms ? <small>{campaign.reward_terms}</small> : null}
            </article>
          )) : <p className="muted">No campaign assignments yet.</p>}
        </section>

        <section className="card partner-form-section">
          <h2>Submit content</h2>
          <PartnerContentForm campaigns={campaigns.map((campaign: any) => ({ id: campaign.id, title: campaign.title }))} />
        </section>
      </div>

      <div className="partner-dashboard-grid">
        <section className="card partner-form-section">
          <h2>Recent content</h2>
          {content?.length ? content.map((item: any) => (
            <a className="partner-content-row" key={item.id} href={item.content_url} target="_blank" rel="noreferrer">
              <span><strong>{item.platform}</strong><small className="muted">{item.partner_campaigns?.title || "Organic content"}</small></span>
              <span className="badge">{item.status.replace("_", " ")}</span>
            </a>
          )) : <p className="muted">No content submitted yet.</p>}
        </section>

        <section className="card partner-form-section">
          <h2>Payout history</h2>
          {payouts?.length ? payouts.map((payout: any) => (
            <div className="partner-content-row" key={payout.paid_at + String(payout.amount_cents)}>
              <span><strong>{money(payout.amount_cents)}</strong><small className="muted">{payout.method || "Manual payout"}</small></span>
              <small className="muted">{new Date(payout.paid_at).toLocaleDateString()}</small>
            </div>
          )) : <p className="muted">No payouts recorded yet.</p>}
        </section>
      </div>
    </main>
  );
}
