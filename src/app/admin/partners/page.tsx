import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, partnerService } from "@/lib/partners/service";
import { createPartnerCampaign, reviewPartnerContent, reviewPartnerEarning } from "./actions";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default async function AdminPartnersPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  if (!(await isAdmin(userId))) redirect("/dashboard");

  const service = partnerService();
  const [{ data: applications }, { data: partners }, { data: content }, { data: earnings }] = await Promise.all([
    service
      .from("partner_applications")
      .select("id,full_name,email,primary_niche,status,created_at,partner_social_accounts(platform,handle,follower_count)")
      .order("created_at", { ascending: false })
      .limit(100),
    service.from("partners").select("id,status").eq("status", "approved"),
    service.from("partner_content").select("id,platform,content_url,status,admin_notes,created_at,partners(full_name),partner_campaigns(title)").eq("status","submitted").order("created_at",{ascending:false}).limit(20),
    service.from("partner_earnings").select("id,amount_cents,status,reason,created_at,partners(full_name)").eq("status","pending").order("created_at",{ascending:true}).limit(20),
  ]);

  return (
    <main className="shell admin-partners-shell">
      <div className="admin-partners-heading">
        <div>
          <div className="badge">Admin</div>
          <h1>Partner applications</h1>
          <p className="muted">Review creators before they receive referral access or campaign assignments.</p>
        </div>
        <div className="admin-partner-heading-actions"><Link className="btn btn-secondary" href="/admin/system">System Readiness</Link><div className="card admin-partner-count"><strong>{partners?.length || 0}</strong><span className="muted">Approved partners</span></div></div>
      </div>

      <div className="card admin-partner-table">
        <div className="admin-partner-row header">
          <span>Applicant</span><span>Platforms</span><span>Audience</span><span>Status</span><span>Submitted</span>
        </div>
        {(applications || []).map((app: any) => {
          const followers = (app.partner_social_accounts || []).reduce(
            (sum: number, social: any) => sum + (social.follower_count || 0),
            0
          );
          return (
            <Link className="admin-partner-row" key={app.id} href={"/admin/partners/" + app.id}>
              <span><strong>{app.full_name}</strong><small>{app.email}</small></span>
              <span>{(app.partner_social_accounts || []).map((social: any) => social.platform).join(", ") || "—"}</span>
              <span>{followers.toLocaleString()}</span>
              <span className="badge">{app.status.replace("_", " ")}</span>
              <span>{formatDate(app.created_at)}</span>
            </Link>
          );
        })}
        {!applications?.length ? <div className="dashboard-empty">No partner applications yet.</div> : null}
      </div>

      <div className="admin-partner-ops-grid">
        <section className="card partner-form-section">
          <h2>Create campaign</h2>
          <form action={createPartnerCampaign}>
            <input className="input" name="title" placeholder="Campaign title" required />
            <textarea className="input" name="description" rows={3} placeholder="Campaign description" required />
            <textarea className="input" name="brief" rows={3} placeholder="Creator brief" />
            <textarea className="input" name="requirements" rows={3} placeholder="Requirements" />
            <input className="input" name="reward_terms" placeholder="Reward / commission terms" />
            <div className="partner-checkbox-grid">
              <label><input type="checkbox" name="platform" value="instagram" /> Instagram</label>
              <label><input type="checkbox" name="platform" value="facebook" /> Facebook</label>
              <label><input type="checkbox" name="platform" value="tiktok" /> TikTok</label>
            </div>
            <button className="btn btn-primary">Create active campaign</button>
          </form>
        </section>

        <section className="card partner-form-section">
          <h2>Content awaiting review</h2>
          {content?.length ? content.map((item:any)=><form className="admin-review-item" action={reviewPartnerContent} key={item.id}>
            <input type="hidden" name="content_id" value={item.id} />
            <div><strong>{item.partners?.full_name || "Partner"} · {item.platform}</strong><a href={item.content_url} target="_blank" rel="noreferrer">{item.partner_campaigns?.title || "Organic content"}</a></div>
            <input className="input" name="admin_notes" placeholder="Review notes" />
            <div className="admin-review-actions"><button className="btn btn-primary" name="status" value="approved">Approve</button><button className="btn btn-secondary" name="status" value="changes_requested">Request changes</button><button className="btn btn-secondary" name="status" value="rejected">Reject</button></div>
          </form>) : <p className="muted">No content waiting for review.</p>}
        </section>
      </div>

      <section className="card partner-form-section" style={{marginTop:18}}>
        <h2>Pending earnings</h2>
        {earnings?.length ? earnings.map((earning:any)=><form className="admin-review-item" action={reviewPartnerEarning} key={earning.id}>
          <input type="hidden" name="earning_id" value={earning.id} />
          <div><strong>{earning.partners?.full_name || "Partner"} · ${(earning.amount_cents/100).toFixed(2)}</strong><span className="muted">{earning.reason || "Referral earning"}</span></div>
          <div className="admin-review-actions"><button className="btn btn-primary" name="status" value="approved">Approve earning</button><button className="btn btn-secondary" name="status" value="reversed">Reverse</button></div>
        </form>) : <p className="muted">No pending earnings.</p>}
      </section>
    </main>
  );
}
