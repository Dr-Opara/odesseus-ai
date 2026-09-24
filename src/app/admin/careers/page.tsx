import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/partners/service";
import { careersService } from "@/lib/careers/service";
import { updateCareerApplicationStatus } from "./actions";

export const metadata = { title: "Careers Admin — Odesseus" };

export default async function CareersAdminPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  if (!(await isAdmin(userId))) redirect("/dashboard");

  const service = careersService();
  const { data: applications } = await service.from("career_applications")
    .select("id,full_name,email,country,linkedin_url,portfolio_url,github_url,years_experience,weekly_availability,compensation_expectation,why_odesseus,screening_answers,resume_path,status,created_at,career_roles(title,slug)")
    .order("created_at", { ascending: false }).limit(500);

  return (
    <main className="shell admin-partners-shell">
      <div className="admin-partners-heading">
        <div><div className="badge">Admin · Careers</div><h1>Career applications</h1><p className="muted">Review Odesseus founding-team applicants across the five worldwide remote roles.</p></div>
        <div className="admin-partner-heading-actions"><Link className="btn btn-secondary" href="/admin/partners">Partner Admin</Link><Link className="btn btn-secondary" href="/admin/system">System Readiness</Link></div>
      </div>
      <div className="card" style={{ padding: 22 }}>
        {(applications || []).map((app: any) => (
          <article key={app.id} style={{ padding:"20px 0",borderTop:"1px solid var(--line)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",gap:18,flexWrap:"wrap" }}>
              <div><strong>{app.full_name}</strong><div className="muted">{app.email} · {app.country}</div><div className="muted">{app.career_roles?.title}</div></div>
              <span className="badge">{app.status}</span>
            </div>
            <p>{app.why_odesseus}</p>
            <p><strong>Screening:</strong> {app.screening_answers?.answer}</p>
            <p className="muted">Availability: {app.weekly_availability} · Experience: {app.years_experience ?? "—"} years · Compensation: {app.compensation_expectation || "—"}</p>
            <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
              {app.linkedin_url ? <a className="figma-text-cta" href={app.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a> : null}
              {app.github_url ? <a className="figma-text-cta" href={app.github_url} target="_blank" rel="noreferrer">GitHub</a> : null}
              {app.portfolio_url ? <a className="figma-text-cta" href={app.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a> : null}
              <Link className="figma-text-cta" href={`/admin/careers/${app.id}/resume`}>Download resume</Link>
            </div>
            <form action={updateCareerApplicationStatus} style={{ display:"flex",gap:10,marginTop:14,flexWrap:"wrap" }}>
              <input type="hidden" name="application_id" value={app.id} />
              <select className="input" name="status" defaultValue={app.status} style={{ maxWidth:220 }}>
                {["submitted","reviewing","shortlisted","interview","offer","hired","rejected","withdrawn"].map((s)=><option value={s} key={s}>{s}</option>)}
              </select>
              <button className="btn btn-primary">Update status</button>
            </form>
          </article>
        ))}
        {!applications?.length ? <p className="muted">No career applications yet.</p> : null}
      </div>
    </main>
  );
}
