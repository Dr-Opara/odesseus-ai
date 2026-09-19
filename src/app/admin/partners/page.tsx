import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, partnerService } from "@/lib/partners/service";

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
  const [{ data: applications }, { data: partners }] = await Promise.all([
    service
      .from("partner_applications")
      .select("id,full_name,email,primary_niche,status,created_at,partner_social_accounts(platform,handle,follower_count)")
      .order("created_at", { ascending: false })
      .limit(100),
    service.from("partners").select("id,status").eq("status", "approved"),
  ]);

  return (
    <main className="shell admin-partners-shell">
      <div className="admin-partners-heading">
        <div>
          <div className="badge">Admin</div>
          <h1>Partner applications</h1>
          <p className="muted">Review creators before they receive referral access or campaign assignments.</p>
        </div>
        <div className="card admin-partner-count">
          <strong>{partners?.length || 0}</strong>
          <span className="muted">Approved partners</span>
        </div>
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
    </main>
  );
}
