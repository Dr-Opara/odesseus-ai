import { createServiceClient } from "@/lib/supabase/service";
import { jobStatusLabel, featuredOptionForTier } from "@/lib/employer/plans";
import AdminJobsTable, { type AdminJobRow } from "@/components/admin-jobs-table";

export const metadata = { title: "Jobs — Odesseus Admin" };

export default async function AdminJobsPage() {
  const service = createServiceClient();

  const [{ data: jobs }, { data: orgs }, { data: featured }] = await Promise.all([
    service.from("employer_jobs").select("id,title,status,location,org_id,created_at").order("created_at", { ascending: false }).limit(500),
    service.from("employer_organizations").select("id,name"),
    service.from("featured_listings").select("job_id,tier,is_active,expires_at"),
  ]);

  const orgById = new Map((orgs || []).map((org) => [org.id, org.name]));
  const featuredByJob = new Map((featured || []).filter((f) => f.is_active).map((f) => [f.job_id, f]));

  const rows: AdminJobRow[] = (jobs || []).map((job) => {
    const feature = featuredByJob.get(job.id);
    const featureOption = feature ? featuredOptionForTier(feature.tier) : null;
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      statusLabel: jobStatusLabel(job.status),
      location: job.location,
      orgId: job.org_id,
      orgName: orgById.get(job.org_id) || "Unknown organization",
      featuredLabel: feature ? `${featureOption?.name || feature.tier} until ${new Date(feature.expires_at).toLocaleDateString()}` : null,
      createdAt: job.created_at,
    };
  });

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Jobs</div>
          <h1>Employer job postings</h1>
          <p className="muted">{rows.length} jobs across all employers.</p>
        </div>
      </div>

      <AdminJobsTable jobs={rows} />

      <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
        Job reports/flags are not tracked by the backend yet — there is no report queue to review here.
      </p>
    </main>
  );
}
